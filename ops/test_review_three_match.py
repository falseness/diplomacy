"""Copied real-archive controls for TASK-225; no synthetic positive evidence."""
import json
import os
from pathlib import Path
import shutil
import tempfile
import unittest
from review_three_match import review, interleaving, LABELS

ARCHIVE = Path(os.environ.get('THREE_MATCH_ARCHIVE', '/root/diplomacy/artifacts/TASK-225/review-32'))


class ThreeMatchTests(unittest.TestCase):
    def test_real_archive(self):
        result = review(ARCHIVE)
        self.assertTrue(result['claims']['threeMatchRoundInterleaving'])
        self.assertTrue(result['claims']['realDatabaseInterleaving'])
        self.assertFalse(result['claims']['longBusyPhase'])
        self.assertEqual([], result['criterionClosures'])
        self.assertFalse(result['fullAuditReady'])

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
