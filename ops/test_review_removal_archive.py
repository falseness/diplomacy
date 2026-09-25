"""Real-archive corruption controls; set TASK225_REMOVAL_ARCHIVE explicitly."""
import json
import os
import shutil
import tempfile
import unittest
from pathlib import Path

from review_removal_archive import digest, review


@unittest.skipUnless(os.environ.get('TASK225_REMOVAL_ARCHIVE'), 'explicit real archive required')
class RemovalArchiveTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name) / 'archive'
        shutil.copytree(os.environ['TASK225_REMOVAL_ARCHIVE'], self.root)

    def alter(self, name, mutation):
        file = self.root / name
        if name.endswith('.jsonl'):
            data = [json.loads(s) for s in file.read_text().splitlines()]
            mutation(data)
            file.write_text(''.join(json.dumps(r) + '\n' for r in data))
        else:
            data = json.loads(file.read_text())
            mutation(data)
            file.write_text(json.dumps(data))
        # Rehash to require semantic rejection, beyond ordinary hash integrity.
        coverage_file = self.root / 'coverage-results.json'
        coverage = json.loads(coverage_file.read_text())
        if name in coverage['evidenceHashes']:
            coverage['evidenceHashes'][name] = digest(file)
            coverage_file.write_text(json.dumps(coverage))

    def rejects(self, marker):
        with self.assertRaisesRegex(ValueError, marker):
            review(self.root, require_current=False)

    def test_missing_proof(self):
        (self.root / 'state-traces.json').unlink()
        with self.assertRaises(FileNotFoundError):
            review(self.root, require_current=False)

    def test_changed_proof_hash(self):
        with (self.root / 'state-traces.json').open('a') as stream:
            stream.write(' ')
        self.rejects('hash/state-traces')

    def test_wrong_run(self):
        self.alter('request-traces.jsonl', lambda r: r[1].update(runID='other-run'))
        self.rejects('trace/run')

    def test_missing_revision(self):
        self.alter('request-traces.jsonl', lambda r: r.__setitem__(slice(None), [x for x in r if x.get('commit', {}).get('revision') != 3]))
        self.rejects('trace/revisions')

    def test_wrong_recipient(self):
        def corrupt(rows):
            for row in rows:
                if row.get('commit', {}).get('revision') == 3:
                    row['identity'] = rows[1]['identity']
        self.alter('request-traces.jsonl', corrupt)
        self.rejects('trace/revisions')

    def test_double_income_even_when_recipients_agree(self):
        def corrupt(rows):
            for row in rows:
                if row.get('commit', {}).get('revision') == 2:
                    row['payload']['players'][1]['gold'] += 10
        self.alter('request-traces.jsonl', corrupt)
        self.rejects('trace/projected-gold')

    def test_wrong_hp(self):
        def corrupt(rows):
            next(r for r in rows if r.get('commit', {}).get('revision') == 3)['payload']['players'][1]['units'][0]['hp'] += 1
        self.alter('request-traces.jsonl', corrupt)
        self.rejects('trace/same-revision-state')

    def test_wrong_moves(self):
        def corrupt(rows):
            next(r for r in rows if r.get('commit', {}).get('revision') == 3)['payload']['players'][1]['units'][0]['moves'] += 1
        self.alter('request-traces.jsonl', corrupt)
        self.rejects('trace/same-revision-state')

    def test_persistence_delta(self):
        def corrupt(report):
            row = next(c for c in report['checks'] if c['id'] == 'save/generation-v1')
            for key in ['expected', 'observed']:
                row[key]['rows']['users'].append(dict(userId='injected-write'))
        self.alter('checkpoints.json', corrupt)
        self.rejects('checkpoint/expected/save/generation-v1')

    def test_wrong_rejection_fixture(self):
        self.alter('obsolete-rejection-payloads.json', lambda p: p[0]['input']['gameSettings']['coop']['generation'].update(version=4))
        self.rejects('creation-payload/generation-v1')

    def test_omitted_case(self):
        self.alter('coverage-results.json', lambda c: c['cases'].pop())
        self.rejects('exact-completed-cases')

    def test_cleanup(self):
        self.alter('request-traces.jsonl', lambda r: r[-1].update(socketsDisconnected=False))
        self.rejects('trace/sockets-closed')

    def test_bad_exit(self):
        self.alter('coverage-results.json', lambda c: c['commandExits'][0].update(exit=1))
        self.rejects('command-exits')

    def test_budget(self):
        self.alter('verification-budget.json', lambda b: b.update(elapsedMs=1))
        self.rejects('elapsed-arithmetic')

    def test_stale_source(self):
        def corrupt(s):
            files = s['files']['server']['files']
            files[next(iter(files))] = '0' * 64
        self.alter('source-identities.json', corrupt)
        with self.assertRaisesRegex(ValueError, 'current-source-differences'):
            review(self.root)


if __name__ == '__main__':
    unittest.main()
