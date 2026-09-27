"""Corrupt copied real proof, rebind it, and require semantic rejection."""
import json
from pathlib import Path
import shutil
import tempfile
import unittest

from review_asset_archive import review, sha

ARCHIVE = Path('/root/diplomacy/artifacts/TASK-211/green-07')
MANIFEST = '5580af417e65f71de3811ecb46e569a528431e1f241017a326a1af7bcc349f98'


class AssetReviewTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        names = ['coverage-results.json', 'source-identities.json', 'asset-requests.jsonl']
        for case in ('cold-warm-delay', 'failed-recovery'):
            names += [f'{case}/{case}-p1-assets.json', f'{case}/served-sources.json', f'{case}/browser-errors.json']
        for name in names:
            dest = self.root/name
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ARCHIVE/name, dest)

    def mutate(self, name, change, rebind=True):
        path = self.root/name
        value = json.loads(path.read_text())
        change(value)
        path.write_text(json.dumps(value))
        if rebind:
            manifest = self.root/'coverage-results.json'
            data = json.loads(manifest.read_text())
            data['evidenceHashes'][name] = sha(path)
            manifest.write_text(json.dumps(data))

    def reject(self, marker):
        with self.assertRaisesRegex(ValueError, marker):
            review(self.root, sha(self.root/'coverage-results.json'))

    def test_real_archive(self):
        result = review(self.root, MANIFEST)
        self.assertTrue(result['assetObservationsPass'])
        self.assertFalse(result['wholeCriterionClosure'])
        self.assertFalse(result['fullAuditReady'])
        self.assertEqual(result['sourceHashes'], 899)

    def test_manifest_tampering(self):
        with self.assertRaisesRegex(ValueError, 'manifest-binding'):
            review(self.root, '0'*64)

    def test_unbound_proof_tampering(self):
        self.mutate('cold-warm-delay/browser-errors.json', lambda x: x.append('unexpected'), False)
        self.reject('hash/cold-warm-delay/browser-errors')

    def test_false_warm_cache(self):
        self.mutate('cold-warm-delay/cold-warm-delay-p1-assets.json', lambda x: x.update(cachedRequests=[]))
        self.reject('online-logic-cached')

    def test_false_delay(self):
        self.mutate('cold-warm-delay/cold-warm-delay-p1-assets.json', lambda x: x.update(delayMs=0))
        self.reject('delay-at-least-1000ms')

    def test_wrong_shipped_html(self):
        self.mutate('cold-warm-delay/served-sources.json', lambda x: x.update({'index.html':'0'*64}))
        self.reject('html-shipped')

    def test_omitted_participant_trace(self):
        self.mutate('failed-recovery/failed-recovery-p1-assets.json', lambda x: x.update(requests=[]))
        self.reject('participant-trace-prefix')

    def test_missing_proof(self):
        (self.root/'asset-requests.jsonl').unlink()
        with self.assertRaises(FileNotFoundError):
            review(self.root, MANIFEST)

    def test_escaped_proof(self):
        path = self.root/'asset-requests.jsonl'
        path.unlink()
        path.symlink_to(ARCHIVE/'asset-requests.jsonl')
        self.reject('escaped-proof')


if __name__ == '__main__':
    unittest.main(verbosity=2)
