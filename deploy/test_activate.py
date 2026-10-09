#!/usr/bin/env python3
"""Disposable stateful service/web/DB adapter; real transaction, atomic writes,
manifest hashing and TASK-775 BSON backup/receipt validation. No live service.
"""
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import activate as a
from candidate import inventory, verify


class Fixture(a.Host):
    def __init__(self, root, failure=None, rollback_failure=None, owned=True):
        self.root, self.failure, self.rollback_failure = root, failure, rollback_failure
        self.events, self.rolling_back = [], False
        self.old = root / 'old'; self.old.mkdir()
        self.candidate = root / 'new'; self.candidate.mkdir()
        for release in (self.old, self.candidate):
            for name in ('diplomacy', 'diplomacy_server/server', 'runtime/bin'):
                (release / name).mkdir(parents=True, exist_ok=True)
            (release / 'runtime/bin/node').write_text('fixture executable identity')
        self.active = self.old
        self.running = True
        web = root / 'html'; web.symlink_to('old/diplomacy')
        config = root / 'service.d'; config.mkdir()
        (config / '10-unrelated.conf').write_text('[Service]\nEnvironment=KEEP_SECRET=unchanged\nRestart=always\n')
        super().__init__(root / 'backups', root / 'health', root / 'games', web, config / '99-zzz-diplomacy-release.conf')
        if owned:
            self.owned.write_text('[Service]\n# prior owned settings\nEnvironment=OWNED_KEEP=private\nWorkingDirectory=' + str(self.old / 'diplomacy_server/server') + '\n')
            self.owned.chmod(0o640)
        self.original_owned = self.owned.read_bytes() if owned else None
        self.db = root / 'db.json'; self.db.write_text('[{"_id":1,"format":"existing"}]')
        self.db_initial = self.db.read_bytes()
        self.backups.mkdir(); (self.backups / 'old-backup').write_text('retain')
        self.manifest = root / 'manifest.json'
        self.manifest.write_text(json.dumps({'files': inventory(self.candidate), 'repositories': {}}))
        self.record = root / 'recovery.json'

    def validate(self, candidate, manifest):
        verify(candidate, json.loads(manifest.read_text()))
        if self.failure == 'validate': raise RuntimeError('injected invalid identity')

    def preflight(self):
        # Use the shipped preflight, with disposable tool prerequisites.
        self.health.write_text('#!/bin/sh\nexit 0\n'); self.health.chmod(0o700)
        self.games.write_text('#!/bin/sh\nexit 0\n'); self.games.chmod(0o700)
        with patch('shutil.which', return_value='/fixture/tool'):
            super().preflight()

    def properties(self):
        return {'MainPID': '42' if self.running else '0', 'ActiveState': 'active' if self.running else 'inactive',
                'KillMode': 'control-group', 'DropInPaths': ' '.join(str(p) for p in sorted(self.owned.parent.glob('*.conf')))}

    def configuration(self):
        return {'unit': {p.name: p.read_text() for p in self.owned.parent.glob('*.conf')},
                'effective': {'Environment': 'KEEP_SECRET=unchanged'}}

    def process(self):
        if not self.running: raise RuntimeError('not running')
        return {'cwd': str(self.active / 'diplomacy_server/server'), 'exe': str(self.active / 'runtime/bin/node')}

    def ctl(self, action):
        self.events.append(('rollback-' if self.rolling_back else '') + action)
        if action == 'stop':
            self.running = False
            if self.failure == 'stop' and not self.rolling_back:
                self.rolling_back = True; raise RuntimeError('stop failed after mutation')
        elif action == 'start':
            if self.rolling_back and self.rollback_failure == 'start': raise RuntimeError('rollback start failure')
            if not self.rolling_back and self.failure == 'start-command':
                self.rolling_back = True; raise RuntimeError('start failure')
            self.running = True
            self.active = self.candidate if self.owned.exists() and str(self.candidate) in self.owned.read_text() else self.old

    def reload(self):
        self.events.append('reload')
        if not self.rolling_back and self.failure == 'reload-command':
            self.rolling_back = True; raise RuntimeError('reload failure')

    def backup(self, candidate):
        self.quiescent()
        # Real backup helper runs on a disposable JSON DB serialized as BSON by fake Mongo tools.
        dump = self.root / 'mongodump'; shell = self.root / 'mongosh'
        module = '/root/diplomacy_server/server/node_modules/mongodb'
        shell.write_text('#!/bin/sh\necho \'{"games":1}\'\n'); shell.chmod(0o700)
        dump.write_text('#!/usr/local/bin/node20\n' + ('process.exit(7);\n' if self.failure == 'backup-command' else '') + '''const fs=require('fs'),path=require('path');
const {BSON}=require(%s);const data=JSON.parse(fs.readFileSync(%s));
const dest=path.join(process.argv[process.argv.indexOf('--out')+1],'gameDB');fs.mkdirSync(dest);
fs.writeFileSync(path.join(dest,'games.bson'),Buffer.concat(data.map(x=>BSON.serialize(x))));
fs.writeFileSync(path.join(dest,'games.metadata.json'),'{}');
''' % (json.dumps(module), json.dumps(str(self.db)))); dump.chmod(0o700)
        script = "const b=require(process.argv[1]),{BSON}=require(process.argv[2]);const r=b.backup({directory:process.argv[3],quiesced:true,BSON,mongosh:process.argv[4],mongodump:process.argv[5]});b.verifyBackup(r.path);"
        out = subprocess.run(['/usr/local/bin/node20', '-e', script, str(Path(a.__file__).with_name('backup.js')), module, str(self.backups), str(shell), str(dump)], capture_output=True, text=True)
        if out.returncode:
            self.rolling_back = True
            raise RuntimeError('Backup command failed: mongodump')
        self.events.append('validated-backup')
        self.quiescent()

    def probe(self, games=False):
        if not self.running: raise RuntimeError('health: service down')
        if self.rolling_back and self.rollback_failure == ('games' if games else 'health'):
            raise RuntimeError('rollback probe failure')
        if self.active == self.candidate and self.failure == 'health-command':
            self.rolling_back = True; raise RuntimeError('initial health failure')

    def checkpoint(self, stage):
        self.events.append(stage)
        if self.failure == stage:
            self.rolling_back = True
            raise RuntimeError('injected failure')
        if self.failure in ('TERM-' + stage, 'INT-' + stage):
            self.rolling_back = True
            os.kill(os.getpid(), signal.SIGTERM if self.failure.startswith('TERM') else signal.SIGINT)

    def run(self):
        return a.activate(self, self.candidate, self.manifest, self.record)

    def assert_preserved(self, test):
        test.assertEqual(self.db.read_bytes(), self.db_initial)
        test.assertEqual((self.backups / 'old-backup').read_text(), 'retain')
        test.assertTrue(self.old.is_dir())
        test.assertEqual((self.owned.parent / '10-unrelated.conf').read_text(), '[Service]\nEnvironment=KEEP_SECRET=unchanged\nRestart=always\n')
        test.assertFalse(any('restore' in e for e in self.events))

    def assert_restored(self, test):
        test.assertTrue(self.running)
        test.assertEqual(self.active, self.old)
        test.assertEqual(os.readlink(self.web), 'old/diplomacy')
        test.assertEqual(self.owned.read_bytes() if self.owned.exists() else None, self.original_owned)
        if self.original_owned is not None: test.assertEqual(self.owned.stat().st_mode & 0o777, 0o640)
        test.assertEqual(self.configuration(), json.loads(self.record.read_text())['configuration'])
        test.assertEqual(self.process(), json.loads(self.record.read_text())['process'])
        self.assert_preserved(test)


class ActivationTests(unittest.TestCase):
    def test_success(self):
        with tempfile.TemporaryDirectory() as temp:
            h = Fixture(Path(temp)); result = h.run()
            self.assertEqual(result['status'], 'activated')
            self.assertEqual(h.active, h.candidate)
            self.assertIn('Environment=OWNED_KEEP=private', h.owned.read_text())
            self.assertEqual(h.web.resolve(), h.candidate / 'diplomacy')
            self.assertLess(h.events.index('validated-backup'), h.events.index('service-switch'))
            self.assertEqual(len(list(h.backups.glob('gameDB-*/validated.json'))), 1)
            h.assert_preserved(self)
            print('PASS success: candidate process/web; fresh validated backup before switch; DB/unrelated targets retained')

    def test_failures(self):
        failures = ['validate', 'before-stop', 'stop', 'backup', 'backup-command', 'service-switch', 'web-switch', 'daemon-reload',
                    'reload-command', 'start', 'start-command', 'health', 'health-command',
                    'TERM-before-stop', 'INT-before-stop', 'TERM-backup', 'INT-backup',
                    'TERM-service-switch', 'INT-web-switch']
        for failure in failures:
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as temp:
                h = Fixture(Path(temp), failure); result = h.run()
                self.assertEqual(result['status'], 'failed')
                self.assertIn('failure', result)
                if failure in ('validate', 'before-stop', 'TERM-before-stop', 'INT-before-stop'):
                    self.assertEqual(result['rollback']['status'], 'not-needed')
                    self.assertNotIn('stop', h.events); self.assertTrue(h.running)
                    self.assertEqual(h.active, h.old); self.assertEqual(os.readlink(h.web), 'old/diplomacy')
                else:
                    self.assertEqual(result['rollback']['status'], 'restored'); h.assert_restored(self)
                h.assert_preserved(self)
                print('PASS injected ' + failure + ': actual state verified ' + json.dumps(result) + ' events=' + json.dumps(h.events) + ' state=' + json.dumps({'running':h.running,'process':h.process(),'web':os.readlink(h.web),'database_unchanged':h.db.read_bytes()==h.db_initial}))


class RollbackTests(unittest.TestCase):
    def test_failures(self):
        for failure in ['start', 'health', 'games']:
            with tempfile.TemporaryDirectory() as temp:
                h = Fixture(Path(temp), 'web-switch', failure); result = h.run()
                self.assertEqual(result['status'], 'failed')  # CLI nonzero even if rollback succeeds
                self.assertEqual(result['failure'], {'stage': 'web-switch', 'reason': 'injected failure'})
                if failure == 'games':
                    self.assertEqual(result['rollback']['status'], 'restored')
                    self.assertIn('existing-game incompatibility', result['rollback']['existing_games'])
                else: self.assertEqual(result['rollback']['status'], 'failed')
                self.assertEqual(os.readlink(h.web), 'old/diplomacy')
                self.assertEqual(h.owned.read_bytes(), h.original_owned)
                h.assert_preserved(self)
                print('PASS rollback-' + failure + ': original failure retained; nonzero deployment result; DB preserved ' + json.dumps(result))

    def test_cli_nonzero(self):
        for failure in ('start', 'health'):
            with tempfile.TemporaryDirectory() as temp:
                h = Fixture(Path(temp), 'web-switch', failure)
                argv = ['activate.py', 'activate', '--candidate', str(h.candidate),
                        '--manifest', str(h.manifest), '--record', str(h.record),
                        '--backups', str(h.backups), '--health-probe', str(h.health),
                        '--existing-games-probe', str(h.games), '--lock', str(h.root / 'lock')]
                with patch.object(sys, 'argv', argv), patch('activate.Host', return_value=h):
                    self.assertEqual(a.main(), 1)
                h.assert_preserved(self)
                print('PASS actual CLI exit=1 for rollback-' + failure + '; original error plus independent rollback failure')

    def test_explicit_rollback(self):
        with tempfile.TemporaryDirectory() as temp:
            h = Fixture(Path(temp)); self.assertEqual(h.run()['status'], 'activated')
            # Simulate a new-format real-game write. Rollback never replaces it with backup.
            h.db.write_text('[{"_id":1,"format":"new-write"}]'); h.db_initial = h.db.read_bytes()
            h.rolling_back = True
            result = a.restore(h, json.loads(h.record.read_text()))
            self.assertEqual(result['status'], 'restored'); h.assert_restored(self)
            print('PASS explicit code rollback: exact effective settings/web/process/health restored; new-format DB write preserved ' + json.dumps(result))


class ConfigTests(unittest.TestCase):
    def test_legacy_override_preserved(self):
        for failure in (None, 'web-switch'):
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as temp:
                h = Fixture(Path(temp), failure, owned=False)
                default = a.Host(h.backups, h.health, h.games).owned.name
                self.assertEqual(h.owned.name, default)
                legacy = {}
                for name in ('99-zz-task680-release.conf', '99-zz-diplomacy-release.conf'):
                    path = h.owned.parent / name
                    path.write_text('[Service]\nEnvironment=LEGACY_KEEP=yes\nWorkingDirectory=' + str(h.old / 'diplomacy_server/server') + '\n')
                    path.chmod(0o640)
                    legacy[path] = (path.read_bytes(), path.stat().st_mode)
                    self.assertLess(name, default)
                result = h.run()
                if failure:
                    self.assertEqual(result['rollback']['status'], 'restored')
                    h.assert_restored(self)
                else:
                    self.assertEqual(result['status'], 'activated')
                    self.assertEqual(h.active, h.candidate)
                for path, state in legacy.items():
                    self.assertEqual((path.read_bytes(), path.stat().st_mode), state)
                print('PASS legacy drop-ins preserved; new override sorts last; ' + ('rollback restores absence and prior configuration' if failure else 'candidate activated'))

    def test_conflict(self):
        with tempfile.TemporaryDirectory() as temp:
            h = Fixture(Path(temp)); other = h.owned.parent / 'zz-foreign.conf'; other.write_text('[Service]\nExecStart=/foreign\n')
            before = h.configuration(); result = h.run()
            self.assertEqual(result['rollback']['status'], 'not-needed'); self.assertEqual(h.configuration(), before)
            self.assertNotIn('stop', h.events); h.assert_preserved(self)
            print('PASS competing later-sorting drop-in refused before stop; unrelated entries unchanged')

    def test_owned(self):
        for owned in [True, False]:
            with tempfile.TemporaryDirectory() as temp:
                h = Fixture(Path(temp), 'web-switch', owned=owned)
                self.assertEqual(h.run()['rollback']['status'], 'restored'); h.assert_restored(self)
                print('PASS existing owned override=' + str(owned) + ': exact bytes/mode or absence restored; old releases/backups retained')

    def test_atomic(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); file = root / 'config'; file.write_text('old')
            link = root / 'web'; link.symlink_to('old')
            real_replace = os.replace
            def observe(src, dest):
                if dest == file: self.assertEqual(file.read_text(), 'old'); self.assertEqual(Path(src).read_text(), 'new')
                else: self.assertEqual(os.readlink(link), 'old'); self.assertEqual(os.readlink(src), 'new')
                real_replace(src, dest)
            with patch('activate.os.replace', side_effect=observe):
                a.atomic_file(file, b'new'); a.atomic_link(link, 'new')
            self.assertEqual(file.read_text(), 'new'); self.assertEqual(os.readlink(link), 'new')
            self.assertEqual(sorted(p.name for p in root.iterdir()), ['config', 'web'])
            print('PASS atomic config/link replacement: old target intact until rename; complete new target; no temporary leftovers')

    def test_effective_exec_identity(self):
        h = a.Host(Path('/unused'), Path('/unused'), Path('/unused'))
        states = ["{ path=/node ; argv[]=/node index.js ; ignore_errors=no ; start_time=old ; stop_time=old ; pid=10 ; code=exited ; status=0 }",
                  "{ path=/node ; argv[]=/node index.js ; ignore_errors=no ; start_time=new ; stop_time=new ; pid=20 ; code=running ; status=0 }"]
        with patch.object(h, 'ctl', return_value='[Service]\nEnvironment=KEEP=1'), patch.object(h, 'properties', side_effect=[{'ExecStart':v} for v in states]):
            self.assertEqual(h.configuration(), h.configuration())
        print('PASS effective executable/arguments stable across restart; volatile systemd PID/timestamps excluded')

    def test_atomic_failure(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); config = root / 'config'; config.write_text('old')
            web = root / 'web'; web.symlink_to('old')
            with patch('activate.os.replace', side_effect=OSError('rename denied')):
                with self.assertRaises(OSError): a.atomic_file(config, b'new')
                with self.assertRaises(OSError): a.atomic_link(web, 'new')
            self.assertEqual(config.read_text(), 'old'); self.assertEqual(os.readlink(web), 'old')
            self.assertEqual(sorted(p.name for p in root.iterdir()), ['config', 'web'])
            print('PASS failed atomic config/link rename preserves old targets and cleans temporary entries')

    def test_command_interruption(self):
        h = a.Host(Path('/unused'), Path('/unused'), Path('/unused'))
        def interrupt(signum, frame): raise a.Interrupted('SIGTERM')
        previous = signal.signal(signal.SIGTERM, interrupt)
        try:
            with self.assertRaises(a.Interrupted):
                h.command([sys.executable, '-c', 'import os,signal,time; os.kill(os.getppid(),signal.SIGTERM); time.sleep(30)'])
        finally: signal.signal(signal.SIGTERM, previous)
        with self.assertRaisesRegex(RuntimeError, 'exit=9'):
            h.command([sys.executable, '-c', 'import sys; print("private diagnostic"); sys.exit(9)'])
        print('PASS real child command interrupted/reaped; original SIGTERM retained; failing command exit=9 without diagnostic exposure')

    def test_production_validator(self):
        from candidate import sha
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            for name in ('diplomacy/index.html', 'diplomacy_server/server/index.js', 'runtime/bin/node'):
                file = root / name; file.parent.mkdir(parents=True, exist_ok=True); file.write_text('fixture')
            (root / 'diplomacy_server/server/node_modules/mongodb').mkdir(parents=True)
            data = {'files': inventory(root), 'runtime': {'version':'v20.20.2','node_sha256':'fixture'},
                    'repositories': {role: {'revision':'a'*40,'sources': {file:{'sha256':sha(b'fixture')}}}
                        for role,file in [('diplomacy','diplomacy/index.html'),('diplomacy_server','diplomacy_server/server/index.js')]}}
            manifest = root.parent / (root.name + '-manifest.json')
            try:
                manifest.write_text(json.dumps(data))
                h = a.Host(Path('/unused'), Path('/unused'), Path('/unused'))
                with patch('activate.runtime', return_value=data['runtime']):
                    h.validate(root, manifest)
                    data['repositories']['diplomacy']['revision'] = 'invalid'
                    manifest.write_text(json.dumps(data))
                    with self.assertRaisesRegex(RuntimeError, 'repository identity'): h.validate(root, manifest)
                    data['repositories']['diplomacy']['revision'] = 'a'*40
                    manifest.write_text(json.dumps(data))
                with patch('activate.runtime', return_value={'version':'v18','node_sha256':'wrong'}):
                    with self.assertRaisesRegex(RuntimeError, 'Runtime identity'): h.validate(root, manifest)
            finally: manifest.unlink(missing_ok=True)
            print('PASS shipped candidate validator checks complete inventory/source hashes, repository and runtime identities before stop')

    def test_recovery_holds_admission_closed(self):
        with tempfile.TemporaryDirectory() as temp:
            h = Fixture(Path(temp)); h.recovery_hold = True
            result = h.run()
            self.assertEqual(result['status'], 'maintenance')
            self.assertFalse(h.running)
            self.assertEqual(h.events.count('stop'), 1)
            self.assertNotIn('start', h.events)
            self.assertIn('validated-backup', h.events)
            h.quiescent()
            self.assertEqual(h.db.read_bytes(), h.db_initial)
            restored = a.restore(h, json.loads(h.record.read_text()))
            self.assertEqual(restored['status'], 'restored')
            print('PASS recovery maintenance: stop -> final backup -> switch -> remain stopped; rollback restores service')

    def test_corrupt_manifest(self):
        with tempfile.TemporaryDirectory() as temp:
            h = Fixture(Path(temp)); (h.candidate / 'runtime/bin/node').write_text('corrupt')
            result = h.run(); self.assertEqual(result['rollback']['status'], 'not-needed'); self.assertNotIn('stop', h.events)
            print('PASS complete manifest corruption rejected before stop; no target mutation')


if __name__ == '__main__':
    unittest.main()
