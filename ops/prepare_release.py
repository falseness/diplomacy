#!/usr/bin/env python3
"""Package a verified client/server working tree; never activate a service.

The source manifest is produced by the completed local verification run. Any
packaged source differing from that run blocks packaging. Output is local-only.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import tarfile


def sha(data):
    return hashlib.sha256(data).hexdigest()


def git(repo, *args):
    return subprocess.check_output(['git', '-C', str(repo), *args])


def prepare(client, server, evidence, out):
    verified = json.loads(evidence.read_text())['sources']
    out.mkdir(parents=True, exist_ok=True)
    archive = out / 'candidate.tar.gz'
    if archive.exists():
        raise ValueError('Refusing to overwrite an existing release archive')
    files = {}
    revisions = {}
    for name, repo in [('diplomacy', client), ('diplomacy_server', server)]:
        patch = git(repo, 'diff', 'HEAD', '--binary')
        (out / (name + '.patch')).write_bytes(patch)
        revisions[name] = {'head': git(repo, 'rev-parse', 'HEAD').decode().strip(),
                           'patch_sha256': sha(patch), 'dirty': bool(patch)}
        for rel in git(repo, 'ls-files', '-z').decode().split('\0'):
            if not rel:
                continue
            parts = Path(rel).parts
            if any(p in ('artifacts', '.artifacts', '.git', 'node_modules') for p in parts):
                continue
            if name == 'diplomacy':
                # Ship browser resources and shared game code, including AI assets.
                if parts[0] not in ('ai', 'assets', 'events', 'groups', 'interface',
                                    'menu', 'options', 'render', 'sprites') and not (
                                        len(parts) == 1 and rel.endswith(('.html', '.js'))):
                    continue
            elif parts[0] != 'server' or rel.endswith(('.key', '.crt')):
                continue
            source = repo / rel
            digest = sha(source.read_bytes())
            if verified.get(str(source)) != digest:
                raise ValueError('Source not verified or changed: ' + str(source))
            files[name + '/' + rel] = (source, digest)
    html = (client / 'index.html').read_text()
    scripts = re.findall(r'<script\b[^>]*\bsrc=[\"\']([^\"\']+)', html)
    external = [p for p in scripts if '://' in p]
    loader = (server / 'server/loadGameCode.js').read_text()
    order = loader.split('const scriptOrder = [', 1)[1].split(']', 1)[0]
    required = [p for p in scripts if '://' not in p]
    required += re.findall(r"'([^']+\.js)'", order)
    for rel in required:
        if 'diplomacy/' + rel not in files:
            raise ValueError('Missing runtime script: ' + rel)
    with tarfile.open(archive, 'w:gz') as tar:
        for name, (source, _) in sorted(files.items()):
            tar.add(source, arcname=name, recursive=False)
    with tarfile.open(archive) as tar:
        for member in tar.getmembers():
            if not member.isfile() or sha(tar.extractfile(member).read()) != files[member.name][1]:
                raise ValueError('Archive readback mismatch: ' + member.name)
    manifest = {'revisions': revisions, 'archive_sha256': sha(archive.read_bytes()),
                'verified_source_manifest_sha256': sha(evidence.read_bytes()),
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
