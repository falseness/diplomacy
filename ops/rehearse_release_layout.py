"""Rehearse web/override ownership transitions inside a private temporary tree.

This does not run systemctl, Node, MongoDB, or the historical switch script.
It proves filesystem transition semantics only, never host/service readiness.
"""
import json
from pathlib import Path
import tarfile
import tempfile

import prepare_runtime_bundle as bundle


def require(condition, reason):
    if not condition:
        raise ValueError(reason)


def present(path):
    return path.exists() or path.is_symlink()


class Layout:
    """Paths belong to the caller's isolated rehearsal root, never a live host."""
    def __init__(self, root, override):
        self.root = root
        self.web = root / 'web'
        self.saved = root / 'previous-web'
        self.candidate = root / 'candidate'
        self.override = root / 'release.conf'
        self.expected_override = override
        self.actions = []

    def activate(self):
        # Validate every ownership guard before the first mutation.
        require(self.web.is_dir() and not self.web.is_symlink(), 'web-layout-drift')
        require(not present(self.saved), 'previous-web-already-exists')
        require(not present(self.override), 'override-already-exists')
        require(self.candidate.is_dir() and not self.candidate.is_symlink(), 'candidate-layout-drift')
        self.web.rename(self.saved)
        self.actions.append('retain-web-layout')
        self.web.symlink_to(self.candidate, target_is_directory=True)
        self.actions.append('link-candidate-web')
        with self.override.open('xb') as stream:
            stream.write(self.expected_override)
        self.actions.append('install-owned-override')

    def rollback(self):
        require(self.override.is_file() and not self.override.is_symlink()
                and self.override.read_bytes() == self.expected_override, 'override-ownership-mismatch')
        require(self.web.is_symlink() and self.web.readlink() == self.candidate,
                'web-ownership-mismatch')
        require(self.saved.is_dir() and not self.saved.is_symlink(), 'prior-web-layout-drift')
        self.web.unlink()
        self.saved.rename(self.web)
        self.override.unlink()
        self.actions.extend(['unlink-owned-web', 'restore-prior-web', 'remove-owned-override'])


def project_files(archive, prefix, destination, stop_at):
    """Copy regular web bytes only; never extract archive links or execute code."""
    destination.mkdir()
    count = 0
    with tarfile.open(archive) as tar:
        for member in tar:
            bundle.check_deadline(stop_at)
            if not member.name.startswith(prefix + '/'):
                continue
            relative = member.name[len(prefix) + 1:]
            require(relative and not relative.startswith('/') and
                    all(p not in ('', '.', '..') for p in relative.split('/')), 'unsafe-web-member')
            if member.isdir():
                continue
            require(member.isfile(), 'unsupported-web-member-type')
            target = destination / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            with target.open('xb') as stream:
                stream.write(tar.extractfile(member).read())
            count += 1
    require(count > 0, 'empty-web-projection')
    return count


def rehearse(out, stop_at):
    bundle.check_deadline(stop_at)
    out = Path(out)
    log_path, receipt_path = out / 'layout-dry-run.log', out / 'layout-rehearsal.json'
    require(not present(log_path) and not present(receipt_path), 'existing-layout-rehearsal')
    pair = json.loads((out / 'candidate/paired-package.json').read_bytes())
    prior = json.loads((out / 'rollback/retained-installation.json').read_bytes())
    bindings = {'candidate/candidate.tar.gz': pair['source_archive_sha256'],
                'candidate/runtime-dependencies.tar.gz': pair['runtime_archive_sha256'],
                'rollback/prior-installation.tar.gz': prior['archive_sha256']}
    for name, digest in bindings.items():
        require(bundle.source_package.sha((out / name).read_bytes()) == digest,
                'layout-archive-hash-mismatch:' + name)
    assertions = []
    def check(name, expected, observed):
        require(expected == observed, name)
        assertions.append({'id': name, 'expected': expected, 'observed': observed, 'pass': True})
    with tempfile.TemporaryDirectory(prefix='release-layout-') as temporary:
        root = Path(temporary)
        candidate_count = project_files(out / 'candidate/candidate.tar.gz', 'diplomacy', root / 'candidate', stop_at)
        prior_count = project_files(out / 'rollback/prior-installation.tar.gz', 'web', root / 'web', stop_at)
        sentinel = root / 'unrelated-game.json'
        sentinel.write_bytes(b'{"game":"unrelated","round":17}\n')
        sentinel_before = sentinel.read_bytes()
        before, _ = bundle.snapshot(root / 'web', stop_at)
        candidate, _ = bundle.snapshot(root / 'candidate', stop_at)
        # Local config projection binds both packages. No actual service is run.
        override = json.dumps(bindings, sort_keys=True).encode()
        layout = Layout(root, override)
        layout.activate()
        check('candidate-web-visible', candidate, bundle.snapshot(layout.web.resolve(), stop_at)[0])
        check('owned-override-installed', override.decode(), layout.override.read_text())
        check('prior-web-retained', before, bundle.snapshot(layout.saved, stop_at)[0])
        layout.rollback()
        check('prior-web-restored', before, bundle.snapshot(layout.web, stop_at)[0])
        check('owned-layout-removed', [False, False, False],
              [layout.web.is_symlink(), present(layout.saved), present(layout.override)])
        check('unrelated-game-unchanged', sentinel_before.decode(), sentinel.read_text())
        actions = layout.actions
    check('temporary-layout-cleanup', False, root.exists())
    bundle.check_deadline(stop_at)
    result = {'pass': True, 'fullTaskPass': False, 'releaseReady': False,
              'scope': 'isolated filesystem rehearsal; no service or network validation',
              'bindings': bindings, 'candidateWebFiles': candidate_count, 'priorWebFiles': prior_count,
              'actions': actions, 'serviceActions': [], 'databaseActions': [],
              'cleanup': not root.exists(), 'checks': assertions}
    with log_path.open('x') as stream:
        stream.write('SCOPE=isolated-filesystem RELEASE_READY=false\n')
        for item in assertions:
            stream.write('PASS ' + item['id'] + '\n')
        stream.write('SERVICE_ACTIONS=0 DATABASE_ACTIONS=0\n')
    with receipt_path.open('x') as stream:
        json.dump(result, stream, indent=2)
        stream.write('\n')
    print('PASS isolated layout activation and rollback; temporary-layout-cleanup=true releaseReady=false')
    return result
