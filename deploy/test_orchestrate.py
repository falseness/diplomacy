"""Production-shaped disposable adapter. systemd/source/package are explicit mocks;
real transaction, config links, backup BSON validation and HTTP asset fetching.
Real service/gameplay evidence is acquired separately by test_live_fixture.js.
"""
import contextlib
from datetime import datetime, timezone
import functools
import http.server
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch
import candidate
import orchestrate as o
import source
from test_activate import Fixture

OUT = Path(sys.argv.pop(1)).resolve()
OUT.mkdir(parents=True, exist_ok=True)

class Deployment(o.Deployment):
    def __init__(self, root, failure=None):
        self.output = root
        self.host = Fixture(root, failure='backup' if failure == 'backup' else 'web-switch' if failure == 'activation' else None)
        self.root, self.manifest, self.record = self.host.candidate, self.host.manifest, self.host.record
        self.failure = failure
        self.cleanup_status = {'status': 'not-needed'}

    def prepare(self):
        if self.failure == 'package': raise RuntimeError('injected package failure')
        for name, content in [('index.html', '<script src="options/googleAuth.js"></script><script src="options/version.js"></script>'),
                              ('options/googleAuth.js', "const GOOGLE_CLIENT_ID = 'fixture-google-id';"),
                              ('options/version.js', "const RULES_VERSION = 'fixture-version';")]:
            p = self.root / 'diplomacy' / name
            p.parent.mkdir(parents=True, exist_ok=True); p.write_text(content)
        self.identity = {'files': candidate.inventory(self.root), 'repositories': {},
                         'runtime': {'fixture': 'fake service executable; actual tests run Node 20.20.2'}}
        for name, root in [('diplomacy', '/root/diplomacy'), ('diplomacy_server', '/root/diplomacy_server')]:
            self.identity['repositories'][name] = {'sources': {}, 'revision': subprocess.check_output(['git','-C',root,'rev-parse','HEAD'],text=True).strip(),
                'branch': subprocess.check_output(['git','-C',root,'branch','--show-current'],text=True).strip()}
        self.manifest.write_text(json.dumps(self.identity))
        return self.identity

    def isolated(self):
        if self.failure == 'preactivation-smoke': raise RuntimeError('injected preactivation smoke failure')
        return {'status': 'pass', 'mock': 'preactivation suite scheduling; original real suites independently tested'}

    def endpoint(self):
        if self.failure == 'endpoint': raise RuntimeError('injected endpoint failure')
        return {'status': 'pass', 'mock': 'endpoint handshake tested separately by test_endpoint.js'}

    def baseline(self):
        self.before = {'fixture-existing': {'ok': True, 'documentHash': 'same'}}
        return {'status': 'pass', 'mock': 'existing game baseline; real service check separately recorded'}

    def admission(self):
        return {'status': 'pass', 'mock': 'namespace admission; real policy exercised by test_live_fixture'}

    def verification(self):
        if self.failure == 'live-timeout':
            o.live.run([sys.executable, '-c', 'import time;time.sleep(30)'], OUT/'timeout-child.log', timeout=0.2)
        if self.failure == 'live-verification': raise RuntimeError('injected live-verification failure')
        handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(self.root / 'diplomacy'))
        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        try:
            assets = o.live.assets(self.root, self.identity, 'http://127.0.0.1:' + str(server.server_port),
                                  'fixture-google-id', OUT / 'public-assets.json')
            # Negative control: actual served bytes must match every fetched manifest hash.
            p = self.root / 'diplomacy/options/version.js'; prior = p.read_bytes(); p.write_text('wrong version')
            try:
                o.live.assets(self.root, self.identity, 'http://127.0.0.1:' + str(server.server_port), 'fixture-google-id', OUT / 'unexpected.json')
                raise AssertionError('mismatch accepted')
            except RuntimeError as e: assert 'Served file mismatch' in str(e)
            finally: p.write_bytes(prior)
            print('PASS public-assets actual HTTP corrupted version rejected')
        finally:
            server.shutdown(); server.server_close(); thread.join()
        return {'status': 'pass', 'assets': assets, 'existing_games': o.live.compare_games(self.before, self.before),
                'gameplay': 'real isolated TLS/Socket.IO/Mongo evidence in verification.log; not systemd-host gameplay'}

    def cleanup(self):
        self.host.assert_preserved(unittest.TestCase())
        return {'status': 'pass', 'scope': 'fixture DB and unrelated records preserved; real smoke cleanup separately tested'}

class Tests(unittest.TestCase):
    def test_recovery_handoff(self):
        with tempfile.TemporaryDirectory() as tmp:
            d = Deployment(Path(tmp)); d.host.recovery_hold = True
            result = o.execute(d)
            self.assertEqual(result['status'], 'maintenance')
            self.assertEqual(result['stages']['activation']['status'], 'maintenance')
            self.assertEqual(result['stages']['live-verification']['status'], 'deferred')
            self.assertFalse(d.host.running)
            self.assertNotIn('start', d.host.events)
            self.assertEqual(result['rollback']['status'], 'not-needed')
            print('PASS TASK-860 handoff remains closed; live verification deferred to TASK-861')

    def test_success(self):
        with tempfile.TemporaryDirectory() as tmp:
            d = Deployment(Path(tmp))
            # Exercise default source entrypoint wiring while mocking only remote source operations.
            with patch.object(source, 'LOCK', Path(tmp)/'lock'), patch.object(source, 'preflight'), \
                 patch.object(source, 'inspect', return_value={'branch':'fixture','before':'0'*40}), \
                 patch.object(source, 'pull') as pull, patch.object(source, 'finish', side_effect=lambda c,s: 0 if o.execute(d)['status']=='complete' else 1):
                self.assertEqual(source.main([], Path('/root/diplomacy')), 0)
                self.assertEqual(pull.call_count, 2)
            result = json.loads((d.output/'result.json').read_text())
            self.assertEqual(list(result['stages']), ['package','preactivation-smoke','endpoint','baseline','smoke-admission','activation','live-verification'])
            self.assertEqual(result['status'], 'complete')
            self.assertEqual(d.host.active, d.root)
            receipt = next(d.host.backups.glob('gameDB-*/validated.json'))
            result['fixture_backup'] = json.loads(receipt.read_text())
            (OUT/'result.json').write_text(json.dumps(result,indent=2)+'\n')
            print('PASS full fixture deployment: default source wiring paired pulls, exact manifest identities, all stages and cleanup; mocks explicitly labeled')

    def test_failures(self):
        for failure in ['package','preactivation-smoke','endpoint','backup','activation','live-verification','live-timeout']:
            with tempfile.TemporaryDirectory() as tmp:
                d = Deployment(Path(tmp), failure)
                before = (os.readlink(d.host.web), d.host.owned.read_bytes(), d.host.db.read_bytes())
                result = o.execute(d)
                self.assertEqual(result['status'],'failed')
                self.assertEqual((os.readlink(d.host.web), d.host.owned.read_bytes(), d.host.db.read_bytes()), before)
                if failure in ('backup','activation','live-verification','live-timeout'):
                    self.assertEqual(result['rollback']['status'],'restored')
                    d.host.assert_restored(self)
                else: self.assertEqual(result['rollback']['status'],'not-needed')
                if failure == 'endpoint':
                    self.assertEqual(list(result['stages']), ['package', 'preactivation-smoke'])
                    self.assertFalse(list(d.host.backups.glob('gameDB-*')))
                    self.assertFalse(d.record.exists())
                    print('PASS wrong endpoint stops before baseline/admission/backup/service stop/activation')
                self.assertEqual(result['cleanup']['status'],'pass')
                print('PASS failure-matrix '+failure+' prior fixture unchanged; cleanup recorded; rollback='+result['rollback']['status']+' original='+json.dumps(result['failure']))
        for failure in ['source','pull']:
            with tempfile.TemporaryDirectory() as tmp, patch.object(source,'LOCK',Path(tmp)/'lock'), patch.object(source,'preflight'), \
                 patch.object(source,'inspect',return_value={'branch':'fixture','before':'0'*40},side_effect=RuntimeError('source') if failure=='source' else None), \
                 patch.object(source,'pull',side_effect=RuntimeError('pull')), patch.object(source,'finish') as finish:
                with self.assertRaises(RuntimeError): source.main([], Path('/root/diplomacy'))
                finish.assert_not_called()
                print('PASS failure-matrix '+failure+' no activation; production fixture unchanged (source adapter mock; real Git regression log separate)')

if __name__ == '__main__': unittest.main()
