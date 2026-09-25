"""Corruption controls using a real captured two-browser reload."""
import json
import os
import shutil
import tempfile
import unittest
from pathlib import Path
from review_received_boards import validate


class ReceivedBoardsTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        source = Path(os.environ['TASK225_RECEIVED_ARCHIVE'])
        for name in ['persisted.json', 'received-boards.jsonl']:
            shutil.copyfile(source/name, self.root/name)

    def test_real_received_states(self):
        self.assertEqual(validate(self.root)['recipients'], ['p0', 'p1'])

    def test_semantic_corruptions(self):
        file = self.root/'received-boards.jsonl'
        original = file.read_text()
        controls = {
            'missing': lambda rows: rows.pop(),
            'one-client': lambda rows: rows[1].update(player='p0'),
            'wrong-run': lambda rows: rows[1]['board']['coopCommit'].update(gameID='wrong'),
            'wrong-revision': lambda rows: rows[1]['board']['coopCommit'].update(revision=1),
            'wrong-slot': lambda rows: rows[1]['board'].update(whooseTurn=1),
            'double-income': lambda rows: rows[1]['board']['players'][1].update(gold=112),
            'wrong-hp': lambda rows: rows[1]['board']['players'][1]['units'][0].update(hp=100),
            'wrong-moves': lambda rows: rows[0]['board']['players'][1]['units'][0].update(moves=100),
            'omitted-field': lambda rows: rows[0]['board'].pop('external'),
            'extra-field': lambda rows: rows[0]['board'].update(forged=True),
            'stale-format': lambda rows: rows[0]['board']['gameSettings']['coop']['generation'].update(version=3),
            'sent-substitution': lambda rows: rows[0].update(direction='sent'),
        }
        for name, mutate in controls.items():
            with self.subTest(name=name):
                rows = [json.loads(line) for line in original.splitlines()]
                mutate(rows)
                file.write_text(''.join(json.dumps(row)+'\n' for row in rows))
                with self.assertRaises(AssertionError):
                    validate(self.root)
                print('PASS received-board corruption rejected: '+name)


if __name__ == '__main__':
    unittest.main()
