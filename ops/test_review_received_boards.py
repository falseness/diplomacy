"""Corruption controls using a real captured two-browser reload."""
import json
import copy
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
        for name in ['persisted.json', 'received-boards.jsonl', 'network-trace.jsonl']:
            shutil.copyfile(source/name, self.root/name)

    def test_real_received_states(self):
        self.assertEqual(validate(self.root)['recipients'], ['p0', 'p1'])

    def test_real_packet_binding_and_corruptions(self):
        frames = [json.loads(line) for line in (self.root/'network-trace.jsonl').read_text().splitlines()]
        window = (frames[0]['at'], frames[-1]['at'])
        result = validate(self.root, network_frames=frames, run_window=window)
        self.assertEqual(len(result['observations']), 26)
        self.assertEqual([r['id'] for r in result['observations'] if r['id'].endswith('/network-packet-binding')],
                         ['p0/network-packet-binding', 'p1/network-packet-binding'])
        print('PASS actual capture packet binding recipients=p0,p1 observations=26')
        for name in ['wrong-time', 'wrong-run', 'wrong-transport', 'one-client', 'missing-summary']:
            rows = copy.deepcopy(frames)
            summaries = [r for r in rows if r.get('commit')]
            if name == 'wrong-time': summaries[0]['at'] = frames[0]['at']
            elif name == 'wrong-run': summaries[1]['commit']['gameID'] = 'other-run'
            elif name == 'wrong-transport': summaries[0]['transport'] = 'other-transport'
            elif name == 'one-client': summaries[1]['player'] = 'p0'
            else: rows.remove(summaries[1])
            with self.subTest(name=name), self.assertRaises(AssertionError):
                validate(self.root, network_frames=rows, run_window=window)
            print('PASS packet binding corruption rejected: '+name)
        with self.assertRaisesRegex(AssertionError, 'parent run window'):
            validate(self.root, network_frames=frames,
                     run_window=('2000-01-01T00:00:00Z','2000-01-01T00:01:00Z'))
        print('PASS packet binding corruption rejected: wrong-parent-window')

    def test_matching_preparation_and_packets_corruption(self):
        file = self.root/'persisted.json'
        persisted = json.loads(file.read_text())
        persisted['rounds'][0][1]['turns'][0]['preparedTurnState']['player']['units'][0]['hp'] = 100
        file.write_text(json.dumps(persisted))
        packets = self.root/'received-boards.jsonl'
        frames = [json.loads(line) for line in packets.read_text().splitlines()]
        for frame in frames:
            frame['board']['players'][1]['units'][0]['hp'] = 100
        packets.write_text(''.join(json.dumps(row)+'\n' for row in frames))
        with self.assertRaisesRegex(AssertionError, 'independent prepared player'):
            validate(self.root)
        print('PASS matching persistence and both received packets corruption rejected')

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
