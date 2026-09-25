"""Controls use copies of the real finalized archive; no gameplay is simulated."""
import json
import os
from pathlib import Path
import shutil
import tempfile
import unittest

from prepare_fast_receipts import execution_review, files, prepare, save, validate_selection
from review_fast_archive import digest

ARCHIVE = Path(os.environ.get('TASK231_RECEIPT_ARCHIVE', '/root/diplomacy/artifacts/TASK-225/refresh-231-29')).resolve()
REVIEWS = Path(os.environ.get('TASK231_RECEIPT_REVIEWS', '/root/diplomacy/artifacts/TASK-225/review-27/prepared/reviewed-crosswalk.json'))


class ReceiptSelectionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.addClassCleanup(cls.temp.cleanup)
        cls.root = Path(cls.temp.name)
        cls.original_hashes = files(ARCHIVE)
        prepare(ARCHIVE, REVIEWS, cls.root / 'prepared')

    def setUp(self):
        self.temp_case = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_case.cleanup)
        self.selected = Path(self.temp_case.name) / 'selected'
        shutil.copytree(self.root / 'prepared/selected-231', self.selected)

    def tearDown(self):
        self.assertEqual(self.original_hashes, files(ARCHIVE))

    def change(self, name, mutate):
        file = self.selected / name
        value = json.loads(file.read_text())
        mutate(value)
        save(file, value)
        hashes = files(self.selected)
        hashes.pop('evidence-hashes.json')
        save(self.selected / 'evidence-hashes.json', hashes)

    def test_positive_retains_original_and_final_receipts(self):
        result = validate_selection(self.selected)
        self.assertTrue(result['currentSourceValid'])
        index = json.loads((self.selected / 'evidence-hashes.json').read_text())
        self.assertIn('verification-budget.json', index)
        self.assertIn('verification.log', index)
        original = json.loads((self.selected / 'original-evidence-hashes.json').read_text())
        self.assertNotIn('verification-budget.json', original)
        self.assertNotIn('verification.log', original)

    def test_rehashed_budget(self):
        self.change('verification-budget.json', lambda x: x.update(elapsedMs=1))
        with self.assertRaisesRegex(ValueError, 'changed-copy/verification-budget'):
            validate_selection(self.selected)

    def test_rehashed_log(self):
        f = self.selected / 'verification.log'
        f.write_text(f.read_text().replace('PASS TASK-231', 'FAIL TASK-231'))
        self.change('selection-provenance.json', lambda x: None)
        with self.assertRaisesRegex(ValueError, 'changed-copy/verification.log'):
            validate_selection(self.selected)

    def test_rehashed_omitted_case(self):
        self.change('coverage-results.json', lambda x: x['cases'].pop())
        with self.assertRaisesRegex(ValueError, 'coverage-projection'):
            validate_selection(self.selected)

    def test_rehashed_false_tier(self):
        self.change('verification-plan.json', lambda x: x['cases'][0].update(tier='public'))
        with self.assertRaisesRegex(ValueError, 'changed-copy/verification-plan'):
            validate_selection(self.selected)

    def test_rehashed_forged_review(self):
        self.change('independent-execution-review.json', lambda x: x['checks'].pop())
        with self.assertRaisesRegex(ValueError, 'changed-review'):
            validate_selection(self.selected)

    def test_rehashed_wrong_run(self):
        self.change('selection-provenance.json', lambda x: x.update(originalArchive='/root/diplomacy/artifacts/TASK-231/green-05'))
        with self.assertRaisesRegex(ValueError, 'current-source-differences|changed-original'):
            validate_selection(self.selected)

    def test_rehashed_early_attestation(self):
        self.change('selection-provenance.json', lambda x: x.update(selectedAt='2026-01-01T00:00:00+00:00'))
        with self.assertRaisesRegex(ValueError, 'not-later'):
            validate_selection(self.selected)

    def test_missing_receipt(self):
        (self.selected / 'verification.log').unlink()
        with self.assertRaises(FileNotFoundError):
            validate_selection(self.selected)

    def test_proof_escape(self):
        self.change('coverage-results.json', lambda x: x['cases'][0].update(proof='/etc/hosts'))
        with self.assertRaisesRegex(ValueError, 'coverage-projection'):
            validate_selection(self.selected)

    def test_symlink(self):
        f = self.selected / 'verification.log'
        f.unlink()
        f.symlink_to(ARCHIVE / 'verification.log')
        with self.assertRaisesRegex(ValueError, 'symlink'):
            validate_selection(self.selected)

    def truncated_original(self, marker, pattern):
        copy = Path(self.temp_case.name) / 'original-copy'
        shutil.copytree(ARCHIVE, copy)
        # Explicit corruption workspace. Rebase textual paths consistently;
        # never alter the real original or claim a new execution.
        alias = '/root/diplomacy/artifacts/TASK-225/refresh-231-29'
        for file in copy.rglob('*'):
            if file.is_file() and file.suffix in ['.json', '.log', '.txt', '.jsonl']:
                file.write_text(file.read_text().replace(str(ARCHIVE), str(copy)).replace(alias, str(copy)))
        manifest = json.loads((copy / 'evidence-hashes.json').read_text())
        save(copy / 'evidence-hashes.json', {n: digest(copy / n) for n in manifest})
        execution_review(copy)
        log = copy / 'verification.log'
        value = log.read_text()
        self.assertIn(marker, value)
        log.write_text(value.replace(marker, 'REMOVED_FOR_CONTROL', 1))
        with self.assertRaisesRegex(ValueError, pattern):
            execution_review(copy)

    def test_missing_literal_command(self):
        self.truncated_original('COMMAND ', 'full-command/fast')

    def test_missing_child_output(self):
        self.truncated_original('CHILD_LOG ', 'full-child-output/')

    def test_no_original_overwrite(self):
        with self.assertRaisesRegex(ValueError, 'overlapping-directories'):
            prepare(ARCHIVE, REVIEWS, ARCHIVE / 'later')


if __name__ == '__main__':
    unittest.main(verbosity=2)
