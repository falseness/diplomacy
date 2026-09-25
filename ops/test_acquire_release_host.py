"""Real loopback SSH authentication; remote systemd attribution is a fixture."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import socket
import subprocess
import tempfile
import time
import unittest
from unittest.mock import patch

import acquire_release_host as transport


class AuthenticatedHost(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory(prefix='release-ssh-')
        cls.addClassCleanup(cls.tmp.cleanup)
        cls.root = Path(cls.tmp.name)
        cls.children = []
        cls.addClassCleanup(cls.cleanup_processes)
        for name in ('host', 'user', 'wrong'):
            subprocess.run(['/usr/bin/ssh-keygen', '-q', '-t', 'ed25519', '-N', '',
                            '-f', str(cls.root / name)], check=True, capture_output=True)
        cls.roots = {role: str(cls.root / role) for role in
                     ('client', 'server', 'web', 'runtime', 'config')}
        for root in cls.roots.values():
            Path(root).mkdir()
        cls.cwd = Path(cls.roots['server']) / 'server'
        cls.cwd.mkdir()
        cls.exe = Path(cls.roots['runtime']) / 'sleep'
        shutil.copy2('/bin/sleep', cls.exe)
        child = subprocess.Popen([str(cls.exe), '180'], cwd=cls.cwd)
        cls.children.append(child)
        groups = [s.split(':', 2) for s in Path(f'/proc/{child.pid}/cgroup').read_text().splitlines()]
        group = next(g for h, c, g in groups if h == '0' or 'name=systemd' in c.split(','))
        cls.source = cls.root / 'source'
        cls.source.mkdir()
        for name in transport.CLOSURE:
            shutil.copyfile(Path(transport.__file__).with_name(name + '.py'), cls.source / (name + '.py'))
        # The transport itself and /proc collection are real. No running systemd
        # service is claimed; this is an explicit fixture attribution.
        fixture = dict(MainPID=str(child.pid), ActiveState='active', SubState='running', ControlGroup=group)
        with (cls.source / 'observe_release_host.py').open('a') as f:
            f.write('\ndef service_state(service, stop_at):\n    return ' + repr(fixture) + '\n')
        cls.hashes = {n: transport.digest((cls.source / (n + '.py')).read_bytes()) for n in transport.CLOSURE}
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            cls.port = sock.getsockname()[1]
        cls.known = cls.root / 'known_hosts'
        cls.known.write_text(f'[127.0.0.1]:{cls.port} ' + (cls.root / 'host.pub').read_text())
        config = cls.root / 'sshd_config'
        config.write_text(f'''Port {cls.port}
ListenAddress 127.0.0.1
HostKey {cls.root / 'host'}
PidFile {cls.root / 'sshd.pid'}
AuthorizedKeysFile {cls.root / 'user.pub'}
StrictModes no
PermitRootLogin prohibit-password
PasswordAuthentication no
KbdInteractiveAuthentication no
UsePAM no
AllowUsers root
AllowTcpForwarding no
X11Forwarding no
''')
        log = (cls.root / 'sshd.log').open('wb')
        cls.addClassCleanup(log.close)
        cls.daemon = subprocess.Popen(['/usr/sbin/sshd', '-D', '-e', '-f', str(config)],
                                      stdout=log, stderr=log, start_new_session=True)
        cls.children.append(cls.daemon)
        for _ in range(100):
            if cls.daemon.poll() is not None:
                raise RuntimeError((cls.root / 'sshd.log').read_text())
            try:
                with socket.create_connection(('127.0.0.1', cls.port), timeout=.1):
                    break
            except OSError:
                time.sleep(.02)
        else:
            raise RuntimeError('owned sshd did not listen')
        cls.sentinel = cls.root / 'unrelated-game'
        cls.sentinel.write_text('unchanged')

    @classmethod
    def cleanup_processes(cls):
        for child in reversed(cls.children):
            if child.poll() is None:
                if child is getattr(cls, 'daemon', None):
                    os.killpg(child.pid, signal.SIGTERM)
                else:
                    child.terminate()
            child.wait(timeout=5)
            assert not Path(f'/proc/{child.pid}').exists()
            print('PASS owned-process-cleanup absent=true')
        if hasattr(cls, 'sentinel'):
            assert cls.sentinel.read_text() == 'unchanged'
            print('PASS unrelated-game-sentinel unchanged=true')

    def acquire(self, **overrides):
        args = dict(host='127.0.0.1', port=self.port, user='root',
                    identity=str(self.root / 'user'), known_hosts=str(self.known),
                    known_hosts_sha256=transport.digest(self.known.read_bytes()),
                    expected_host=socket.gethostname(), service='fixture.service',
                    roots=self.roots, stop_at=time.time() + 15, collector_hashes=self.hashes)
        args.update(overrides)
        with patch.object(transport, '__file__', str(self.source / 'acquire_release_host.py')):
            return transport.acquire(**args)

    def test_authenticated_collection(self):
        receipt = self.acquire()
        self.assertEqual(receipt['observation']['pid'], self.children[0].pid)
        self.assertEqual(receipt['observation']['executable_sha256'], transport.digest(self.exe.read_bytes()))
        self.assertEqual(receipt['transport']['collectorHashes'], self.hashes)
        self.assertEqual(receipt['transport']['exit'], 0)
        self.assertFalse(receipt['releaseReady'])
        self.assertEqual(receipt['databaseActions'], [])
        self.assertEqual(receipt['serviceActions'], [])
        self.assertNotIn('PRIVATE KEY', json.dumps(receipt))
        print('PASS authenticated-loopback exact-pid/executable/hash=true systemd=fixture releaseReady=false')

    def test_untrusted_server_key(self):
        wrong = self.root / 'wrong_hosts'
        wrong.write_text(f'[127.0.0.1]:{self.port} ' + (self.root / 'wrong.pub').read_text())
        with self.assertRaisesRegex(ValueError, 'authenticated-host-command-failed:255'):
            self.acquire(known_hosts=str(wrong), known_hosts_sha256=transport.digest(wrong.read_bytes()))
        print('PASS untrusted-server-key rejected=255')

    def test_untrusted_user_key(self):
        with self.assertRaisesRegex(ValueError, 'authenticated-host-command-failed:255'):
            self.acquire(identity=str(self.root / 'wrong'))
        print('PASS untrusted-user-key rejected=255')

    def test_changed_pinned_inputs(self):
        for overrides, reason in [(dict(known_hosts_sha256='0'*64), 'changed-ssh-host-pin'),
                                  (dict(collector_hashes={}), 'changed-host-collector')]:
            with patch.object(subprocess, 'run') as run:
                with self.assertRaisesRegex(ValueError, reason):
                    self.acquire(**overrides)
                run.assert_not_called()
        print('PASS changed-pinned-inputs remote-commands=0')

    def test_remote_collector_failure(self):
        with self.assertRaisesRegex(ValueError, 'authenticated-host-command-failed:1'):
            self.acquire(expected_host='not-the-observed-host')
        print('PASS remote-collector-failure rejected=1')

    def test_expired_deadline(self):
        with patch.object(subprocess, 'run') as run:
            with self.assertRaisesRegex(ValueError, 'host-observation-deadline'):
                self.acquire(stop_at=time.time() - 1)
            run.assert_not_called()
        print('PASS expired-deadline remote-commands=0')

    def test_injection_and_unsafe_key(self):
        for args, reason in [(dict(host='127.0.0.1;false'), 'invalid-ssh-host'),
                             (dict(user='-oProxyCommand=false'), 'invalid-ssh-user'),
                             (dict(port=True), 'invalid-ssh-port')]:
            with self.assertRaisesRegex(ValueError, reason):
                self.acquire(**args)
        key = self.root / 'public-readable-key'
        shutil.copyfile(self.root / 'user', key)
        key.chmod(0o644)
        with self.assertRaisesRegex(ValueError, 'unsafe-ssh-private-key'):
            self.acquire(identity=str(key))
        print('PASS injection-and-key-permissions rejected=true')


if __name__ == '__main__':
    unittest.main(verbosity=2)
