"""Rebind mutations to prove semantic rejection rather than only hash checks."""
import json
import shutil
import tempfile
import unittest
from pathlib import Path
from review_asset_bounds import review
from review_asset_archive import sha

BASE=Path('/root/diplomacy/artifacts/TASK-225/review-60/provider')


class BoundsReviewTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='task225-bounds-control-')
        self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)/'provider'
        shutil.copytree(BASE,self.root)

    def reject(self,name,mutate,marker,lines=False):
        p=self.root/name
        data=[json.loads(l) for l in p.read_text().splitlines()] if lines else json.loads(p.read_text())
        mutate(data)
        p.write_text(''.join(json.dumps(r)+'\n' for r in data) if lines else json.dumps(data))
        manifest=self.root/'coverage-results.json'; m=json.loads(manifest.read_text())
        m['evidenceHashes'][name]=sha(p);manifest.write_text(json.dumps(m))
        with self.assertRaisesRegex(ValueError,marker):
            review(self.root,sha(manifest))

    def test_positive(self):
        r=review(self.root,sha(self.root/'coverage-results.json'))
        self.assertTrue(r['wholeCriterionClosure'])
        self.assertTrue(r['currentSourceValid'])
        self.assertEqual(len(r['checks']),len({c['id'] for c in r['checks']}))

    def test_wrong_seed(self):
        self.reject('cold-warm-delay/declared-fixture.json',lambda d:d['spec'].update(seed=2),'spec/seed')

    def test_extra_journey(self):
        self.reject('asset-events.jsonl',lambda d:d.append(dict(id='extra',stage='admission')),'no-extra-journey',True)

    def test_wrong_join(self):
        def mutate(d):
            next(e for e in d if e['id']=='failed-recovery' and e['stage']=='admission')['join']='sequential'
        self.reject('asset-events.jsonl',mutate,'failed-recovery/join',True)

    def test_wrong_fog(self):
        self.reject('cold-warm-delay/declared-fixture.json',lambda d:d['board'].update(isFogOfWar=True),'cold-warm-delay/fog')

    def test_wrong_contexts(self):
        def mutate(d):
            c=next(c for c in d['checkpoints'] if c['id']=='failed-recovery/participants')
            c['observed']['contexts']=1;c['expected']=c['observed'];c['pass']=True
        self.reject('checkpoints.json',mutate,'failed-recovery/participants')

    def test_wrong_size(self):
        self.reject('cold-warm-delay/declared-fixture.json',lambda d:d['spec'].update(size='normal'),'spec/size')

    def test_omitted_plan_case(self):
        self.reject('verification-plan.json',lambda d:d['cases'].pop(),'exact-plan')


if __name__=='__main__':
    unittest.main(verbosity=2)
