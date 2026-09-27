"""Copied real-archive controls; rebound hashes must not mask false semantics."""
import json
import shutil
import unittest

import test_review_asset_archive as assets

ARCHIVE, MANIFEST = assets.ARCHIVE, assets.MANIFEST
from review_version_archive import review, PROOFS
from review_asset_archive import sha


class VersionReviewTests(assets.AssetReviewTests):
    def setUp(self):
        super().setUp()
        for name in PROOFS:
            dest = self.root/name
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ARCHIVE/name, dest)

    def reject(self, marker):
        with self.assertRaisesRegex(ValueError, marker):
            review(self.root, sha(self.root/'coverage-results.json'))

    def events(self, change):
        name = 'asset-events.jsonl'
        path = self.root/name
        rows = [json.loads(line) for line in path.read_text().splitlines()]
        change(rows)
        path.write_text(''.join(json.dumps(r)+'\n' for r in rows))
        self.mutate('coverage-results.json', lambda x: x['evidenceHashes'].update({name:sha(path)}), False)

    def test_real_version_archive(self):
        result = review(self.root, MANIFEST)
        self.assertTrue(result['versionObservationsPass'])
        self.assertFalse(result['wholeCriterionClosure'])
        self.assertFalse(result['fullAuditReady'])

    def test_omitted_case(self):
        self.mutate('version-matrix.json', lambda x: x['cases'].pop())
        self.reject('matrix/cases')

    def test_wrong_pair(self):
        self.mutate('version-matrix.json', lambda x: x['cases'][3].update(server='candidate'))
        self.reject('old-server/pair')

    def test_rejection_omitted(self):
        self.events(lambda x: x.__setitem__(slice(None), [r for r in x if not
                    (r.get('player')=='old-client-p2' and r.get('event')=='lobbyStatus')]))
        self.reject('old-client-p2/rejection-sequence')

    def test_wrong_message(self):
        def change(rows):
            next(r for r in rows if r.get('player')=='old-client-p1' and r.get('event')=='lobbyStatus')['args'][0]['json']['occupiedHumans']='Try again'
        self.events(change)
        self.reject('reload-message')

    def test_board_before_upgrade(self):
        def change(rows):
            next(r for r in rows if r.get('player')=='old-client-p1' and r.get('event')=='lobbyStatus')['event']='playYourTurn'
        self.events(change)
        self.reject('rejection-sequence')

    def test_wrong_recovered_slot(self):
        def change(rows):
            next(r for r in rows if r.get('player')=='old-client-p1' and r.get('event')=='playYourTurn')['args'][0]['json']['whooseTurn']=2
        self.events(change)
        self.reject('candidate-slot')

    def test_double_income_in_observed_database(self):
        def change(data):
            c=next(c for c in data['checkpoints'] if c['id']=='old-client/rejected-state-unchanged')
            c['observed'][0]['rounds'][0][1]['turns'][0]['preparedTurnState']['player']['gold']+=9
            c['expected']=c['observed']  # self-consistent old assertion must still fail
        self.mutate('checkpoints.json', change)
        self.reject('unsubmitted-component-1')

    def test_fabricated_accepted_turn(self):
        def change(data):
            c=next(c for c in data['checkpoints'] if c['id']=='old-client/rejected-state-unchanged')
            c['observed'][0]['rounds'][0][2]['nextTurnIndex']=1
        self.mutate('checkpoints.json', change)
        self.reject('unsubmitted-component-2')

    def test_missing_upgrade(self):
        self.events(lambda rows: rows.__setitem__(slice(None), [r for r in rows if r.get('engine')!='40{"browserProtocol":1}']))
        self.reject('upgrade-count')

    def test_tampered_archived_served_source(self):
        self.mutate('old-client/archived-served-sources.json', lambda x: x.update({'index.html':'0'*64}))
        self.reject('archived-served-sources.json/index.html')


if __name__ == '__main__':
    unittest.main(verbosity=2)
