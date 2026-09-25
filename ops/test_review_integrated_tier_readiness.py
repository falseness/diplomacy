"""Real immutable archive checks; never substitute synthetic passing gameplay."""
import copy
import json
import os
import shutil
import tempfile
import unittest
from pathlib import Path
from review_integrated_tier_readiness import CASE, review, sha


class TierReadinessTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.archive = Path(os.environ['TASK225_INTEGRATED_ARCHIVE'])

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)/'archive'
        shutil.copytree(self.archive, self.root)

    def mutate(self, name, change, rehash=True, jsonl=False):
        file = self.root/name
        value = [json.loads(l) for l in file.read_text().splitlines()] if jsonl else json.loads(file.read_text())
        change(value)
        file.write_text(''.join(json.dumps(r)+'\n' for r in value) if jsonl else json.dumps(value))
        if rehash:
            coverage_file = self.root/'coverage-results.json'
            coverage = json.loads(coverage_file.read_text())
            coverage['evidenceHashes'][name] = sha(file)
            coverage_file.write_text(json.dumps(coverage))
            index_file = self.root/'evidence-hashes.json'
            index = json.loads(index_file.read_text())
            index.update({name:sha(file),'coverage-results.json':sha(coverage_file)})
            index_file.write_text(json.dumps(index))

    def reject(self, pattern):
        with self.assertRaisesRegex((ValueError,FileNotFoundError),pattern):
            review(self.root)

    def test_real_archive_remains_incomplete(self):
        report = review(self.root)
        self.assertEqual([r['id'] for r in report['missingMilestones']], ['full-reloaded-state/p0','full-reloaded-state/p1'])
        self.assertFalse(report['readyForSupplement'])
        self.assertEqual(report['wholeCriteriaClosed'],[])
        self.assertGreater(len(report['checks']),200)

    def test_missing_raw_trace(self):
        (self.root/CASE/'network-trace.jsonl').unlink()
        self.reject('network-trace')

    def test_tampered_raw_observation(self):
        self.mutate('browser-results.json',lambda r:r['rows'][0]['observed'].update(name='forged'),rehash=False)
        self.reject('changed-proof')

    def test_rehashed_wrong_stats(self):
        self.mutate('browser-results.json',lambda r:r['rows'][0]['observed'].update(name='forged'))
        self.reject('portal-empty/stats')

    def test_rehashed_wrong_case(self):
        self.mutate('browser-results.json',lambda r:r.update(cases=['browser-clear']))
        self.reject('one-browser-journey')

    def test_rehashed_missing_case(self):
        self.mutate('browser-results.json',lambda r:r['rows'].pop())
        self.reject('exact-raw-observations')

    def test_rehashed_wrong_run(self):
        self.mutate(CASE+'/network-trace.jsonl',lambda rows:[r['commit'].update(gameID='wrong') for r in rows if r.get('commit')],jsonl=True)
        self.reject('recipient-commit')

    def test_rehashed_one_client_substitution(self):
        self.mutate(CASE+'/network-trace.jsonl',lambda rows:[r.update(player='p0') for r in rows if r['player']=='p1'],jsonl=True)
        self.reject('p1/tls-websocket')

    def test_rehashed_wrong_served_source(self):
        self.mutate(CASE+'/served-sources.json',lambda r:r.update({'index.html':'0'*64}))
        self.reject('served/index.html')

    def test_rehashed_cleanup_alive(self):
        self.mutate(CASE+'/cleanup.json',lambda r:r['cleanup']['processes'][0].update(aliveAfter=True))
        self.reject('dead-processes')

    def test_rehashed_inspection_mutation(self):
        self.mutate('browser-results.json',lambda r:r['rows'][1]['after'].update(commands='[1]'))
        self.reject('inspection-unchanged')

    def test_fabricated_full_payload_cannot_pass(self):
        self.mutate(CASE+'/network-trace.jsonl',lambda rows:[r.update(grid=[],players=[]) for r in rows if r.get('commit')],jsonl=True)
        self.reject('unsupported-full-state-schema')

    def test_escaped_proof(self):
        file=self.root/CASE/'network-trace.jsonl'
        outside=Path(self.temp.name)/'outside.jsonl'
        shutil.move(file,outside);file.symlink_to(outside)
        self.reject('escaped-proof')

    def test_standalone_capture_cannot_repair_old_parent(self):
        name = CASE+'/received-boards.jsonl'
        source = Path(os.environ['TASK225_RECEIVED_ARCHIVE'])/'received-boards.jsonl'
        shutil.copyfile(source, self.root/name)
        self.reject('changed-proof')
        index_file = self.root/'evidence-hashes.json'
        index = json.loads(index_file.read_text())
        index[name] = sha(self.root/name)
        index_file.write_text(json.dumps(index))
        self.reject('parent-received-proof-binding')
        coverage_file = self.root/'coverage-results.json'
        coverage = json.loads(coverage_file.read_text())
        coverage['evidenceHashes'][name] = index[name]
        coverage_file.write_text(json.dumps(coverage))
        index['coverage-results.json'] = sha(coverage_file)
        index_file.write_text(json.dumps(index))
        self.reject('received-state/inbound parent run window')
        print('PASS standalone capture transplant rejected: unindexed, parent-unbound, rehashed wrong-run')


if __name__=='__main__':
    unittest.main()
