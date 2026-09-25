"""Archive-based browser packet and input corruption controls."""
import json
import os
from pathlib import Path
import shutil
import tempfile
import unittest
from review_concurrent_browser import review


class BrowserProof(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        archive = Path(os.environ.get('TASK225_RECIPIENT_ARCHIVE', '/root/diplomacy/artifacts/TASK-209/green-14'))
        for name in ['wire.jsonl', 'inputs.jsonl', 'checkpoints.json', 'coop-browser-persisted-2.json',
                     'competitive-browser-persisted-4.json']:
            shutil.copy2(archive/name, self.root/name)

    def test_positive(self):
        self.assertGreater(review(self.root)['browserPacketChecks'], 150)

    def test_swapped_recipient(self):
        p = self.root/'wire.jsonl'
        rows = [json.loads(l) for l in p.read_text().splitlines()]
        row = next(r for r in rows if r['direction'] == 'received' and r.get('event') == 'playYourTurn')
        row['slot'] = 3-row['slot']
        p.write_text(''.join(json.dumps(r)+'\n' for r in rows))
        with self.assertRaisesRegex(ValueError, '/recipient'):
            review(self.root)

    def test_removed_movement(self):
        p = self.root/'inputs.jsonl'
        rows = [json.loads(l) for l in p.read_text().splitlines()]
        p.write_text(''.join(json.dumps(r)+'\n' for r in rows if r.get('label') != 'move independent army cell=3,5'))
        with self.assertRaisesRegex(ValueError, '/move-input'):
            review(self.root)

    def test_hp_corruption(self):
        p = self.root/'wire.jsonl'
        rows = [json.loads(l) for l in p.read_text().splitlines()]
        row = next(r for r in rows if r['direction'] == 'received' and r.get('event') == 'playYourTurn')
        row['args'][0]['json']['players'][1]['units'][0]['hp'] += 1
        p.write_text(''.join(json.dumps(r)+'\n' for r in rows))
        with self.assertRaisesRegex(ValueError, '/board'):
            review(self.root)


if __name__ == '__main__':
    unittest.main()
