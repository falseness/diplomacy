"""Semantic controls rebind copied proof hashes, so flags cannot hide defects."""
import json
import shutil
import tempfile
import unittest
from pathlib import Path
from review_version_gameplay import review
from review_asset_archive import sha

BASE = Path('/root/diplomacy/artifacts/TASK-225/review-60/provider')


class GameplayReviewTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='task225-version-control-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)/'provider'
        shutil.copytree(BASE, self.root)

    def reject(self, name, mutate, marker):
        p = self.root/name
        value = json.loads(p.read_text())
        mutate(value)
        p.write_text(json.dumps(value))
        manifest = self.root/'coverage-results.json'
        m = json.loads(manifest.read_text())
        m['evidenceHashes'][name] = sha(p)
        manifest.write_text(json.dumps(m))
        with self.assertRaisesRegex(ValueError, marker):
            review(self.root, sha(manifest))

    def test_positive(self):
        result = review(self.root, sha(self.root/'coverage-results.json'))
        self.assertTrue(result['wholeCriterionClosure'])
        self.assertTrue(result['currentSourceValid'])
        self.assertEqual(len(result['checks']), len({c['id'] for c in result['checks']}))

    def checkpoint(self, name, change, marker):
        def mutate(data):
            c=next(c for c in data['checkpoints'] if c['id']==name)
            change(c['observed'])
            c['expected']=c['observed'];c['pass']=True
        self.reject('checkpoints.json',mutate,marker)

    def test_double_income(self):
        self.checkpoint('old-server/round0/round/p2',lambda b:b['players'][1].update(gold=227),'round0/round/p2')

    def test_wrong_moves(self):
        self.checkpoint('old-client/round0/move/exact',lambda b:b['players'][1]['units'][0].update(moves=2),'round0/move/exact')

    def test_wrong_hp(self):
        self.checkpoint('old-server/round0/move/exact',lambda b:b['players'][1]['units'][0].update(hp=1),'round0/move/exact')

    def test_swapped_units(self):
        self.checkpoint('old-server/round0/move/exact',lambda b:b['players'][1]['units'].reverse(),'round0/move/exact')

    def test_no_id_teleport(self):
        self.checkpoint('old-client/round0/move/exact',lambda b:b['players'][1]['units'][0].update(coord={'x':12,'y':12}),'round0/move/exact')

    def test_omitted_pair(self):
        self.reject('version-matrix.json',lambda d:d['cases'].pop(),'matrix/cases')

    def test_wrong_database_owner(self):
        def mutate(rows):
            next(d for d in rows if d['id']=='old-server')['document']['rounds'][0][1]['turns'][0]['playerIndex']=2
        self.reject('persistence-checkpoints.json',mutate,'accepted/owner1')

    def test_wrong_release(self):
        self.reject('version-matrix.json',lambda d:d['release'].update(archiveSha256='0'*64),'release/matrix-identity')


if __name__=='__main__':
    unittest.main(verbosity=2)
