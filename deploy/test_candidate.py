#!/usr/bin/env python3
"""Small rejection/committed-tree fixtures; no production endpoints."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
import candidate as c


class CandidateTests(unittest.TestCase):
    def test_paths_links_files(self):
        with tempfile.TemporaryDirectory() as t:
            root = Path(t)
            (root / 'ok').write_text('ok')
            manifest = {'files': c.inventory(root), 'repositories': {}}
            c.verify(root, manifest)
            (root / 'ok').write_text('corrupt')
            with self.assertRaises(ValueError): c.verify(root, manifest)
            print('PASS corrupt file rejected')
            (root / 'ok').unlink()
            with self.assertRaises(ValueError): c.verify(root, manifest)
            print('PASS missing file rejected')
            for name in ['../escape', '/absolute', 'a/../b', 'a//b']:
                with self.assertRaises(ValueError): c.safe_path(name)
            print('PASS unsafe path rejected')
            (root / 'escape').symlink_to('/etc/passwd')
            with self.assertRaises(ValueError): c.inventory(root)
            print('PASS unsafe symlink rejected')

    def test_snapshot(self):
        with tempfile.TemporaryDirectory() as t:
            repo = Path(t) / 'repo'; repo.mkdir()
            def git(*args): return c.git(repo, *args)
            git('init', '-b', 'fixture')
            git('config', 'core.hooksPath', '/dev/null')
            git('config', 'user.email', 'fixture@example.invalid'); git('config', 'user.name', 'fixture')
            for name, content in [('main.js', 'committed'), ('artifacts/secret.js', 'excluded'), ('options/private.key', 'excluded')]:
                p = repo / name; p.parent.mkdir(exist_ok=True); p.write_text(content)
            git('add', '.'); git('commit', '-m', 'fixture')
            (repo / 'main.js').write_text('dirty'); (repo / 'untracked.js').write_text('untracked')
            out = Path(t) / 'out'
            info = c.snapshot(repo, 'diplomacy', out)
            self.assertEqual((out / 'diplomacy/main.js').read_text(), 'committed')
            self.assertEqual(list(info['sources']), ['diplomacy/main.js'])
            self.assertEqual(info['branch'], 'fixture')
            print('PASS committed bytes exclude worktree patches secrets artifacts untracked')

    def test_runtime(self):
        with tempfile.TemporaryDirectory() as t:
            dist = Path(t)
            with self.assertRaises(ValueError): c.runtime(dist)
            print('PASS missing runtime rejected before output/live mutations')
            (dist / 'bin').mkdir(); (dist / 'lib/node_modules/npm/bin').mkdir(parents=True)
            (dist / 'lib/node_modules/npm/bin/npm-cli.js').touch()
            node = dist / 'bin/node'; node.write_text('#!/bin/sh\necho v18.20.0\n'); node.chmod(0o755)
            with self.assertRaises(ValueError): c.runtime(dist)
            print('PASS system Node 18 rejected before output/live mutations')
            node.write_text('#!/bin/sh\nexit 17\n')
            with self.assertRaises(RuntimeError): c.run([node, 'npm', 'ci'])
            print('PASS dependency command failure propagated before activation')
            node20 = Path('/usr/local/bin/node20')
            with self.assertRaises(RuntimeError):
                c.run([node20, '-e', "require('./missing-deployment-dependency')"], cwd=dist)
            print('PASS missing required dependency rejected before live mutations')
            (dist / 'package.json').write_text('{"dependencies":{"nonexistent-deploy-fixture":"1.0.0"}}')
            (dist / 'package-lock.json').write_text('{"lockfileVersion":3,"packages":{}}')
            npm = Path('/usr/local/lib/nodejs/node-v20.20.2-linux-x64/lib/node_modules/npm/bin/npm-cli.js')
            with self.assertRaises(RuntimeError):
                c.run([node20, npm, 'ci', '--offline', '--ignore-scripts', '--no-audit'], cwd=dist)
            print('PASS real locked dependency install failure rejected before live mutations')

    def test_rules(self):
        # Real committed generated files and both shipped checkers, on a disposable snapshot.
        with tempfile.TemporaryDirectory() as t:
            root = Path(t)
            client = Path(os.environ['DIPLOMACY_CLIENT_ROOT'])
            c.snapshot(client, 'diplomacy', root)
            c.snapshot(client.parent / 'diplomacy_server', 'diplomacy_server', root)
            node = Path('/usr/local/bin/node20')
            c.rules(root, node)
            p = root / 'diplomacy/options/rulesVersion.js'; original = p.read_bytes()
            p.write_text('const RULES_VERSION="mismatch"')
            with self.assertRaises(RuntimeError): c.rules(root, node)
            p.write_bytes(original)
            print('PASS mismatched committed rules version rejected')
            p = root / 'diplomacy/options/tutorials.js'; p.write_text(p.read_text() + '\n// stale\n')
            with self.assertRaises(RuntimeError): c.rules(root, node)
            print('PASS stale committed rules manifest rejected')
            (root / 'diplomacy/rules-manifest.json').unlink()
            with self.assertRaises(RuntimeError): c.rules(root, node)
            print('PASS missing committed rules manifest rejected')


if __name__ == '__main__': unittest.main(verbosity=2)
