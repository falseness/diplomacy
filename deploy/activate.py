#!/usr/bin/env python3
"""Standalone activation and code rollback. Run under an exclusive deployment lock.
Health and existing-game probes must be read-only, bounded, local executables.
No database restore is ever performed. Source orchestration remains separate.
"""
import argparse
import fcntl
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import tempfile
from candidate import verify, runtime


class Interrupted(RuntimeError):
    pass


def atomic_file(path, data, mode=0o600, uid=None, gid=None):
    fd, name = tempfile.mkstemp(prefix='.' + path.name + '-', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as out:
            out.write(data); out.flush(); os.fsync(out.fileno())
            os.fchmod(out.fileno(), mode)
            if uid is not None: os.fchown(out.fileno(), uid, gid)
        os.replace(name, path)
    finally:
        if os.path.lexists(name): os.unlink(name)


def atomic_link(path, target):
    fd, name = tempfile.mkstemp(prefix='.' + path.name + '-', dir=path.parent)
    os.close(fd); os.unlink(name)
    try:
        os.symlink(target, name)
        os.replace(name, path)
    finally:
        if os.path.lexists(name): os.unlink(name)


class Host:
    def __init__(self, backups, health, games, web=Path('/var/www/html'),
                 owned=Path('/etc/systemd/system/diplomacy-server.service.d/99-zz-diplomacy-release.conf')):
        self.backups, self.health, self.games = backups, health, games
        self.web, self.owned = web, owned
        self.service = 'diplomacy-server.service'

    def command(self, args, timeout=120):
        # Do not expose command output: unit environments and probe diagnostics may contain secrets.
        child = None
        try:
            child = subprocess.Popen(list(map(str, args)), stdout=subprocess.PIPE,
                                     stderr=subprocess.PIPE, start_new_session=True)
            out, _ = child.communicate(timeout=timeout)
            if child.returncode:
                raise RuntimeError('Command failed: ' + Path(str(args[0])).name +
                                   ' exit=' + str(child.returncode))
            return out.decode()
        except BaseException as error:
            # A interrupted backup's mongodump grandchild must also stop before restart.
            if child is not None:
                try: os.killpg(child.pid, signal.SIGKILL)
                except ProcessLookupError: pass
                child.wait()
            if isinstance(error, (subprocess.SubprocessError, OSError)):
                raise RuntimeError('Command failed: ' + Path(str(args[0])).name) from None
            raise
        finally:
            if child is not None:
                child.stdout.close(); child.stderr.close()

    def ctl(self, *args):
        return self.command(['systemctl', *args, self.service])

    def properties(self):
        return dict(line.split('=', 1) for line in self.ctl('show').splitlines() if '=' in line)

    def process(self):
        p = self.properties()
        pid = int(p['MainPID'])
        if p['ActiveState'] != 'active' or pid <= 0: raise RuntimeError('Service not active')
        return {'cwd': os.readlink('/proc/%s/cwd' % pid),
                'exe': os.readlink('/proc/%s/exe' % pid)}

    def configuration(self):
        p = self.properties()
        # ExecStart's show value also embeds the last PID/timestamps/exit status.
        # Those change on restart; only compare its stable executable/arguments.
        p['ExecStart'] = re.sub(r'; (?:start_time|stop_time|pid|code|status)=[^;}]*',
                                '', p.get('ExecStart', ''))
        # cat preserves every setting, including unrelated drop-ins and secret references.
        return {'unit': self.ctl('cat'), 'effective': {k: p.get(k) for k in
                ['ExecStart', 'WorkingDirectory', 'Environment', 'EnvironmentFiles',
                 'User', 'Group', 'FragmentPath', 'DropInPaths', 'KillMode']}}

    def quiescent(self):
        p = self.properties()
        if p.get('ActiveState') not in ('inactive', 'failed') or p.get('MainPID') != '0':
            raise RuntimeError('Service not quiescent')
        group = p.get('ControlGroup')
        if group:
            root = Path('/sys/fs/cgroup') / group.lstrip('/')
            for procs in root.rglob('cgroup.procs'):
                if procs.read_text().strip(): raise RuntimeError('Service child writers remain')

    def validate(self, candidate, manifest):
        data = json.loads(manifest.read_text())
        if set(data['repositories']) != {'diplomacy', 'diplomacy_server'}:
            raise RuntimeError('Missing repository identities')
        for info in data['repositories'].values():
            if not re.fullmatch('[0-9a-f]{40}', info['revision']) or not info['sources']:
                raise RuntimeError('Invalid repository identity')
        verify(candidate, data)
        actual = runtime(candidate / 'runtime')
        if any(data['runtime'].get(k) != v for k, v in actual.items()):
            raise RuntimeError('Runtime identity mismatch')
        for relative in ['diplomacy/index.html', 'diplomacy_server/server/index.js',
                         'diplomacy_server/server/node_modules/mongodb']:
            if not (candidate / relative).exists(): raise RuntimeError('Missing activation prerequisite')

    def preflight(self):
        if not self.web.is_symlink() or not self.web.resolve().is_dir():
            raise RuntimeError('Web target must be an existing release symlink')
        if not self.owned.parent.is_dir(): raise RuntimeError('Missing service override directory')
        if self.owned.is_symlink() or (self.owned.exists() and not self.owned.is_file()):
            raise RuntimeError('Owned override must be regular')
        p = self.properties()
        if p.get('KillMode') not in ('control-group', 'mixed'):
            raise RuntimeError('Service must stop all child writers')
        # Refuse any later drop-in, including ones in /run or /usr/lib. Never delete foreign config.
        for name in p.get('DropInPaths', '').split():
            other = Path(name)
            if other.name >= self.owned.name and other != self.owned:
                raise RuntimeError('Competing later-sorting drop-in')
        for executable in [self.health, self.games, Path('/usr/bin/systemctl')]:
            if not executable.is_file() or not os.access(executable, os.X_OK):
                raise RuntimeError('Missing executable prerequisite')
        for tool in ['mongosh', 'mongodump']:
            import shutil
            if not shutil.which(tool): raise RuntimeError('Missing backup tool')
        self.backups.mkdir(mode=0o700, parents=True, exist_ok=True)
        for directory in [self.backups, self.owned.parent, self.web.parent]:
            if not os.access(directory, os.W_OK): raise RuntimeError('Target is not writable')

    def backup(self, candidate):
        self.quiescent()
        helper = Path(__file__).with_name('backup.js')
        script = "const b=require(process.argv[1]);const {BSON}=require(process.argv[3]+'/diplomacy_server/server/node_modules/mongodb');const r=b.backup({directory:process.argv[2],quiesced:true,BSON});b.verifyBackup(r.path);console.log('BACKUP_RECEIPT '+JSON.stringify(r));"
        output = self.command([candidate / 'runtime/bin/node', '-e', script, helper, self.backups, candidate], timeout=1800)
        self.backup_receipt = json.loads(next(line.removeprefix('BACKUP_RECEIPT ') for line in output.splitlines() if line.startswith('BACKUP_RECEIPT ')))
        self.quiescent()

    def probe(self, games=False):
        self.command([self.games if games else self.health], timeout=60)

    def reload(self):
        self.command(['systemctl', 'daemon-reload'])

    def checkpoint(self, stage):
        pass  # Internal fixture failure injection; no public failure switches.


def snapshot(host):
    stat = host.owned.stat() if host.owned.exists() else None
    return {'process': host.process(), 'configuration': host.configuration(),
            'web': os.readlink(host.web),
            'owned': host.owned.read_bytes().hex() if stat else None,
            'mode': stat.st_mode & 0o777 if stat else None,
            'uid': stat.st_uid if stat else None, 'gid': stat.st_gid if stat else None}


def restore(host, before):
    errors = []
    # Independent attempts: a failed service command must not prevent restoring web/config.
    def attempt(name, fn):
        try: fn()
        except Exception: errors.append(name)
    attempt('stop', lambda: host.ctl('stop'))
    attempt('quiescence', host.quiescent)
    def config():
        if before['owned'] is None:
            host.owned.unlink(missing_ok=True)
        else:
            atomic_file(host.owned, bytes.fromhex(before['owned']), before['mode'], before['uid'], before['gid'])
    attempt('config', config)
    attempt('web', lambda: atomic_link(host.web, before['web']))
    attempt('daemon-reload', host.reload)
    attempt('start', lambda: host.ctl('start'))
    def identity():
        if host.process() != before['process'] or host.configuration() != before['configuration'] or os.readlink(host.web) != before['web']:
            raise RuntimeError('Prior identity/configuration not restored')
    attempt('identity', identity)
    attempt('health', host.probe)
    compatibility = 'compatible'
    try: host.probe(games=True)
    except Exception: compatibility = 'existing-game incompatibility; database preserved; manual investigation required'
    return {'status': 'failed' if errors else 'restored', 'errors': errors,
            'existing_games': compatibility, 'database': 'preserved; never automatically restored'}


def activate(host, candidate, manifest, record):
    stopped = False
    stage = 'preflight'
    handlers = {}
    def interrupt(signum, frame):
        raise Interrupted(signal.Signals(signum).name)
    result = {'status': 'failed', 'rollback': {'status': 'not-needed'}}
    try:
        for sig in (signal.SIGTERM, signal.SIGINT):
            handlers[sig] = signal.signal(sig, interrupt)
        if not re.fullmatch(r'/[a-zA-Z0-9_./-]+', str(candidate)):
            raise RuntimeError('Unsupported candidate path')
        host.validate(candidate, manifest)
        host.preflight()
        before = snapshot(host)
        if not all(Path(before['process'][key]).exists() for key in ('cwd', 'exe')):
            raise RuntimeError('Prior release process paths are unavailable for rollback')
        host.probe(); host.probe(games=True)
        # Private recovery record contains exact old config; never print it.
        atomic_file(record, (json.dumps(before) + '\n').encode())
        host.checkpoint('before-stop')
        stage = 'stop'
        stopped = True  # stop can change state and then fail or be interrupted
        host.ctl('stop'); host.quiescent()
        stage = 'backup'; host.checkpoint(stage); host.backup(candidate)
        stage = 'service-switch'
        # Safe literal paths only: no systemd percent specifiers, quotes or shell syntax.
        content = ('[Service]\nWorkingDirectory=%s/diplomacy_server/server\nExecStart=\nExecStart=%s/runtime/bin/node %s/diplomacy_server/server/index.js\n' % (candidate, candidate, candidate))
        # Retain any previous non-release directives even inside our owned file.
        for key, value in getattr(host, 'release_environment', {}).items():
            if not re.fullmatch(r'[A-Z_]+', key) or not re.fullmatch(r'/[a-zA-Z0-9_./-]+', value):
                raise RuntimeError('Unsupported release environment')
            content += 'Environment=' + key + '=' + value + '\n'
        prefix = bytes.fromhex(before['owned']) + b'\n' if before['owned'] is not None else b''
        atomic_file(host.owned, prefix + content.encode(), before['mode'] or 0o644,
                    before['uid'], before['gid'])
        host.checkpoint(stage)
        stage = 'web-switch'; atomic_link(host.web, str(candidate / 'diplomacy')); host.checkpoint(stage)
        stage = 'daemon-reload'; host.reload(); host.checkpoint(stage)
        stage = 'start'; host.ctl('start'); host.checkpoint(stage)
        stage = 'identity'
        if host.process() != {'cwd': str(candidate / 'diplomacy_server/server'), 'exe': str((candidate / 'runtime/bin/node').resolve())}:
            raise RuntimeError('Candidate process identity mismatch')
        if host.web.resolve() != candidate / 'diplomacy': raise RuntimeError('Candidate web mismatch')
        stage = 'health'; host.checkpoint(stage); host.probe(); host.probe(games=True)
        result['status'] = 'activated'
        result['backup'] = getattr(host, 'backup_receipt', None)
    except Exception as error:
        result['failure'] = {'stage': stage, 'reason': str(error) if isinstance(error, RuntimeError) else type(error).__name__}
        if stopped:
            # Further TERM/INT must not abort restoration halfway through.
            for sig in handlers: signal.signal(sig, signal.SIG_IGN)
            result['rollback'] = restore(host, before)
    finally:
        for sig, handler in handlers.items(): signal.signal(sig, handler)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['activate', 'rollback'])
    parser.add_argument('--candidate', type=Path)
    parser.add_argument('--manifest', type=Path)
    parser.add_argument('--record', type=Path, required=True)
    parser.add_argument('--backups', type=Path, required=True)
    parser.add_argument('--health-probe', type=Path, required=True)
    parser.add_argument('--existing-games-probe', type=Path, required=True)
    parser.add_argument('--lock', type=Path, default=Path('/home/bakharevns/.diplomacy-deploy.lock'))
    args = parser.parse_args()
    os.umask(0o077)
    host = Host(args.backups, args.health_probe, args.existing_games_probe)
    with args.lock.open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if args.action == 'activate':
            if not args.candidate or not args.manifest or args.record.exists():
                parser.error('Activation requires candidate, manifest and a fresh recovery record path')
            result = activate(host, args.candidate.resolve(), args.manifest.resolve(), args.record)
        else:
            for sig in (signal.SIGTERM, signal.SIGINT): signal.signal(sig, signal.SIG_IGN)
            result = restore(host, json.loads(args.record.read_text()))
        print(json.dumps(result))
        ok = result['status'] in ('activated', 'restored') and result.get('existing_games', 'compatible') == 'compatible'
        return 0 if ok else 1


if __name__ == '__main__':
    raise SystemExit(main())
