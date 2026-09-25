#!/usr/bin/env python3
import hashlib
import json
from pathlib import Path
import shutil
import tempfile
import unittest
from review_concurrent_receipts import review

ROOT = Path('/root/diplomacy/artifacts/TASK-225/review-43/prepared/selected-209')


class Receipts(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='task225-receipts-')
        self.root = Path(self.tmp.name)
        names = ['verification-budget.json', 'child-results.json', 'verification.log', 'cleanup.json',
                 'diplomacy-diff-check.txt', 'diplomacy_server-diff-check.txt', 'evidence-hashes.json']
        child = json.loads((ROOT/'child-results.json').read_text())
        names += [str(Path(c[k+'Path']).relative_to(child['outputDir'])) for c in child['children'] for k in ['stdout','stderr']]
        for name in names:
            (self.root/name).parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(ROOT/name, self.root/name)

    def tearDown(self):
        self.tmp.cleanup()

    def rehash(self, name):
        m = json.loads((self.root/'evidence-hashes.json').read_text())
        m[name] = hashlib.sha256((self.root/name).read_bytes()).hexdigest()
        (self.root/'evidence-hashes.json').write_text(json.dumps(m))

    def test_real_receipts_and_empty_stderr(self):
        self.assertTrue(review(self.root)['pass'])

    def test_rehashed_wrong_elapsed(self):
        p = self.root/'verification-budget.json'
        b = json.loads(p.read_text()); b['elapsedMs'] -= 1; p.write_text(json.dumps(b))
        self.rehash(p.name)
        with self.assertRaisesRegex(ValueError, 'elapsed-from-timestamps'):
            review(self.root)

    def test_rehashed_wrong_child_exit(self):
        p = self.root/'child-results.json'
        b = json.loads(p.read_text()); b['children'][0]['exitCode'] = 1; p.write_text(json.dumps(b))
        self.rehash(p.name)
        with self.assertRaisesRegex(ValueError, 'child/exitCode'):
            review(self.root)

    def test_rehashed_missing_child_output(self):
        p = self.root/'verification.log'
        p.write_text(p.read_text().replace('# loaded options/assert.js\n', '', 1))
        self.rehash(p.name)
        with self.assertRaisesRegex(ValueError, 'full-child-stdout'):
            review(self.root)

    def test_missing_empty_diff_is_not_pass(self):
        (self.root/'diplomacy-diff-check.txt').unlink()
        with self.assertRaises(FileNotFoundError):
            review(self.root)


if __name__ == '__main__':
    unittest.main()
