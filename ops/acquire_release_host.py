"""Acquire a read-only host observation through explicitly pinned OpenSSH.

No staging or readiness claim. All collector code is sent over stdin and loaded
in memory, so no remote installation or temporary source file is needed.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import time

import observe_release_host as observer


CLOSURE = ('prepare_release', 'prepare_runtime_bundle', 'prepare_rollback',
           'observe_release_host')
BOOTSTRAP = """import hashlib,json,sys,types
p=json.load(sys.stdin)
for name in p['order']:
    source=p['modules'][name]
    assert hashlib.sha256(source.encode()).hexdigest()==p['hashes'][name], 'collector-source-binding'
    module=types.ModuleType(name)
    sys.modules[name]=module
    exec(compile(source,name+'.py','exec'),module.__dict__)
value=sys.modules['observe_release_host'].collect(**p['request'])
print(json.dumps(value,sort_keys=True))
"""


def digest(data):
    return hashlib.sha256(data).hexdigest()


def regular(name, label, private=False):
    p = Path(name)
    observer.require(p.is_absolute() and p.is_file() and
                     all(not q.is_symlink() for q in (p, *p.parents)),
                     'unsafe-ssh-input:' + label)
    if private:
        observer.require(p.stat().st_uid == os.geteuid() and
                         p.stat().st_mode & 0o077 == 0,
                         'unsafe-ssh-private-key')
    return p


def acquire(*, host, port, user, identity, known_hosts, known_hosts_sha256,
            expected_host, service, roots, stop_at, collector_hashes):
    observer.remaining(stop_at)
    observer.require(isinstance(host, str) and
                     re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9.-]*', host), 'invalid-ssh-host')
    observer.require(isinstance(user, str) and
                     re.fullmatch(r'[a-z_][a-z0-9_-]*', user), 'invalid-ssh-user')
    observer.require(type(port) is int and 0 < port < 65536, 'invalid-ssh-port')
    pin = regular(known_hosts, 'known-hosts')
    key = regular(identity, 'identity', private=True)
    pinned_bytes = pin.read_bytes()
    observer.require(digest(pinned_bytes) == known_hosts_sha256, 'changed-ssh-host-pin')
    modules = {name: Path(__file__).with_name(name + '.py').read_text() for name in CLOSURE}
    hashes = {name: digest(source.encode()) for name, source in modules.items()}
    observer.require(hashes == collector_hashes, 'changed-host-collector')
    payload = {'modules': modules, 'hashes': hashes, 'order': CLOSURE,
               'request': dict(expected_host=expected_host, service=service,
                               roots=roots, stop_at=stop_at)}
    # Ignore ambient SSH configuration, agent identities, proxies and connection
    # sharing. The supplied known-hosts file is the only host trust anchor.
    argv = ['/usr/bin/ssh', '-F', '/dev/null', '-T', '-p', str(port),
            '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
            '-o', 'UserKnownHostsFile=' + str(pin), '-o', 'GlobalKnownHostsFile=/dev/null',
            '-o', 'UpdateHostKeys=no', '-o', 'IdentitiesOnly=yes',
            '-o', 'IdentityAgent=none', '-o', 'ForwardAgent=no',
            '-o', 'ClearAllForwardings=yes', '-o', 'ControlMaster=no',
            '-o', 'ControlPath=none', '-o', 'ProxyCommand=none',
            '-o', 'PasswordAuthentication=no', '-o', 'KbdInteractiveAuthentication=no',
            '-i', str(key), '--', user + '@' + host,
            shlex.join(['/usr/bin/python3', '-I', '-B', '-c', BOOTSTRAP])]
    started = time.time()
    # Timeout kills and reaps the owned local SSH process. Collection is strictly
    # read-only and receives the same absolute deadline on the authenticated host.
    result = subprocess.run(argv, input=json.dumps(payload), capture_output=True,
                            text=True, timeout=observer.remaining(stop_at),
                            env={'PATH': '/usr/bin:/bin', 'LC_ALL': 'C'})
    observer.require(result.returncode == 0, 'authenticated-host-command-failed:' + str(result.returncode))
    observer.remaining(stop_at)
    observer.require(pin.read_bytes() == pinned_bytes, 'changed-ssh-host-pin')
    observer.require(all(digest(Path(__file__).with_name(n + '.py').read_bytes()) == hashes[n]
                         for n in CLOSURE), 'changed-host-collector')
    value = json.loads(result.stdout)
    # Paths describe the remote installation, not a workstation mirror. The
    # transported collector performs filesystem/process validation on that host.
    observer.require(value.get('roots') == roots, 'authenticated-host-layout-mismatch')
    observer.require(value.get('host') == expected_host and value.get('service') == service,
                     'authenticated-host-identity-mismatch')
    observer.require(value.get('collector') == 'linux-proc-systemd-v1', 'unexpected-host-collector')
    return {'releaseReady': False, 'observation': value,
            'transport': {'kind': 'openssh-pinned', 'host': host, 'port': port, 'user': user,
                          'knownHostsSha256': known_hosts_sha256, 'collectorHashes': hashes,
                          'bootstrapSha256': digest(BOOTSTRAP.encode()),
                          'startedAt': started, 'finishedAt': time.time(), 'exit': result.returncode},
            'serviceActions': [], 'databaseActions': []}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', required=True)
    parser.add_argument('--stop-at-ms', type=int, required=True)
    args = parser.parse_args()
    config = json.loads(Path(args.config).read_text())
    # No new per-command budget and no remotely supplied command selection.
    result = acquire(**config, stop_at=args.stop_at_ms / 1000)
    print(json.dumps(result, sort_keys=True))


if __name__ == '__main__':
    main()
