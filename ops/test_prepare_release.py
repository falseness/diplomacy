"""Source packaging tests use temporary repositories, never public services."""
import contextlib
import io
import json
import os
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest
from unittest.mock import patch

import prepare_release as release


class ReleasePackaging(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.client, self.server = self.root / 'client', self.root / 'server'
        for repo in (self.client, self.server):
            repo.mkdir()
            self.git(repo, 'init', '-q')
            self.git(repo, 'config', 'user.email', 'fixture@example.invalid')
            self.git(repo, 'config', 'user.name', 'fixture')
        self.write(self.client, 'index.html', '<script src="game.js"></script>')
        self.write(self.client, 'game.js', 'const version = 1;')
        self.write(self.client, 'README.md', 'readme-before')
        self.write(self.server, 'server/loadGameCode.js', "const scriptOrder = ['game.js'];")
        self.write(self.server, 'server/package-lock.json', '{}')
        self.write(self.server, 'server/tls.key', 'key-before')
        for repo in (self.client, self.server):
            self.git(repo, 'add', '.')
            self.git(repo, 'commit', '-qm', 'fixture')
        # Simulate an accidental indexed artifact without ever committing it.
        self.write(self.client, 'artifacts/private.txt', 'artifact-before')
        self.git(self.client, 'add', 'artifacts/private.txt')
        self.evidence = self.root / 'sources.json'
        self.capture()

    def git(self, repo, *args):
        result = subprocess.run(['git', '-C', str(repo), *args], stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        if result.returncode:
            raise RuntimeError(result.stdout.decode())
        return result.stdout

    def write(self, repo, name, value):
        file = repo / name
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_text(value)
        return file

    def capture(self):
        self.evidence.write_text(json.dumps({'sources': {
            str(p): release.sha(p.read_bytes()) for repo in (self.client, self.server)
            for p in repo.rglob('*') if p.is_file() and '.git' not in p.parts}}))

    def prepare(self, name='candidate'):
        out = self.root / name
        with contextlib.redirect_stdout(io.StringIO()):
            release.prepare(self.client, self.server, self.evidence, out)
        return out

    def test_scoped_patch_excludes_artifacts_keys_and_unrelated_edits(self):
        self.write(self.client, 'artifacts/private.txt', 'ARTIFACT_SECRET')
        self.write(self.client, 'README.md', 'UNRELATED_EDIT')
        self.write(self.server, 'server/tls.key', 'KEY_SECRET')
        self.write(self.client, 'game.js', 'const version = 2;')
        self.capture()
        before = {repo: self.git(repo, 'status', '--porcelain') for repo in (self.client, self.server)}
        out = self.prepare()
        patches = b''.join(p.read_bytes() for p in out.glob('*.patch'))
        self.assertIn(b'const version = 2;', patches)
        for forbidden in (b'ARTIFACT_SECRET', b'UNRELATED_EDIT', b'KEY_SECRET', b'artifacts/'):
            self.assertNotIn(forbidden, patches)
        with tarfile.open(out / 'candidate.tar.gz') as tar:
            self.assertEqual(tar.getnames(), ['diplomacy/game.js', 'diplomacy/index.html',
                'diplomacy_server/server/loadGameCode.js', 'diplomacy_server/server/package-lock.json'])
        for repo in (self.client, self.server):
            self.assertEqual(before[repo], self.git(repo, 'status', '--porcelain'))

    def test_staged_deletion_remains_in_release_patch(self):
        self.git(self.server, 'rm', 'server/package-lock.json')
        out = self.prepare()
        self.assertIn(b'deleted file mode', (out / 'diplomacy_server.patch').read_bytes())
        manifest = json.loads((out / 'candidate-manifest.json').read_text())
        self.assertNotIn('diplomacy_server/server/package-lock.json', manifest['files'])

    def test_stale_source_rejected_before_output(self):
        self.write(self.client, 'game.js', 'untested bytes')
        with self.assertRaisesRegex(ValueError, 'Source not verified or changed'):
            self.prepare()
        self.assertFalse((self.root / 'candidate').exists())

    def test_untracked_source_requires_hash_and_is_manifested(self):
        self.write(self.client, 'extra.js', 'untracked runtime')
        with self.assertRaisesRegex(ValueError, 'Source not verified or changed'):
            self.prepare()
        self.capture()
        out = self.prepare()
        manifest = json.loads((out / 'candidate-manifest.json').read_text())
        self.assertEqual(manifest['revisions']['diplomacy']['untracked_files'], ['extra.js'])
        self.assertTrue(manifest['revisions']['diplomacy']['dirty'])
        self.assertEqual(manifest['files']['diplomacy/extra.js'], release.sha(b'untracked runtime'))

    def test_symlink_source_rejected_even_with_matching_hash(self):
        source = self.client / 'game.js'
        outside = self.write(self.root, 'outside.js', 'const version = 1;')
        source.unlink()
        source.symlink_to(outside)
        with self.assertRaisesRegex(ValueError, 'Symlink release source'):
            self.prepare()

    def test_reproducible_archive_and_no_overwrite(self):
        first = self.prepare('first')
        os.utime(self.client / 'game.js', (1234, 1234))
        second = self.prepare('second')
        self.assertEqual((first / 'candidate.tar.gz').read_bytes(), (second / 'candidate.tar.gz').read_bytes())
        with self.assertRaisesRegex(ValueError, 'Refusing to overwrite'):
            self.prepare('first')

    def test_archive_uses_checked_snapshot_when_source_changes(self):
        original = tarfile.TarFile.addfile
        changed = False

        def mutate(tar, member, fileobj=None):
            nonlocal changed
            if not changed:
                self.write(self.client, 'game.js', 'changed after verification')
                changed = True
            return original(tar, member, fileobj)

        with patch.object(tarfile.TarFile, 'addfile', mutate):
            out = self.prepare()
        with tarfile.open(out / 'candidate.tar.gz') as tar:
            self.assertEqual(tar.extractfile('diplomacy/game.js').read(), b'const version = 1;')

    def test_missing_runtime_script_rejected_before_output(self):
        (self.client / 'game.js').unlink()
        self.capture()
        with self.assertRaisesRegex(ValueError, 'Missing runtime script: game.js'):
            self.prepare()
        self.assertFalse((self.root / 'candidate').exists())


if __name__ == '__main__':
    unittest.main(verbosity=2)
