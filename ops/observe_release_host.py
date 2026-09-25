"""Read-only Linux/systemd observation for current-installation retention.

Run on the installation host over the operator's authenticated transport. This
collector does not establish that transport, stage files, or authorize a release.
Its stdout is the observation consumed by prepare_rollback; no process arguments,
environment, credential files, or service configuration contents are emitted.
"""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import socket
import subprocess
import time

import prepare_rollback as rollback


PROPERTIES = ('MainPID', 'ActiveState', 'SubState', 'ControlGroup')


def require(condition, reason):
    if not condition:
        raise ValueError(reason)


def remaining(stop_at):
    value = stop_at - time.time()
    require(value > 0, 'host-observation-deadline')
    return value


def service_state(service, stop_at):
    result = subprocess.run(
        ['/usr/bin/systemctl', 'show', '--no-pager',
         '--property=' + ','.join(PROPERTIES), '--', service],
        check=True, capture_output=True, text=True, timeout=remaining(stop_at),
        env={'PATH': '/usr/bin:/bin', 'LC_ALL': 'C'})
    rows = [line.split('=', 1) for line in result.stdout.splitlines()]
    require(all(len(row) == 2 for row in rows), 'invalid-systemd-observation')
    require(len(rows) == len(PROPERTIES) and {r[0] for r in rows} == set(PROPERTIES),
            'invalid-systemd-properties')
    value = dict(rows)
    require(value['ActiveState'] == 'active' and value['SubState'] == 'running',
            'release-service-not-running')
    require(value['MainPID'].isdigit() and int(value['MainPID']) > 0,
            'invalid-service-pid')
    require(value['ControlGroup'].startswith('/') and
            '..' not in value['ControlGroup'].split('/'), 'invalid-service-cgroup')
    return value


def process_state(pid, stop_at):
    remaining(stop_at)
    proc = Path('/proc') / str(pid)
    # comm (field 2) may contain spaces and parentheses; field 22 is starttime.
    raw = (proc / 'stat').read_text()
    fields = raw[raw.rfind(')') + 2:].split()
    require(len(fields) >= 20 and fields[19].isdigit(), 'invalid-process-stat')
    require(fields[0] not in ('Z', 'X'), 'release-process-not-running')
    cwd, executable = os.readlink(proc / 'cwd'), os.readlink(proc / 'exe')
    require(not cwd.endswith(' (deleted)') and not executable.endswith(' (deleted)'),
            'deleted-release-process-path')
    groups = [line.split(':', 2) for line in (proc / 'cgroup').read_text().splitlines()]
    require(all(len(row) == 3 for row in groups), 'invalid-process-cgroup')
    # Hash the executable inode actually mapped by the process, rather than
    # trusting a path that could have been replaced after startup.
    digest = hashlib.sha256()
    with (proc / 'exe').open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            remaining(stop_at)
            digest.update(block)
    return {'pid': pid, 'process_start': fields[19], 'cwd': cwd,
            'executable': executable, 'executable_sha256': digest.hexdigest(),
            'cgroups': groups}


def collect(expected_host, service, roots, stop_at):
    remaining(stop_at)
    require(os.geteuid() == 0, 'host-observer-requires-root')
    require(expected_host == socket.gethostname(), 'unexpected-release-host')
    require(isinstance(service, str) and re.fullmatch(r'[A-Za-z0-9_-]+\.service', service),
            'invalid-release-service')
    require(set(roots) == set(rollback.ROLES), 'rollback-root-roles')
    normalized = {}
    for role, name in roots.items():
        require(isinstance(name, str) and Path(name).is_absolute() and
                '..' not in Path(name).parts, 'noncanonical-host-root:' + role)
        root = Path(name)
        require(root.is_dir() and all(not p.is_symlink() for p in (root, *root.parents)),
                'unsafe-host-root:' + role)
        normalized[role] = str(root)
    paths = list(map(Path, normalized.values()))
    require(all(a != b and a not in b.parents for i, a in enumerate(paths)
                for j, b in enumerate(paths) if i != j), 'overlapping-host-roots')
    boot = Path('/proc/sys/kernel/random/boot_id').read_text().strip()
    before = service_state(service, stop_at)
    process = process_state(int(before['MainPID']), stop_at)
    require(any((hierarchy == '0' or 'name=systemd' in controllers.split(',')) and
                group == before['ControlGroup']
                for hierarchy, controllers, group in process['cgroups']),
            'service-process-cgroup-mismatch')
    value = {'host': expected_host, 'boot_id': boot, 'service': service,
             'observed_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
             'roots': normalized, **process, 'service_state': before,
             'collector': 'linux-proc-systemd-v1'}
    rollback.validate_observation(value, normalized)
    installed = hashlib.sha256()
    with Path(process['executable']).open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            remaining(stop_at)
            installed.update(block)
    require(installed.hexdigest() == process['executable_sha256'],
            'running-executable-differs-from-installed')
    require(process_state(process['pid'], stop_at) == process,
            'host-process-changed-during-observation')
    require(service_state(service, stop_at) == before,
            'host-service-changed-during-observation')
    require(Path('/proc/sys/kernel/random/boot_id').read_text().strip() == boot,
            'host-boot-changed-during-observation')
    remaining(stop_at)
    return value


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--expected-host', required=True)
    parser.add_argument('--service', required=True)
    parser.add_argument('--roots-json', required=True)
    parser.add_argument('--stop-at-ms', required=True, type=int)
    args = parser.parse_args()
    # The supervisor's absolute JS deadline, not a fresh per-call budget.
    result = collect(args.expected_host, args.service,
                     json.loads(Path(args.roots_json).read_text()), args.stop_at_ms / 1000)
    print(json.dumps(result, sort_keys=True))


if __name__ == '__main__':
    main()
