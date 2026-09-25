"""Real-proof corruption controls for TASK-225's AC2 supplements."""
import json
from pathlib import Path
import shutil
import tempfile
import unittest

from prepare_fast_regressions import readiness_review
from review_fast_map_repair import reconstruct, review

ROOT = Path(__file__).resolve().parents[1]
PROBE = ROOT / 'artifacts/TASK-225/review-30'
HISTORY = ROOT / 'artifacts/TASK-231'
ARCHIVE = ROOT / 'artifacts/TASK-225/refresh-231-29'
CURRENT = Path('/root/diplomacy_server/tests/coop/browser-online.test.js')


class SupplementControls(unittest.TestCase):
    def test_original_map_provenance(self):
        result = review(HISTORY, PROBE / 'retained-edit-records.json', CURRENT)
        self.assertTrue(result['passed'])
        self.assertFalse(result['criterionCovered'])

    def test_reconstructed_source_not_invented(self):
        import hashlib
        for name, source in zip(['repro-05', 'repro-06'], reconstruct((HISTORY / 'baseline/browser-online.test.js').read_text())):
            identity = json.loads((HISTORY / name / 'focused/source-identities.json').read_text())
            self.assertEqual(hashlib.sha256(source.encode()).hexdigest(), identity['before']['server']['files']['tests/coop/browser-online.test.js'])

    def test_substituted_edit_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'records.json'
            data = json.loads((PROBE / 'retained-edit-records.json').read_text())
            data['calls'][1]['record']['payload']['input'] += ' invented repair'
            path.write_text(json.dumps(data))
            with self.assertRaisesRegex(ValueError, 'substituted-edit-record'):
                review(HISTORY, path, CURRENT)

    def test_readiness_real_pass(self):
        self.assertEqual(len(readiness_review(PROBE, ARCHIVE)), 8)

    def corrupt(self, filename, change, message):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for p in PROBE.glob('readiness-02*'):
                if p.is_file():
                    shutil.copyfile(p, root / p.name)
            shutil.copytree(PROBE / 'browser-02', root / 'browser-02')
            file = root / filename
            if filename.endswith('.jsonl'):
                data = [json.loads(line) for line in file.read_text().splitlines()]
                change(data)
                file.write_text(''.join(json.dumps(row) + '\n' for row in data))
            else:
                data = json.loads(file.read_text())
                change(data)
                file.write_text(json.dumps(data))
            with self.assertRaisesRegex(ValueError, message):
                readiness_review(root, ARCHIVE)

    def test_missing_wait(self):
        self.corrupt('readiness-02.jsonl', lambda d: d.pop(), 'exact-eight-waits')

    def test_timeout_inflation(self):
        self.corrupt('readiness-02.jsonl', lambda d: d[0].update(timeoutMs=60000), 'original-bound')

    def test_slow_wait(self):
        self.corrupt('readiness-02.jsonl', lambda d: d[0].update(elapsedMs=15001), 'original-bound')

    def test_duplicate_context(self):
        self.corrupt('readiness-02.jsonl', lambda d: d[1].update(context=0), 'exact-eight-waits')

    def test_changed_gameplay_assertion(self):
        self.corrupt('browser-02/browser-checkpoints.json', lambda d: d['checkpoints'][0]['observed'].update(revision=99), 'changed-gameplay-assertions')

    def test_incomplete_cleanup(self):
        self.corrupt('readiness-02-owned.jsonl.cleanup.json', lambda d: d.update(cleanup=False), 'cleanup')


if __name__ == '__main__':
    unittest.main()
