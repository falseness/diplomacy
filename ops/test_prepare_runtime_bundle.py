"""Isolated byte-packaging controls; fixtures are never release readiness proof."""
import contextlib
import io
import json
import os
from pathlib import Path
import tarfile
import time
import unittest
from unittest.mock import patch

import prepare_runtime_bundle as bundle
from test_prepare_release import ReleasePackaging


class RuntimeBundle(unittest.TestCase):
    def setUp(self):
        # Reuse repository fixture setup without inheriting/repeating credited tests.
        self.fixture = ReleasePackaging()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.root = self.fixture.root
        self.runtime = self.root / 'node'
        self.dependencies = self.root / 'modules'
        self.runtime.mkdir()
        self.dependencies.mkdir()
        self.fixture.write(self.runtime, 'bin/node', 'synthetic executable bytes; never executed')
        (self.runtime / 'bin/node').chmod(0o755)
        self.fixture.write(self.dependencies, 'example/package.json', json.dumps({'name': 'example', 'version': '1.2.3'}))
        self.fixture.write(self.dependencies, 'example/bin.js', 'synthetic installed bytes')
        (self.dependencies / '.bin').mkdir()
        (self.dependencies / '.bin/example').symlink_to('../example/bin.js')
        self.fixture.write(self.fixture.server, 'server/package.json', json.dumps({'dependencies': {'example': '^1.2.0'}}))
        self.fixture.write(self.fixture.server, 'server/package-lock.json', json.dumps({'lockfileVersion': 3, 'packages': {
            '': {'dependencies': {'example': '^1.2.0'}}, 'node_modules/example': {'version': '1.2.3'}}}))
        self.fixture.capture()
        self.receipt = self.root / 'runtime-receipt.json'
        self.capture()

    def capture(self):
        self.receipt.write_text(json.dumps({
            'source_manifest_sha256': bundle.source_package.sha(self.fixture.evidence.read_bytes()),
            'identity': {'node': 'synthetic-not-executed', 'platform': 'fixture', 'arch': 'fixture'},
            'runtime': bundle.snapshot(self.runtime, time.time() + 60)[0],
            'dependencies': bundle.snapshot(self.dependencies, time.time() + 60)[0]}))

    def prepare(self, name='output', stop_at=None):
        with contextlib.redirect_stdout(io.StringIO()):
            return bundle.prepare(self.fixture.client, self.fixture.server, self.fixture.evidence,
                                  self.runtime, self.dependencies, self.receipt, self.root / name,
                                  stop_at if stop_at is not None else time.time() + 60)

    def test_exact_pair_readback_modes_links_and_no_readiness(self):
        manifest = self.prepare()
        self.assertFalse(manifest['releaseReady'])
        self.assertEqual(manifest['installed_direct_dependencies']['example']['version'], '1.2.3')
        with tarfile.open(self.root / 'output/runtime-dependencies.tar.gz') as tar:
            self.assertEqual(tar.extractfile('runtime/bin/node').read(), b'synthetic executable bytes; never executed')
            self.assertEqual(tar.getmember('runtime/bin/node').mode, 0o755)
            self.assertEqual(tar.getmember('diplomacy_server/server/node_modules/.bin/example').linkname, '../example/bin.js')
        for forbidden in ('READY', 'release-manifest.json'):
            self.assertFalse((self.root / 'output' / forbidden).exists())
        self.assertEqual(sorted(manifest['inventory']), [
            'diplomacy_server/server/node_modules',
            'diplomacy_server/server/node_modules/.bin',
            'diplomacy_server/server/node_modules/.bin/example',
            'diplomacy_server/server/node_modules/example',
            'diplomacy_server/server/node_modules/example/bin.js',
            'diplomacy_server/server/node_modules/example/package.json',
            'runtime', 'runtime/bin', 'runtime/bin/node'])
        self.assertEqual(manifest['archive_members'], 9)

    def test_runtime_bytes_and_modes_must_match_verified_receipt(self):
        node = self.runtime / 'bin/node'
        node.write_text('changed executable')
        with self.assertRaisesRegex(ValueError, 'verified-runtime-inventory-changed: runtime'):
            self.prepare()
        self.assertFalse((self.root / 'output').exists())
        self.capture()
        node.chmod(0o644)
        with self.assertRaisesRegex(ValueError, 'verified-runtime-inventory-changed: runtime'):
            self.prepare()

    def test_dependency_addition_deletion_and_link_retarget_are_rejected(self):
        extra = self.dependencies / 'unverified.js'
        extra.write_text('extra')
        with self.assertRaisesRegex(ValueError, 'verified-runtime-inventory-changed: dependencies'):
            self.prepare()
        extra.unlink()
        link = self.dependencies / '.bin/example'
        link.unlink()
        with self.assertRaisesRegex(ValueError, 'verified-runtime-inventory-changed: dependencies'):
            self.prepare()
        link.symlink_to('../example/package.json')
        with self.assertRaisesRegex(ValueError, 'verified-runtime-inventory-changed: dependencies'):
            self.prepare()
        self.assertFalse((self.root / 'output').exists())

    def test_escape_absolute_broken_links_and_symlink_root_rejected(self):
        link = self.dependencies / '.bin/example'
        for target, reason in [('../../runtime-receipt.json', 'escaping-or-broken'),
                               (str(self.receipt), 'absolute-runtime-link'),
                               ('../missing', 'escaping-or-broken')]:
            link.unlink()
            link.symlink_to(target)
            with self.assertRaisesRegex(ValueError, reason):
                self.prepare()
        linked_root = self.root / 'linked-node'
        linked_root.symlink_to(self.runtime)
        with self.assertRaisesRegex(ValueError, 'unsafe-runtime-root'):
            bundle.snapshot(linked_root, time.time() + 60)

    def test_artifacts_special_files_and_privileged_modes_rejected(self):
        artifact = self.runtime / 'artifacts'
        artifact.mkdir()
        with self.assertRaisesRegex(ValueError, 'excluded-runtime-path'):
            self.prepare()
        artifact.rmdir()
        fifo = self.runtime / 'fifo'
        os.mkfifo(fifo)
        with self.assertRaisesRegex(ValueError, 'special-runtime-file'):
            self.prepare()
        fifo.unlink()
        (self.runtime / 'bin/node').chmod(0o4755)
        with self.assertRaisesRegex(ValueError, 'privileged-runtime-mode'):
            self.prepare()

    def test_source_receipt_binding_rejected_before_output(self):
        self.fixture.evidence.write_text(self.fixture.evidence.read_text() + '\n')
        with self.assertRaisesRegex(ValueError, 'runtime-source-receipt-mismatch'):
            self.prepare()
        self.assertFalse((self.root / 'output').exists())

    def test_missing_identity_and_nonexecutable_node_fail(self):
        value = json.loads(self.receipt.read_bytes())
        value['identity'].pop('node')
        self.receipt.write_text(json.dumps(value))
        with self.assertRaisesRegex(ValueError, 'missing-runtime-identity'):
            self.prepare()
        (self.runtime / 'bin/node').chmod(0o644)
        self.capture()
        with self.assertRaisesRegex(ValueError, 'missing-executable-node'):
            self.prepare()
        self.assertFalse((self.root / 'output').exists())

    def test_changed_evidence_during_packaging_cannot_publish_success(self):
        original = bundle.source_package.prepare

        def mutate(*args):
            original(*args)
            self.receipt.write_text(self.receipt.read_text() + '\n')

        with patch.object(bundle.source_package, 'prepare', mutate):
            with self.assertRaisesRegex(ValueError, 'changed-package-evidence'):
                self.prepare()
        self.assertFalse((self.root / 'output/paired-package.json').exists())

    def test_lock_mismatch_keeps_partial_output_without_success_receipt(self):
        self.fixture.write(self.dependencies, 'example/package.json', json.dumps({'name': 'example', 'version': '9.9.9'}))
        self.capture()
        with self.assertRaisesRegex(ValueError, 'installed-dependency-lock-mismatch: example'):
            self.prepare()
        self.assertTrue((self.root / 'output/candidate.tar.gz').exists())
        self.assertFalse((self.root / 'output/paired-package.json').exists())

    def test_missing_dependency_and_lock_root_mismatch_fail(self):
        (self.dependencies / 'example/package.json').unlink()
        self.capture()
        with self.assertRaisesRegex(ValueError, 'missing-installed-dependency: example'):
            self.prepare('missing')
        self.fixture.write(self.fixture.server, 'server/package-lock.json', '{"packages": {}}')
        self.fixture.capture()
        self.capture()
        with self.assertRaisesRegex(ValueError, 'package-lock-root-mismatch'):
            self.prepare('lock')

    def test_deadline_and_no_overwrite(self):
        with self.assertRaisesRegex(ValueError, 'runtime-package-deadline'):
            self.prepare(stop_at=time.time() - 1)
        self.assertFalse((self.root / 'output').exists())
        self.prepare()
        sentinel = self.root / 'output/paired-package.json'
        before = sentinel.read_bytes()
        with self.assertRaisesRegex(ValueError, 'Refusing to overwrite'):
            self.prepare()
        self.assertEqual(sentinel.read_bytes(), before)

    def test_archive_reproducibility_and_tamper_readback(self):
        first = self.prepare('first')
        os.utime(self.runtime / 'bin/node', (100, 100))
        second = self.prepare('second')
        self.assertEqual(first['runtime_archive_sha256'], second['runtime_archive_sha256'])
        expected = dict(first['inventory'])
        expected['runtime/bin/node'] = dict(expected['runtime/bin/node'], mode=0o644)
        with self.assertRaisesRegex(ValueError, 'runtime-archive-readback-mismatch'):
            bundle.verify_archive(self.root / 'first/runtime-dependencies.tar.gz', expected, time.time() + 60)

    def test_archive_uses_verified_snapshot_if_dependency_changes_during_write(self):
        original = tarfile.TarFile.addfile

        def mutate(tar, member, fileobj=None):
            (self.dependencies / 'example/bin.js').write_text('changed after snapshot')
            return original(tar, member, fileobj)

        with patch.object(tarfile.TarFile, 'addfile', mutate):
            self.prepare()
        with tarfile.open(self.root / 'output/runtime-dependencies.tar.gz') as tar:
            self.assertEqual(tar.extractfile('diplomacy_server/server/node_modules/example/bin.js').read(), b'synthetic installed bytes')


if __name__ == '__main__':
    # Loading only this class avoids re-running the ten credited source controls.
    unittest.main(defaultTest='RuntimeBundle', verbosity=2)
