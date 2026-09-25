"""Real local /proc tests with fixture systemd responses; no public host claim."""
import contextlib
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import time
import unittest
from unittest.mock import patch

import observe_release_host as observer
import prepare_rollback as rollback


class HostObservation(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='host-observer-test-')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.roots = {role: str(self.root / role) for role in rollback.ROLES}
        for name in self.roots.values():
            Path(name).mkdir()
        self.cwd = Path(self.roots['server']) / 'server'
        self.cwd.mkdir()
        (self.cwd / 'index.js').write_text('fixture source')
        self.exe = Path(self.roots['runtime']) / 'bin/sleep'
        self.exe.parent.mkdir()
        shutil.copy2('/bin/sleep', self.exe)
        for role in ('client', 'web', 'config'):
            (Path(self.roots[role]) / 'fixture.txt').write_text(role)
        self.sentinel = self.root / 'unrelated-games'
        self.sentinel.write_text('must remain unchanged')
        self.child = subprocess.Popen([str(self.exe), '60'], cwd=self.cwd)
        self.addCleanup(self.cleanup_child)
        self.deadline = time.time() + 30
        # The process is real; only systemd's service attribution is a fixture.
        groups = [s.split(':', 2) for s in Path(f'/proc/{self.child.pid}/cgroup').read_text().splitlines()]
        group = next(g for h, c, g in groups if h == '0' or 'name=systemd' in c.split(','))
        self.state = dict(MainPID=str(self.child.pid), ActiveState='active', SubState='running', ControlGroup=group)

    def cleanup_child(self):
        if self.child.poll() is None:
            self.child.terminate()
        self.child.wait(timeout=5)
        self.assertFalse(Path(f'/proc/{self.child.pid}').exists())
        self.assertEqual(self.sentinel.read_text(), 'must remain unchanged')
        print(f'PASS owned-process-cleanup pid={self.child.pid} absent=true sentinel=unchanged')

    def collect(self, **kwargs):
        with patch.object(observer, 'service_state', return_value=self.state):
            return observer.collect(kwargs.get('host', socket.gethostname()),
                                    kwargs.get('service', 'fixture.service'),
                                    kwargs.get('roots', self.roots),
                                    kwargs.get('deadline', self.deadline))

    def test_real_process_receipt_consumed_by_retention(self):
        value = self.collect()
        self.assertEqual(value['pid'], self.child.pid)
        self.assertEqual(value['cwd'], str(self.cwd))
        self.assertEqual(value['executable'], str(self.exe))
        self.assertEqual(value['executable_sha256'], hashlib.sha256(self.exe.read_bytes()).hexdigest())
        self.assertEqual(value['process_start'], Path(f'/proc/{self.child.pid}/stat').read_text().split()[21])
        receipt = self.root / 'observation.json'
        receipt.write_text(json.dumps(value))
        with contextlib.redirect_stdout(io.StringIO()):
            result = rollback.retain(self.roots, receipt, hashlib.sha256(receipt.read_bytes()).hexdigest(),
                                     self.collect, self.root / 'retained', self.deadline)
        self.assertEqual(result['observation'], value)
        self.assertEqual(result['inventory']['runtime/bin/sleep']['sha256'], value['executable_sha256'])
        self.assertFalse(result['releaseReady'])
        self.assertEqual(result['serviceActions'], [])
        self.assertEqual(result['databaseActions'], [])
        self.assertNotIn('cmdline', value)
        self.assertNotIn('environ', value)
        print('PASS real-proc-to-retention pid/cwd/executable/start/hash=exact serviceActions=0 databaseActions=0')

    def test_wrong_host_and_unprivileged_collector(self):
        with self.assertRaisesRegex(ValueError, 'unexpected-release-host'):
            self.collect(host='not-this-host.invalid')
        with patch.object(os, 'geteuid', return_value=1234):
            with self.assertRaisesRegex(ValueError, 'host-observer-requires-root'):
                self.collect()

    def test_invalid_service_and_deadline(self):
        for name in ('--help', 'fixture.service;touch /tmp/no', '../fixture.service'):
            with self.assertRaisesRegex(ValueError, 'invalid-release-service'):
                self.collect(service=name)
        with self.assertRaisesRegex(ValueError, 'host-observation-deadline'):
            self.collect(deadline=time.time() - 1)

    def test_symlink_and_overlapping_roots(self):
        link = self.root / 'link'
        link.symlink_to(self.roots['client'])
        with self.assertRaisesRegex(ValueError, 'unsafe-host-root:client'):
            self.collect(roots=dict(self.roots, client=str(link)))
        with self.assertRaisesRegex(ValueError, 'overlapping-host-roots'):
            self.collect(roots=dict(self.roots, web=self.roots['client']))

    def test_pid_outside_service_cgroup(self):
        self.state['ControlGroup'] = '/unrelated.service'
        with self.assertRaisesRegex(ValueError, 'service-process-cgroup-mismatch'):
            self.collect()

    def test_process_outside_selected_runtime(self):
        other = self.root / 'other-runtime'
        other.mkdir()
        with self.assertRaisesRegex(ValueError, 'rollback-process-path: executable'):
            self.collect(roots=dict(self.roots, runtime=str(other)))

    def test_service_restart_during_collection(self):
        changed = dict(self.state, MainPID=str(self.child.pid + 1))
        with patch.object(observer, 'service_state', side_effect=[self.state, changed]):
            with self.assertRaisesRegex(ValueError, 'host-service-changed-during-observation'):
                observer.collect(socket.gethostname(), 'fixture.service', self.roots, self.deadline)

    def test_process_identity_change_during_collection(self):
        real = observer.process_state
        calls = []
        def altered(*args):
            value = real(*args)
            calls.append(value)
            return value if len(calls) == 1 else dict(value, process_start='0')
        with patch.object(observer, 'process_state', side_effect=altered):
            with self.assertRaisesRegex(ValueError, 'host-process-changed-during-observation'):
                self.collect()

    def test_replaced_running_executable_rejected(self):
        original = self.root / 'old-exe'
        self.exe.rename(original)
        self.exe.write_text('replacement')
        self.exe.chmod(0o755)
        # /proc/exe follows the retained old inode/path, outside runtime.
        with self.assertRaisesRegex(ValueError, 'rollback-process-path: executable'):
            self.collect()

    def test_deleted_running_executable_rejected(self):
        self.exe.unlink()
        with self.assertRaisesRegex(ValueError, 'deleted-release-process-path'):
            self.collect()

    def test_systemd_command_and_failures(self):
        output = '\n'.join(k + '=' + self.state[k] for k in observer.PROPERTIES) + '\n'
        with patch.object(subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, output, '')) as run:
            self.assertEqual(observer.service_state('fixture.service', self.deadline), self.state)
        args, kwargs = run.call_args
        self.assertEqual(args[0], ['/usr/bin/systemctl', 'show', '--no-pager',
                         '--property=MainPID,ActiveState,SubState,ControlGroup', '--', 'fixture.service'])
        self.assertGreater(kwargs['timeout'], 0)
        self.assertLessEqual(kwargs['timeout'], 30)
        self.assertNotIn('shell', kwargs)
        for bad, reason in [(output + 'MainPID=9\n', 'invalid-systemd-properties'),
                            (output.replace('active', 'inactive'), 'release-service-not-running'),
                            (output.replace(str(self.child.pid), '0'), 'invalid-service-pid')]:
            with patch.object(subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, bad, '')):
                with self.assertRaisesRegex(ValueError, reason):
                    observer.service_state('fixture.service', self.deadline)
        with patch.object(subprocess, 'run', side_effect=subprocess.CalledProcessError(1, ['systemctl'])):
            with self.assertRaises(subprocess.CalledProcessError):
                observer.service_state('fixture.service', self.deadline)
        print('PASS systemd argv=read-only deadline=remaining nonzero=propagated')


if __name__ == '__main__':
    unittest.main(verbosity=2)
