"""Copied-real-proof controls; original artifacts are never mutated."""
import copy
import json
import os
from pathlib import Path
import tempfile
import unittest

from review_fast_regressions import build, digest, validate


ROOT = Path(__file__).resolve().parents[1]


class RegressionProofControls(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Explicit input override supports later selections without relabeling old runs.
        report = os.environ.get('TASK231_REGRESSION_REPORT')
        if report:
            cls.report = json.loads(Path(report).read_text())
        else:
            cls.report = build(ROOT/'artifacts/TASK-231',
                ROOT/'artifacts/TASK-225/refresh-231-29',
                ROOT/'artifacts/TASK-225/review-28/prepared-final/selected-231',
                ROOT/'artifacts/TASK-225/review-29/repair.patch')

    def test_real_originals_and_regressions(self):
        self.assertTrue(validate(self.report))

    def test_missing_original_rejected(self):
        report = copy.deepcopy(self.report)
        report['failures'][0]['historicalLog']['file'] += '.absent'
        with self.assertRaisesRegex(ValueError, 'changed-or-missing-proof'):
            validate(report)

    def test_substituted_original_even_with_new_hash_rejected(self):
        report = copy.deepcopy(self.report)
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory)/'original.log'
            file.write_text(Path(report['failures'][0]['regressions'][1]['file']).read_text())
            report['failures'][0]['historicalLog'] = dict(file=str(file),sha256=digest(file))
            with self.assertRaisesRegex(ValueError, 'missing-original-failure'):
                validate(report)

    def test_missing_current_regression_rejected(self):
        report = copy.deepcopy(self.report)
        report['failures'][0]['regressions'][1]['file'] += '.absent'
        with self.assertRaisesRegex(ValueError, 'changed-or-missing-proof'):
            validate(report)

    def test_substituted_regression_even_with_new_hash_rejected(self):
        report = copy.deepcopy(self.report)
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory)/'regression.log'
            file.write_text(Path(report['failures'][0]['historicalLog']['file']).read_text())
            report['failures'][0]['regressions'][1].update(file=str(file),sha256=digest(file))
            with self.assertRaisesRegex(ValueError, 'missing-regression'):
                validate(report)

    def test_omitted_failure_rejected(self):
        report = copy.deepcopy(self.report)
        report['failures'].pop()
        with self.assertRaisesRegex(ValueError, 'incomplete-original-failure-selection'):
            validate(report)

    def test_omitted_regression_rejected(self):
        report = copy.deepcopy(self.report)
        report['failures'][0]['regressions'].pop()
        with self.assertRaisesRegex(ValueError, 'incomplete-regression-selection'):
            validate(report)

    def test_false_coverage_promotion_rejected(self):
        for key in ['criterionCovered','naturalBrowserCoverage']:
            report = copy.deepcopy(self.report)
            report[key] = True
            with self.assertRaisesRegex(ValueError, 'unsupported-coverage-promotion'):
                validate(report)


if __name__ == '__main__':
    unittest.main()
