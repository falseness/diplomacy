"""Corrupt copied real packet/roster proofs; never fabricate gameplay positives."""
import json
import os
from pathlib import Path
import shutil
import tempfile
import unittest
from review_concurrent_recipients import review


class RecipientProof(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.archive = Path(os.environ.get('TASK225_RECIPIENT_ARCHIVE',
                          '/root/diplomacy/artifacts/TASK-225/review-40/provider'))

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        for name in ['recipient-bindings.json', 'recipient-packets.jsonl',
                     'coop-ten-persisted-2.json', 'coop-ten-move-1-persisted.json',
                     'coop-ten-move-2-persisted.json']:
            shutil.copy2(self.archive/name, self.root/name)
        self.bindings = json.loads((self.root/'recipient-bindings.json').read_text())
        self.packets = [json.loads(line) for line in (self.root/'recipient-packets.jsonl').read_text().splitlines()]
        gid = json.loads((self.root/'coop-ten-persisted-2.json').read_text())['gameID']
        self.peer = next(b for b in self.bindings['bindings'] if b['gameID'] == gid and b['slot'] == 1)
        self.other = next(b for b in self.bindings['bindings'] if b['gameID'] == gid and b['slot'] == 2)

    def target(self):
        return next(p for p in self.packets if p['peer'] == self.peer['peer']
                    and p['event'] == 'waitYouTurn' and p['bodies'][0].get('coopCommit', {}).get('revision') == 1)

    def reject(self, marker):
        (self.root/'recipient-bindings.json').write_text(json.dumps(self.bindings))
        (self.root/'recipient-packets.jsonl').write_text(''.join(json.dumps(p)+'\n' for p in self.packets))
        with self.assertRaisesRegex(ValueError, marker):
            review(self.root)

    def test_real_positive(self):
        result = review(self.root)
        self.assertTrue(result['passRecipientProof'])
        self.assertGreaterEqual(result['packetCount'], 210)
        self.assertFalse(result['fullAuditReady'])
        self.assertEqual(result['criterionClosures'], [])

    def test_swapped_recipient(self):
        p = self.target()
        p['peer'] = self.other['peer']
        p['connection'] = self.other['connections'][0]
        self.reject('/slot')

    def test_payload_slot(self):
        self.target()['bodies'][0]['whooseTurn'] = 2
        self.reject('/slot')

    def test_roster_binding(self):
        self.peer['user'] = self.other['user']
        self.reject('ten-distinct-users')

    def test_reconnect_binding(self):
        self.peer['connections'].pop()
        self.reject('/connections')

    def test_missing_revision(self):
        self.packets = [p for p in self.packets if not (p['peer'] == self.peer['peer'] and
                       p['bodies'] and isinstance(p['bodies'][0], dict) and
                       p['bodies'][0].get('coopCommit', {}).get('revision') == 1)]
        self.reject('every-recipient-every-revision')

    def test_wrong_hp(self):
        self.target()['bodies'][0]['players'][1]['units'][0]['hp'] += 1
        self.reject('/independent-board')

    def test_wrong_moves(self):
        self.target()['bodies'][0]['players'][1]['units'][0]['moves'] += 1
        self.reject('/independent-board')

    def test_double_income(self):
        self.target()['bodies'][0]['players'][1]['gold'] += 9
        self.reject('/independent-board')

    def test_missing_proof(self):
        (self.root/'recipient-packets.jsonl').unlink()
        with self.assertRaises(FileNotFoundError):
            review(self.root)

    def test_wrong_game(self):
        self.target()['bodies'][0]['coopCommit']['gameID'] = 'other-game'
        self.reject('/game')


if __name__ == '__main__':
    unittest.main()
