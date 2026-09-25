"""Corrupt raw participant/lifecycle observations, not just review hashes."""
import json
import os
from pathlib import Path
import shutil
import tempfile
import unittest
from prepare_concurrent_participants import review

class Participants(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)/'archive'
        shutil.copytree(os.environ['TASK225_RECIPIENT_ARCHIVE'],self.root)

    def mutate(self,name,change):
        p=self.root/name; data=json.loads(p.read_text());change(data);p.write_text(json.dumps(data))

    def test_positive(self):
        self.assertGreater(len(review(self.root)['checks']),1900)

    def test_context_count(self):
        def change(d):
            c=next(c for c in d['checkpoints'] if c['id']=='browser-pair/participants')
            c['expected']['contexts']=3;c['observed']['contexts']=3
        self.mutate('checkpoints.json',change)
        with self.assertRaisesRegex(ValueError,'actual-browser-contexts'):review(self.root)

    def test_browser_roster(self):
        self.mutate('recipient-bindings.json',lambda d:d['bindings'][0].update(user='[wrong-user]'))
        with self.assertRaisesRegex(ValueError,'identity'):review(self.root)

    def test_second_server(self):
        p=self.root/'services/activity.jsonl';rows=p.read_text().splitlines()
        p.write_text('\n'.join(rows+[next(l for l in rows if 'starting production server' in l)])+'\n')
        with self.assertRaisesRegex(ValueError,'one-production-server'):review(self.root)

    def test_readiness_missing(self):
        p=self.root/'services/activity.jsonl'
        p.write_text('\n'.join(l for l in p.read_text().splitlines() if 'Collections are ready' not in l)+'\n')
        with self.assertRaisesRegex(ValueError,'readiness'):review(self.root)

    def test_served_asset(self):
        self.mutate('served-sources.json',lambda d:d.update({'options/onlineLogic.js':'0'*64}))
        with self.assertRaisesRegex(ValueError,'served/'):review(self.root)

    def test_sequential_browser_games(self):
        p=self.root/'game-isolation.jsonl';rows=[json.loads(l) for l in p.read_text().splitlines()]
        for row in rows:
            if row['id']=='competitive-browser':row['at']+=1000000
        p.write_text(''.join(json.dumps(r)+'\n' for r in rows))
        with self.assertRaisesRegex(ValueError,'concurrent-browser-progress'):review(self.root)

if __name__=='__main__':unittest.main()
