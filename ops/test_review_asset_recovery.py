"""Semantic controls rebind copied proof hashes, so flags cannot hide defects."""
import json
import shutil
import tempfile
import unittest
from pathlib import Path
from review_asset_recovery import review
from review_asset_archive import sha

BASE = Path('/root/diplomacy/artifacts/TASK-225/review-60/provider')


class RecoveryReviewTests(unittest.TestCase):
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
        self.checkpoint('failed-recovery/round0/round/p2',lambda b:b['players'][1].update(gold=227),'round0/round/p2')

    def test_wrong_moves(self):
        self.checkpoint('cold-warm-delay/round0/move/exact',lambda b:b['players'][1]['units'][0].update(moves=2),'round0/move/exact')

    def test_wrong_hp(self):
        self.checkpoint('failed-recovery/round0/move/exact',lambda b:b['players'][1]['units'][0].update(hp=1),'round0/move/exact')

    def test_swapped_units(self):
        self.checkpoint('failed-recovery/round0/move/exact',lambda b:b['players'][1]['units'].reverse(),'round0/move/exact')

    def test_no_id_teleport(self):
        self.checkpoint('cold-warm-delay/round0/move/exact',lambda b:b['players'][1]['units'][0].update(coord={'x':12,'y':12}),'round0/move/exact')

    def test_omitted_pair(self):
        self.reject('version-matrix.json',lambda d:d['cases'].pop(),'matrix/cases')

    def test_wrong_database_owner(self):
        def mutate(rows):
            next(d for d in rows if d['id']=='failed-recovery')['document']['rounds'][0][1]['turns'][0]['playerIndex']=2
        self.reject('persistence-checkpoints.json',mutate,'accepted/owner1')

    def test_wrong_release(self):
        self.reject('version-matrix.json',lambda d:d['release'].update(archiveSha256='0'*64),'release/matrix-identity')

    def test_unexpected_error(self):
        self.reject('failed-recovery/browser-errors.json', lambda rows: rows.append({'type':'console.error','text':'unexpected'}), 'unexpected-browser-errors')

    def test_wrong_induced_error(self):
        self.reject('failed-recovery/induced-errors.json', lambda rows: rows[0].update(text='net::ERR_CONNECTION_REFUSED'), 'induced-errors')

    def test_missing_wire_board(self):
        name='asset-events.jsonl'; p=self.root/name
        rows=[json.loads(l) for l in p.read_text().splitlines()]
        removed=next(r for r in rows if r['id']=='failed-recovery' and r.get('player')=='failed-recovery-p2' and r.get('event')=='playYourTurn')
        rows.remove(removed);p.write_text(''.join(json.dumps(r)+'\n' for r in rows))
        manifest=self.root/'coverage-results.json';m=json.loads(manifest.read_text());m['evidenceHashes'][name]=sha(p);manifest.write_text(json.dumps(m))
        with self.assertRaisesRegex(ValueError,'wire-count'):
            review(self.root,sha(manifest))


if __name__=='__main__':
    unittest.main(verbosity=2)
