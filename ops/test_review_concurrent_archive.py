"""Copied real-archive controls for TASK-225's concurrent state reviewer."""
import json
import os
from pathlib import Path
import shutil
import tempfile
import unittest

from review_concurrent_archive import digest, review

ARCHIVE = Path(os.environ.get('CONCURRENT_REVIEW_ARCHIVE',
                             '/root/diplomacy/artifacts/TASK-209/green-14'))


class ConcurrentArchiveTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='task225-concurrent-review-')
        self.root = Path(self.temp.name)/'archive'
        shutil.copytree(ARCHIVE, self.root)
        self.addCleanup(self.temp.cleanup)

    def change(self, name, mutate):
        path = self.root/name
        value = json.loads(path.read_text())
        mutate(value)
        path.write_text(json.dumps(value))
        coverage = self.root/'coverage-results.json'
        data = json.loads(coverage.read_text())
        if name in data['evidenceHashes']:
            data['evidenceHashes'][name] = digest(path)
        coverage.write_text(json.dumps(data))

    def corrupt_board(self, mutate):
        def change(data):
            r = next(c for c in data['checkpoints'] if c['id'] == 'browser-pair/initial/coop-browser/p0')
            # Change BOTH producer fields and retain pass=true; equality alone
            # would accept this. Rehash so only the independent oracle rejects.
            for key in ['expected', 'observed']:
                mutate(r[key])
        self.change('checkpoints.json', change)
        with self.assertRaisesRegex(ValueError, 'independent-observation-mismatch: browser-pair/initial/'):
            review(self.root)

    def test_real_archive_positive(self):
        result = review(self.root)
        self.assertEqual(len(result['checks']), 612)
        self.assertFalse(result['fullAuditReady'])
        self.assertEqual(result['criterionClosures'], [])
        self.assertIn('G09', result['gaps'])
        self.assertIn('TASK-209/AC2', result['gaps'])
        self.assertEqual(result['rawTenIdentityScope'], dict(tenProjectedEvents=211,
            tenInboundPackets=0, tenFullBoards=0, tenIndependentRecipients=0))

    def test_intermediate_wrong_nonmoving_player_income(self):
        self.change('coop-ten-move-1-persisted.json', lambda d:
            d['rounds'][-1][1]['turns'][0]['gameObject']['players'][7].update(gold=999))
        with self.assertRaisesRegex(ValueError, 'ten-intermediate/1/submitted-board'):
            review(self.root)

    def test_intermediate_wrong_second_movement(self):
        self.change('coop-ten-move-2-persisted.json', lambda d:
            d['rounds'][-1][1]['turns'][0]['gameObject']['players'][1]['units'][0]['coord'].update(y=5))
        with self.assertRaisesRegex(ValueError, 'ten-intermediate/2/submitted-board'):
            review(self.root)

    def test_intermediate_swapped_prepared_identity(self):
        self.change('coop-ten-move-1-persisted.json', lambda d:
            d['rounds'][-1][7]['turns'][0]['preparedTurnState'].update(playerIndex=8))
        with self.assertRaisesRegex(ValueError, 'ten-intermediate/1/prepared-slot/7'):
            review(self.root)

    def test_intermediate_prepared_double_income(self):
        self.change('coop-ten-move-2-persisted.json', lambda d:
            d['rounds'][-1][7]['turns'][0]['preparedTurnState']['player'].update(gold=430))
        with self.assertRaisesRegex(ValueError, 'ten-intermediate/2/prepared-player/7'):
            review(self.root)

    def test_intermediate_wrong_revision(self):
        self.change('coop-ten-move-2-persisted.json', lambda d: d.update(coopRevision=12))
        with self.assertRaisesRegex(ValueError, 'ten-intermediate/2/revision'):
            review(self.root)

    def test_missing_intermediate_document(self):
        (self.root/'coop-ten-move-1-persisted.json').unlink()
        with self.assertRaises(FileNotFoundError):
            review(self.root)

    def test_double_income_with_matching_expected(self):
        self.corrupt_board(lambda b: b['players'][1].update(gold=218))

    def test_wrong_hp_with_matching_expected(self):
        self.corrupt_board(lambda b: b['players'][1]['units'][0].update(hp=3))

    def test_wrong_moves_with_matching_expected(self):
        self.corrupt_board(lambda b: b['players'][1]['units'][0].update(moves=1))

    def test_teleport_with_matching_expected(self):
        self.corrupt_board(lambda b: b['players'][1]['units'][0]['coord'].update(x=12))

    def test_duplicate_unit_with_matching_expected(self):
        self.corrupt_board(lambda b: b['players'][1]['units'].append(b['players'][1]['units'][0].copy()))

    def test_raw_persisted_unit_corruption(self):
        self.change('coop-ten-persisted-2.json', lambda d: d['rounds'][-1][0]['parallelTurnResult']['players'][1]['units'][0].update(hp=9))
        with self.assertRaisesRegex(ValueError, 'raw-persistence/2'):
            review(self.root)

    def test_omitted_required_case(self):
        self.change('verification-plan.json', lambda d: d['cases'].pop())
        with self.assertRaisesRegex(ValueError, 'independent-observation-mismatch: cases'):
            review(self.root)

    def test_removed_phase(self):
        self.change('phase-snapshots.json', lambda d: d.pop())
        with self.assertRaisesRegex(ValueError, 'phase-order'):
            review(self.root)

    def test_missing_proof(self):
        (self.root/'game-isolation.jsonl').unlink()
        with self.assertRaises(FileNotFoundError):
            review(self.root)

    def test_substituted_unrehashed_proof(self):
        (self.root/'checkpoints.json').write_text('{}')
        with self.assertRaisesRegex(ValueError, 'evidence-hash-mismatch'):
            review(self.root)

    def test_longer_timeout_is_not_accepted(self):
        self.change('progress-timings.json', lambda d: d[1].update(boundMs=120000))
        with self.assertRaisesRegex(ValueError, 'bound/browser-pair/round 1'):
            review(self.root)


if __name__ == '__main__':
    unittest.main()
