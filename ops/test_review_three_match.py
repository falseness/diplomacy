"""Copied real-archive controls for TASK-225; no synthetic positive evidence."""
import json
import os
from pathlib import Path
import shutil
import tempfile
import unittest
from review_three_match import review, interleaving, checkpoint_progress, LABELS

ARCHIVE = Path(os.environ.get('THREE_MATCH_ARCHIVE', '/root/diplomacy/artifacts/TASK-225/review-32'))


class ThreeMatchTests(unittest.TestCase):
    def test_real_archive(self):
        result = review(ARCHIVE)
        self.assertTrue(result['claims']['threeMatchRoundInterleaving'])
        self.assertTrue(result['claims']['realDatabaseInterleaving'])
        self.assertFalse(result['claims']['longBusyPhase'])
        self.assertEqual([], result['criterionClosures'])
        self.assertFalse(result['fullAuditReady'])

    def phase_copy(self):
        rows = json.loads((ARCHIVE/'database-awaits.json').read_text())
        identities = {g['id']: g['gameID'] for g in json.loads((ARCHIVE/'game-identities.json').read_text())}
        return rows, identities

    def test_phase_checkpoint_omission(self):
        rows, identities = self.phase_copy()
        # Older observations have no phase attribution and must fail closed too.
        rows = [r for r in rows if not r.get('phase') or r['phase']['stage'] != 'demon']
        with self.assertRaisesRegex(ValueError, 'phase-progress: missing or reordered checkpoints'):
            checkpoint_progress(rows, identities)

    def test_phase_changed_operation_identity(self):
        rows, identities = self.phase_copy()
        rows[1]['gameID'] = 'wrong-match'
        with self.assertRaisesRegex(ValueError, 'phase-progress: changed operation identity'):
            checkpoint_progress(rows, identities)

    def test_phase_missing_await_end(self):
        rows, identities = self.phase_copy()
        rows.pop()
        with self.assertRaisesRegex(ValueError, 'phase-progress: incomplete driver operation'):
            checkpoint_progress(rows, identities)

    def test_unacknowledged_checkpoint_write(self):
        rows, identities = self.phase_copy()
        for r in rows:
            if r.get('phase') and r['boundary'] == 'end':
                r['writeResult'] = dict(acknowledged=False, matchedCount=1, modifiedCount=1)
        with self.assertRaisesRegex(ValueError, 'phase-progress: (checkpoint write not acknowledged|missing or reordered checkpoints)'):
            checkpoint_progress(rows, identities)

    def test_sequentialized_database_progress(self):
        rows, identities = self.phase_copy()
        # Serialize whole matches while preserving each operation's duration and
        # internal order. Real prior four-imp proofs lack attributed checkpoints.
        for r in rows:
            if r['gameID'] == identities['coop-extra']:
                r['ns'] = str(int(r['ns']) + 10**15)
        with self.assertRaisesRegex(ValueError, 'phase-progress: (no other co-op commit|missing or reordered checkpoints)'):
            checkpoint_progress(rows, identities)

    def test_historical_sequential_trace(self):
        source = Path('/root/diplomacy/artifacts/TASK-209/green-14/game-isolation.jsonl')
        rows = [json.loads(l) for l in source.read_text().splitlines()]
        with self.assertRaisesRegex(ValueError, 'interleaving: sequential co-op lifetimes'):
            interleaving(rows, ['coop-browser', 'competitive-browser', 'coop-ten'])

    def corrupt(self, mutate, reason):
        with tempfile.TemporaryDirectory(prefix='task225-control-') as temporary:
            root = Path(temporary)/'archive'
            shutil.copytree(ARCHIVE, root)
            p = root/'game-isolation.jsonl'
            rows = [json.loads(l) for l in p.read_text().splitlines()]
            mutate(rows)
            p.write_text(''.join(json.dumps(r)+'\n' for r in rows))
            with self.assertRaisesRegex(ValueError, reason):
                review(root)

    def test_omitted_game(self):
        self.corrupt(lambda rows: rows.__setitem__(slice(None), [r for r in rows if r['id'] != 'coop-extra']),
                     'interleaving: missing game/round coop-extra')

    def test_swapped_identity(self):
        def mutate(rows):
            for r in rows:
                if r['id'] in ['coop-browser', 'coop-extra']:
                    r['id'] = 'coop-extra' if r['id'] == 'coop-browser' else 'coop-browser'
        self.corrupt(mutate, 'independent-observation: coop-browser/game-id')

    def mutate_board(self, change):
        def mutate(rows):
            row = next(r for r in rows if r['id'] == 'coop-browser' and 'fullBoard' in r)
            for field in ['board', 'fullBoard']:
                change(row[field]['players'][1])
        self.corrupt(mutate, 'independent-observation: coop-browser/state')

    def test_wrong_hp(self):
        self.mutate_board(lambda p: p['units'][0].__setitem__('hp', 99))

    def test_wrong_moves(self):
        self.mutate_board(lambda p: p['units'][0].__setitem__('moves', 99))

    def test_double_income(self):
        self.mutate_board(lambda p: p.__setitem__('gold', p['gold']+9))

    def test_duplicate_unit(self):
        self.mutate_board(lambda p: p['units'].append(p['units'][0].copy()))

    def test_no_id_teleport(self):
        self.mutate_board(lambda p: p['units'][0]['coord'].__setitem__('x', 7))


if __name__ == '__main__':
    unittest.main()
