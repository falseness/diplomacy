"""Corrupt raw archived maps; labels and pass booleans never enter the oracle."""
import copy
import json
import os
import unittest
from pathlib import Path
from review_integrated_archive import geometry, neighbours


@unittest.skipUnless(os.environ.get('TASK225_INTEGRATED_ARCHIVE'), 'explicit real archive required')
class IntegratedGeometryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.rows = json.loads((Path(os.environ['TASK225_INTEGRATED_ARCHIVE']) / 'matrix/maps.json').read_text())

    def setUp(self):
        self.row = copy.deepcopy(self.rows[0])
        self.board = self.row['map']

    def reject(self, reason):
        with self.assertRaisesRegex(ValueError, reason):
            geometry(self.board, self.row['input'])

    def test_all_40_raw_maps(self):
        for row in self.rows:
            with self.subTest(case=row['id']):
                geometry(row['map'], row['input'])

    def test_wrong_category_unchanged_total(self):
        self.board['portals'][0]['category'] = 'unknown'
        self.reject('categories')

    def test_missing_portal(self):
        self.board['portals'].pop()
        self.reject('categories')

    def test_duplicate_coordinate(self):
        self.board['portals'][0].update({k: self.board['portals'][1][k] for k in ['x', 'y']})
        self.reject('overlap-or-bounds')

    def test_outside_map(self):
        self.board['portals'][0]['x'] = self.board['mapSize']['x']
        self.reject('overlap-or-bounds')

    def test_wrong_starting_gold(self):
        self.board['players'][1]['gold'] += 10
        self.reject('assets')

    def test_non_square(self):
        self.board['mapSize']['y'] += 1
        self.reject('square')

    def test_blocked_approach(self):
        p = self.board['portals'][0]
        cells = set(neighbours((p['x'], p['y'])))
        # Replace adjacent terrain with mountains, retaining a disjoint map.
        for name in ['mountains', 'lakes', 'bushes', 'hills']:
            self.board[name] = [c for c in self.board[name] if (c['x'], c['y']) not in cells]
        n = self.board['mapSize']['x']
        protected = {(c['x'], c['y']) for c in self.board['portals'] + self.board['goldmines']}
        protected.update((c['x'], c['y']) for player in self.board['players'] for c in player['towns'])
        self.board['mountains'] += [dict(x=x, y=y) for x, y in cells
                                    if 0 <= x < n and 0 <= y < n and (x, y) not in protected]
        self.reject('unreachable|approach')


@unittest.skipUnless(os.environ.get('TASK225_INTEGRATED_ARCHIVE'), 'explicit real archive required')
class IntegratedAccountingTests(unittest.TestCase):
    def setUp(self):
        import tempfile
        import shutil
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name) / 'archive'
        shutil.copytree(os.environ['TASK225_INTEGRATED_ARCHIVE'], self.root)

    def alter(self, name, change):
        from review_integrated_archive import digest
        file = self.root/name
        data = json.loads(file.read_text()); change(data); file.write_text(json.dumps(data))
        coverage_file = self.root/'coverage-results.json'
        coverage = json.loads(coverage_file.read_text())
        if name in coverage['evidenceHashes']:
            coverage['evidenceHashes'][name] = digest(file)
            coverage_file.write_text(json.dumps(coverage))

    def reject(self, message):
        from review_integrated_archive import review
        with self.assertRaisesRegex(ValueError, message):
            review(self.root, historical=True)

    def test_missing_case(self):
        self.alter('coverage-results.json', lambda r: r['cases'].pop())
        self.reject('exact-completed-cases')

    def test_nonzero_exit(self):
        self.alter('coverage-results.json', lambda r: r['commandExits'][0].update(exit=7))
        self.reject('command/exit')

    def test_false_cleanup(self):
        self.alter('coverage-results.json', lambda r: r['commandExits'][0]['supervision'].update(cleanup=False))
        self.reject('supervision/cleanup')

    def test_false_budget(self):
        self.alter('verification-budget.json', lambda r: r.update(elapsedMs=1))
        self.reject('elapsed-arithmetic')

    def test_expected_observed_corruption(self):
        self.alter('checkpoints.json', lambda r: r['checkpoints'][0].update(observed='forged'))
        self.reject('checkpoint/equal')

    def test_missing_matrix_proof(self):
        from review_integrated_archive import review
        (self.root/'matrix/maps.json').unlink()
        with self.assertRaises(FileNotFoundError):
            review(self.root, historical=True)


if __name__ == '__main__':
    unittest.main()
