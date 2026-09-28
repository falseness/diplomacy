import copy
import hashlib
import tempfile
import unittest
from pathlib import Path
from inspect_smoke_archive import bound_read, sentinel_checks


def fixture():
    before = dict(games=[dict(gameID='ordinary', smokeRun=None, playerIndexToUserIndex=[None, 'o1', 'o2']),
                         dict(gameID='b', smokeRun='run-b', playerIndexToUserIndex=[None, 'b1', 'b2'])],
                  accounts=[dict(userId=u, gameID=g, smokeRun=r) for u, g, r in
                            [('o1', 'ordinary', None), ('o2', 'ordinary', None),
                             ('b1', 'b', 'run-b'), ('b2', 'b', 'run-b')]],
                  other=[dict(_id='keep', value=123)])
    return dict(before=before, after=copy.deepcopy(before), pass_=True)


class ArchiveTests(unittest.TestCase):
    def test_valid_snapshot(self):
        checks = sentinel_checks(fixture())
        self.assertEqual(len(checks), 16)
        self.assertTrue(all(c['pass'] for c in checks))

    def corrupt(self, mutation, reason):
        value = fixture()
        mutation(value['before'])
        value['after'] = copy.deepcopy(value['before'])
        with self.assertRaisesRegex(ValueError, reason):
            sentinel_checks(value)

    def test_duplicate_member(self):
        self.corrupt(lambda d: d['games'][0]['playerIndexToUserIndex'].__setitem__(2, 'o1'), 'distinct-members')

    def test_swapped_account(self):
        self.corrupt(lambda d: d['accounts'][0].__setitem__('gameID', 'b'), 'account-membership')

    def test_wrong_namespace(self):
        self.corrupt(lambda d: d['accounts'][0].__setitem__('smokeRun', 'run-b'), 'account-namespace')

    def test_missing_game(self):
        self.corrupt(lambda d: d['games'].pop(), 'game-count')

    def test_changed_sentinel(self):
        value = fixture()
        value['after']['other'][0]['value'] = 0
        with self.assertRaisesRegex(ValueError, 'full-documents-preserved'):
            sentinel_checks(value)

    def test_wrong_unrelated_database(self):
        self.corrupt(lambda d: d.__setitem__('other', []), 'unrelated-database')

    def test_bound_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / 'root'
            root.mkdir()
            f = root / 'proof'
            f.write_bytes(b'')
            hashes = {'proof': hashlib.sha256(b'').hexdigest()}
            self.assertEqual(bound_read(root, 'proof', hashes), b'')
            f.write_bytes(b'changed')
            with self.assertRaisesRegex(ValueError, 'changed or unbound'):
                bound_read(root, 'proof', hashes)
            f.unlink()
            with self.assertRaises(FileNotFoundError):
                bound_read(root, 'proof', hashes)
            outside = Path(tmp) / 'outside'
            outside.write_bytes(b'')
            f.symlink_to(outside)
            with self.assertRaisesRegex(ValueError, 'proof escape'):
                bound_read(root, 'proof', hashes)


if __name__ == '__main__':
    unittest.main(verbosity=2)
