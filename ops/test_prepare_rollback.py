"""Synthetic installation controls; no live host or release authorization."""
import copy
import contextlib
import io
import json
from pathlib import Path
import tarfile
import tempfile
import time
import unittest
from unittest.mock import patch

import prepare_rollback as rollback


class RetainRollback(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.roots = {role: self.root / role for role in rollback.ROLES}
        self.files = {'client': 'game.js', 'server': 'server/index.js', 'web': 'index.html',
                      'runtime': 'bin/node', 'config': 'service.conf'}
        for role, name in self.files.items():
            target = self.roots[role] / name
            target.parent.mkdir(parents=True)
            target.write_text('prior-' + role)
        (self.roots['runtime'] / 'bin/node').chmod(0o755)
        modules = self.roots['server'] / 'server/node_modules/pkg'
        modules.mkdir(parents=True)
        (modules / 'index.js').write_text('prior dependency')
        (modules / 'alias.js').symlink_to('index.js')
        self.database = self.root / 'unrelated-live-games'
        self.database.write_bytes(b'preserve games exactly')
        self.observation = {'host': 'fixture-only', 'boot_id': 'fixture-boot',
                            'service': 'fixture.service', 'pid': 123, 'process_start': '42',
                            'observed_at': 'fixture-before',
                            'roots': {k: str(v) for k, v in self.roots.items()},
                            'cwd': str(self.roots['server'] / 'server'),
                            'executable': str(self.roots['runtime'] / 'bin/node')}
        self.evidence = self.root / 'observation.json'
        self.evidence.write_text(json.dumps(self.observation))
        self.digest = rollback.bundle.source_package.sha(self.evidence.read_bytes())
        self.calls = 0

    def observe(self):
        self.calls += 1
        result = copy.deepcopy(self.observation)
        result['observed_at'] = 'fixture-after-' + str(self.calls)
        return result

    def retain(self, name='output', observe=None, stop_at=None):
        with contextlib.redirect_stdout(io.StringIO()):
            return rollback.retain(self.roots, self.evidence, self.digest,
                                   observe or self.observe, self.root / name,
                                   time.time() + 60 if stop_at is None else stop_at)

    def test_exact_pair_runtime_dependencies_config_and_untouched_database(self):
        receipt = self.retain()
        expected = ['client', 'client/game.js', 'config', 'config/service.conf',
                    'runtime', 'runtime/bin', 'runtime/bin/node', 'server', 'server/server',
                    'server/server/index.js', 'server/server/node_modules',
                    'server/server/node_modules/pkg', 'server/server/node_modules/pkg/alias.js',
                    'server/server/node_modules/pkg/index.js', 'web', 'web/index.html']
        self.assertEqual(sorted(receipt['inventory']), expected)
        self.assertEqual(receipt['archive_members'], 16)
        with tarfile.open(self.root / 'output/prior-installation.tar.gz') as tar:
            self.assertEqual(sorted(tar.getnames()), expected)
            for role, name in self.files.items():
                self.assertEqual(tar.extractfile(role + '/' + name).read(), ('prior-' + role).encode())
            self.assertEqual(tar.getmember('runtime/bin/node').mode, 0o755)
            self.assertEqual(tar.getmember('server/server/node_modules/pkg/alias.js').linkname, 'index.js')
        self.assertEqual(self.calls, 2)
        self.assertEqual(self.database.read_bytes(), b'preserve games exactly')
        self.assertFalse(receipt['releaseReady'])
        self.assertFalse(receipt['restorationPerformed'])
        self.assertEqual(receipt['databaseActions'], [])
        self.assertEqual(receipt['serviceActions'], [])
        self.assertFalse((self.root / 'output/rollback-manifest.json').exists())

    def test_process_drift_before_capture_rejected_without_output(self):
        def changed():
            return dict(self.observe(), pid=456)
        with self.assertRaisesRegex(ValueError, 'rollback-process-drift'):
            self.retain(observe=changed)
        self.assertFalse((self.root / 'output').exists())

    def test_process_restart_after_capture_retains_failure_without_receipt(self):
        def changed():
            value = self.observe()
            if self.calls == 2:
                value['process_start'] = '43'
            return value
        with self.assertRaisesRegex(ValueError, 'rollback-process-drift'):
            self.retain(observe=changed)
        self.assertTrue((self.root / 'output/prior-installation.tar.gz').exists())
        self.assertFalse((self.root / 'output/retained-installation.json').exists())

    def test_changed_live_bytes_during_archive_rejected(self):
        original = tarfile.TarFile.addfile
        def mutate(tar, member, fileobj=None):
            (self.roots['web'] / 'index.html').write_text('drift')
            return original(tar, member, fileobj)
        with patch.object(tarfile.TarFile, 'addfile', mutate):
            with self.assertRaisesRegex(ValueError, 'rollback-installation-drift'):
                self.retain()
        self.assertFalse((self.root / 'output/retained-installation.json').exists())

    def test_observation_hash_and_mid_capture_change_rejected(self):
        self.digest = '0' * 64
        with self.assertRaisesRegex(ValueError, 'rollback-observation-hash-mismatch'):
            self.retain()
        self.assertFalse((self.root / 'output').exists())
        self.digest = rollback.bundle.source_package.sha(self.evidence.read_bytes())
        def mutate():
            self.evidence.write_text(self.evidence.read_text() + '\n')
            return self.observe()
        with self.assertRaisesRegex(ValueError, 'rollback-observation-changed'):
            self.retain(observe=mutate)
        self.assertFalse((self.root / 'output/retained-installation.json').exists())

    def test_missing_roots_identity_and_process_path_rejected(self):
        for field in ('host', 'pid', 'boot_id', 'process_start', 'roots', 'cwd', 'executable'):
            with self.subTest(field=field):
                value = copy.deepcopy(self.observation)
                del value[field]
                with self.assertRaises(ValueError):
                    rollback.validate_observation(value, self.roots)
        roots = dict(self.roots)
        del roots['runtime']
        with self.assertRaisesRegex(ValueError, 'rollback-root-roles'):
            rollback.inventory(roots, time.time() + 60)
        (self.roots['runtime'] / 'bin/node').chmod(0o644)
        with self.assertRaisesRegex(ValueError, 'rollback-node-not-executable'):
            self.retain()

    def test_overlapping_roots_and_output_inside_input_rejected(self):
        roots = dict(self.roots, web=self.roots['client'])
        with self.assertRaisesRegex(ValueError, 'overlapping-rollback-roots'):
            rollback.inventory(roots, time.time() + 60)
        with self.assertRaisesRegex(ValueError, 'rollback-output-inside-input'):
            self.retain(name='client/capture')
        with self.assertRaisesRegex(ValueError, 'noncanonical-rollback-output'):
            self.retain(name='client/../capture')
        roots['web'] = self.root / 'client/../web'
        with self.assertRaisesRegex(ValueError, 'noncanonical-rollback-root'):
            rollback.inventory(roots, time.time() + 60)

    def test_symlink_escape_and_excluded_artifacts_rejected(self):
        link = self.roots['client'] / 'escape'
        link.symlink_to('../unrelated-live-games')
        with self.assertRaisesRegex(ValueError, 'escaping-or-broken-runtime-link'):
            self.retain()
        link.unlink()
        (self.roots['server'] / 'artifacts').mkdir()
        with self.assertRaisesRegex(ValueError, 'excluded-runtime-path'):
            self.retain()
        self.assertFalse((self.root / 'output').exists())

    def test_existing_destination_and_parent_link_preserve_sentinel(self):
        out = self.root / 'output'
        out.mkdir()
        (out / 'sentinel').write_bytes(b'keep')
        with self.assertRaisesRegex(ValueError, 'existing-rollback-output'):
            self.retain()
        self.assertEqual((out / 'sentinel').read_bytes(), b'keep')
        (self.root / 'linked').symlink_to(out)
        with self.assertRaisesRegex(ValueError, 'symlink-rollback-output-parent'):
            self.retain(name='linked/child')
        self.assertFalse((out / 'child').exists())

    def test_parent_deadline_prevents_capture(self):
        with self.assertRaisesRegex(ValueError, 'runtime-package-deadline'):
            self.retain(stop_at=time.time() - 1)
        self.assertEqual(self.calls, 0)
        self.assertFalse((self.root / 'output').exists())

    def test_archive_is_reproducible_and_tamper_fails_readback(self):
        first, second = self.retain('first'), self.retain('second')
        self.assertEqual(first['archive_sha256'], second['archive_sha256'])
        changed = copy.deepcopy(first['inventory'])
        changed['runtime/bin/node']['sha256'] = '0' * 64
        with self.assertRaisesRegex(ValueError, 'runtime-archive-readback-mismatch'):
            rollback.bundle.verify_archive(self.root / 'first/prior-installation.tar.gz', changed, time.time() + 60)


if __name__ == '__main__':
    unittest.main(verbosity=2)
