"""Real archived execution controls; original files are never changed."""
import copy
import json
import os
from pathlib import Path
import shutil
import tempfile
import unittest

from review_fast_archive import digest, review

ARCHIVE = Path(os.environ.get('TASK231_REVIEW_ARCHIVE', '/root/diplomacy/artifacts/TASK-231/green-05')).resolve()


class FastReviewTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / 'archive'
        shutil.copytree(ARCHIVE, self.root)
        # Explicit synthetic corruption workspace, not a new gameplay invocation.
        for file in self.root.rglob('*.json'):
            text = file.read_text()
            text = text.replace(str(ARCHIVE), str(self.root)).replace(
                '/root/diplomacy/artifacts/TASK-231/green-05', str(self.root))
            file.write_text(text)
        self.rehash()

    def rehash(self):
        file = self.root / 'evidence-hashes.json'
        manifest = json.loads(file.read_text())
        for name in manifest:
            manifest[name] = digest(self.root / name)
        file.write_text(json.dumps(manifest))

    def change(self, name, mutate):
        file = self.root / name
        value = json.loads(file.read_text())
        mutate(value)
        file.write_text(json.dumps(value))
        self.rehash()

    def reject(self, pattern):
        with self.assertRaisesRegex(ValueError, pattern):
            review(self.root, require_current=False)

    def test_historical_positive_and_current_rejection(self):
        result = review(self.root, require_current=False)
        self.assertEqual(len(result['cases']), 30)
        self.assertTrue(result['sourceDifferences'])
        with self.assertRaisesRegex(ValueError, 'current-source-differences'):
            review(self.root)

    def test_rehashed_omitted_case(self):
        self.change('coverage-results.json', lambda x: x['cases'].pop())
        self.reject('exact-coverage')

    def test_rehashed_false_pass(self):
        self.change('child-results.json', lambda x: x['children'][0]['tap']['summary'].update(fail=1))
        self.reject('tap-summary')

    def test_rehashed_raw_failure(self):
        c = json.loads((self.root / 'child-results.json').read_text())['children'][0]
        file = Path(c['stdoutPath'])
        file.write_text(file.read_text().replace('ok 1 - fast opening: coop', 'not ok 1 - fast opening: coop'))
        self.rehash()
        self.reject('raw-tap/fast opening: coop')

    def test_rehashed_deadline_reset(self):
        self.change('child-results.json', lambda x: x['commands'][1]['args'].__setitem__(2, '9999999999999'))
        self.reject('shared-deadline/focused')

    def test_rehashed_cleanup(self):
        self.change('focused-owned.jsonl.cleanup.json', lambda x: x.update(remaining=[123]))
        self.reject('cleanup/focused/remaining')

    def test_rehashed_wrong_selector(self):
        self.change('child-results.json', lambda x: x['commands'][1]['args'].__setitem__(6, 'fast'))
        self.reject('selector/focused')

    def test_rehashed_discovery_omission(self):
        self.change('fast/discovery-manifest.json', lambda x: x.update(unregistered=['omitted.test.js']))
        self.reject('discovery/fast/unregistered')

    def test_unbound_budget_semantic_failure(self):
        self.change('verification-budget.json', lambda x: x.update(elapsedMs=1))
        self.reject('elapsed')

    def test_missing_log(self):
        (self.root / 'verification.log').unlink()
        with self.assertRaises(FileNotFoundError):
            review(self.root, require_current=False)

    def test_escaped_proof(self):
        self.change('coverage-results.json', lambda x: x['cases'][0].update(proof='/etc/hosts'))
        self.reject('escaped-or-missing-proof')

    def test_tampered_hash(self):
        file = self.root / 'coverage-results.json'
        file.write_text(file.read_text() + '\n')
        self.reject('hash/coverage-results.json')


if __name__ == '__main__':
    unittest.main(verbosity=2)
