"""Reader controls against historical trace projections, never gameplay tests."""
import copy
import json
import unittest

from inspect_terminal_ac3 import ARCHIVE, review_move


class ReaderControls(unittest.TestCase):
    def setUp(self):
        case = 'terminal-to-coop'
        self.inputs = [json.loads(l) for l in (ARCHIVE / case / 'input-trace.jsonl').read_text().splitlines()]
        self.trace = [json.loads(l) for l in (ARCHIVE / case / 'network-traces.jsonl').read_text().splitlines()]
        prefix = case + '/next/'
        self.checkpoints = {c['id'][len(prefix):]: c for c in json.loads((ARCHIVE / 'checkpoints.json').read_text())['checkpoints']
                            if c['id'].startswith(prefix)}

    def run_review(self):
        return review_move('coop', self.inputs, self.trace, self.checkpoints)

    def test_positive_independent_move(self):
        self.assertGreater(len(self.run_review()), 20)

    def test_omitted_menu(self):
        self.inputs = [r for r in self.inputs if r['label'] != 'return from finished game']
        with self.assertRaisesRegex(AssertionError, 'return from finished game/count'):
            self.run_review()

    def test_wrong_mode(self):
        next(r for r in self.trace if r.get('stage') == 'next-game')['mode'] = 'competitive'
        with self.assertRaisesRegex(AssertionError, 'mode'):
            self.run_review()

    def test_resumed_old_timer(self):
        self.checkpoints['old-timer-stopped']['observed'] = True
        with self.assertRaisesRegex(AssertionError, 'old-timer-stopped'):
            self.run_review()

    def test_changed_move_hp_moves_income_and_identity(self):
        for field, value in [('hp', 999), ('moves', 2), ('name', 'knight'), ('x', 9)]:
            with self.subTest(field=field):
                old = copy.deepcopy(self.checkpoints)
                # Rebound expected and observed cannot make the oracle agree.
                for side in ['expected', 'observed']:
                    self.checkpoints['new-first-move'][side]['players'][1]['units'][0][field] = value
                with self.assertRaisesRegex(AssertionError, 'first-move-expected'):
                    self.run_review()
                self.checkpoints = old
        self.checkpoints['new-first-move']['observed']['players'][1]['gold'] += 10
        with self.assertRaisesRegex(AssertionError, 'first-move-observed'):
            self.run_review()

    def test_mutated_callback_projection(self):
        self.checkpoints['old-callbacks-new-board-unchanged']['observed']['gameRound'] += 1
        with self.assertRaisesRegex(AssertionError, 'callback-projection-observed'):
            self.run_review()


if __name__ == '__main__':
    unittest.main(verbosity=2)
