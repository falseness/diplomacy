#!/usr/bin/env python3
"""Package a verified client/server working tree; never activate a service.

The source manifest is produced by the completed local verification run. Any
packaged source differing from that run blocks packaging. Output is local-only.
"""
import argparse
import gzip
import hashlib
import io
import json
from pathlib import Path
import re
import subprocess
import tarfile


def sha(data):
    return hashlib.sha256(data).hexdigest()


def git(repo, *args):
    return subprocess.check_output(['git', '-C', str(repo), *args])


def release_path(name, rel):
    parts = Path(rel).parts
    if not parts or any(p.startswith('.') or p in ('artifacts', 'node_modules', '__pycache__') for p in parts):
        return False
    if name == 'diplomacy':
        return parts[0] in ('ai', 'assets', 'events', 'groups', 'interface',
                            'menu', 'options', 'render', 'sprites') or (
                                len(parts) == 1 and rel.endswith(('.html', '.js')))
    return parts[0] == 'server' and not rel.endswith(('.key', '.crt', '.pem'))


def prepare(client, server, evidence, out):
    evidence_bytes = evidence.read_bytes()
    verified = json.loads(evidence_bytes)['sources']
    if out.exists():
        raise ValueError('Refusing to overwrite an existing release directory')
    files = {}
    revisions = {}
    patches = {}
    for name, repo in [('diplomacy', client), ('diplomacy_server', server)]:
        # Pathspecs also constrain the patch: artifacts and unrelated edits must
        # never leak through an unrestricted `git diff HEAD --binary`.
        tracked = git(repo, 'ls-files', '-z').decode().split('\0')
        others = git(repo, 'ls-files', '--others', '--exclude-standard', '-z').decode().split('\0')
        committed = git(repo, 'ls-tree', '-r', '--name-only', '-z', 'HEAD').decode().split('\0')
        selected = sorted({rel for rel in tracked + others + committed if release_path(name, rel)})
        patch = git(repo, 'diff', 'HEAD', '--binary', '--no-renames', '--', *selected) if selected else b''
        patches[name] = patch
        revisions[name] = {'head': git(repo, 'rev-parse', 'HEAD').decode().strip(),
                           'patch_sha256': sha(patch), 'dirty': bool(patch) or bool(set(selected) & set(others)),
                           'untracked_files': sorted(set(selected) & set(others)),
                           'patch_scope': 'release files only; untracked bytes are in archive'}
        for rel in selected:
            source = repo / rel
            if any(part.is_symlink() for part in [source, *source.parents] if part != repo.parent):
                raise ValueError('Symlink release source: ' + str(source))
            if not source.exists():
                # Tracked deletions are represented by the scoped patch.
                continue
            data = source.read_bytes()
            digest = sha(data)
            if verified.get(str(source)) != digest:
                raise ValueError('Source not verified or changed: ' + str(source))
            # Archive the checked bytes, never re-open a source after hashing it.
            files[name + '/' + rel] = (data, digest)
    # Hash equality for surviving files alone misses deletions. Compare the
    # complete scoped inventory before accepting the candidate as verified.
    expected = set()
    for name, repo in [('diplomacy', client), ('diplomacy_server', server)]:
        for source in verified:
            try:
                rel = Path(source).relative_to(repo).as_posix()
            except ValueError:
                continue
            if release_path(name, rel):
                expected.add(name + '/' + rel)
    if expected != set(files):
        raise ValueError('Verified source inventory changed: missing=' +
                         repr(sorted(expected - set(files))) + ' added=' +
                         repr(sorted(set(files) - expected)))
    for rel in ('server/package.json', 'server/package-lock.json'):
        if 'diplomacy_server/' + rel not in files:
            raise ValueError('Missing dependency manifest: ' + rel)
    html = files['diplomacy/index.html'][0].decode()
    scripts = re.findall(r'<script\b[^>]*\bsrc=[\"\']([^\"\']+)', html)
    external = [p for p in scripts if '://' in p]
    loader = files['diplomacy_server/server/loadGameCode.js'][0].decode()
    order = loader.split('const scriptOrder = [', 1)[1].split(']', 1)[0]
    required = [p for p in scripts if '://' not in p]
    required += re.findall(r"'([^']+\.js)'", order)
    for rel in required:
        if 'diplomacy/' + rel not in files:
            raise ValueError('Missing runtime script: ' + rel)
    out.mkdir(parents=True, exist_ok=False)
    archive = out / 'candidate.tar.gz'
    for name, patch in patches.items():
        (out / (name + '.patch')).write_bytes(patch)
    # Stable headers make the archive reproducible despite checkout timestamps.
    with archive.open('wb') as raw, gzip.GzipFile(filename='', mode='wb', fileobj=raw, mtime=0) as compressed:
        with tarfile.open(fileobj=compressed, mode='w') as tar:
            for name, (data, _) in sorted(files.items()):
                member = tarfile.TarInfo(name)
                member.size = len(data)
                member.mode = 0o644
                tar.addfile(member, io.BytesIO(data))
    with tarfile.open(archive) as tar:
        for member in tar.getmembers():
            if not member.isfile() or sha(tar.extractfile(member).read()) != files[member.name][1]:
                raise ValueError('Archive readback mismatch: ' + member.name)
    manifest = {'revisions': revisions, 'archive_sha256': sha(archive.read_bytes()),
                'verified_source_manifest_sha256': sha(evidence_bytes),
                'files': {name: pair[1] for name, pair in sorted(files.items())},
                'external_browser_scripts': external,
                'required_scripts': sorted(set(required)),
                'layout': 'diplomacy_server/server loads ../../diplomacy',
                'excluded': ['artifacts', '.artifacts', '.git', 'node_modules',
                             'test TLS private keys and certificates'],
                'runtime_dependencies': 'Install server/package-lock.json with npm ci; bundle verified Node runtime separately.'}
    (out / 'candidate-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    (out / 'candidate-files.sha256').write_text(''.join(
        digest + '  ' + name + '\n' for name, digest in manifest['files'].items()))
    print(f'PASS candidate archive readback expected_files={len(files)} observed_files={len(files)}')
    print(f'PASS browser/server script closure expected_missing=0 observed_missing=0 scripts={len(set(required))}')
    print(f'PASS candidate archive_sha256={manifest["archive_sha256"]}')
    for name, revision in revisions.items():
        print(f'PASS {name} revision={revision["head"]} dirty={revision["dirty"]} patch_sha256={revision["patch_sha256"]}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--client', type=Path, required=True)
    parser.add_argument('--server', type=Path, required=True)
    parser.add_argument('--verified-sources', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    prepare(args.client.resolve(), args.server.resolve(),
            args.verified_sources.resolve(), args.output.resolve())
