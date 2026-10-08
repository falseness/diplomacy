#!/usr/bin/env python3
"""Committed-tree release builder. Never pulls, activates or modifies a source tree."""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import tarfile

VERSION = 'v20.20.2'
CLIENT_DIRS = {'ai', 'assets', 'events', 'groups', 'interface', 'menu', 'models',
               'options', 'privacy', 'render', 'sprites', 'terms', 'tools', 'deploy'}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def run(args, **kw):
    result = subprocess.run(list(map(str, args)), **kw)
    if result.returncode:
        raise RuntimeError('Command failed: ' + Path(str(args[0])).name)
    return result


def git(repo, *args):
    return run(['git', '-C', repo, *args], capture_output=True).stdout


def safe_path(name):
    p = PurePosixPath(name)
    if not name or p.is_absolute() or '..' in p.parts or str(p) != name:
        raise ValueError('Unsafe path')
    return p


def safe_link(root, path, target):
    if os.path.isabs(target):
        raise ValueError('Unsafe symlink')
    dest = (path.parent / target).resolve()
    if not dest.is_relative_to(root.resolve()) or not dest.exists():
        raise ValueError('Unsafe or missing symlink target')


def selected(role, name):
    p = safe_path(name)
    if any(x in {'.git', 'artifacts', '.artifacts', 'node_modules', '__pycache__'} for x in p.parts):
        return False
    if any(x.startswith('.env') or re.search(r'(?i)(credential|private[_-]?key|id_rsa|id_ed25519)', x) for x in p.parts):
        return False
    if p.suffix.lower() in {'.key', '.pem', '.crt', '.p12', '.pfx'}:
        return False
    if role == 'diplomacy':
        return p.parts[0] in CLIENT_DIRS or (len(p.parts) == 1 and (p.suffix in {'.js', '.html'} or name == 'rules-manifest.json'))
    return p.parts[0] in {'server', 'ops', 'tests'} or name in {'package.json', 'package-lock.json'}


def snapshot(repo, role, dest):
    revision = git(repo, 'rev-parse', 'HEAD').decode().strip()
    branch = git(repo, 'symbolic-ref', '--short', 'HEAD').decode().strip()
    sources = {}
    for entry in git(repo, 'ls-tree', '-rz', revision).split(b'\0'):
        if not entry:
            continue
        meta, raw = entry.split(b'\t', 1)
        mode, kind, oid = meta.decode().split()
        name = raw.decode()
        if not selected(role, name):
            continue
        if kind != 'blob':
            raise ValueError('Unsupported Git entry')
        data = git(repo, 'cat-file', 'blob', oid)
        if re.search(rb'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----', data):
            raise ValueError('Private key in selected source')
        path = dest / role / name
        path.parent.mkdir(parents=True, exist_ok=True)
        if mode == '120000':
            path.symlink_to(data.decode())
        else:
            path.write_bytes(data)
            path.chmod(0o755 if mode == '100755' else 0o644)
        sources[role + '/' + name] = {'sha256': sha(data), 'git_blob': oid, 'git_mode': mode}
    if git(repo, 'rev-parse', 'HEAD').decode().strip() != revision:
        raise ValueError('Source revision changed during snapshot')
    return {'branch': branch, 'revision': revision, 'sources': sources}


def inventory(root):
    result = {}
    for p in sorted(root.rglob('*')):
        name = p.relative_to(root).as_posix()
        safe_path(name)
        if p.is_symlink():
            target = os.readlink(p)
            safe_link(root, p, target)
            result[name] = {'link': target}
        elif p.is_file():
            result[name] = {'sha256': sha(p.read_bytes()), 'mode': p.stat().st_mode & 0o777}
        elif not p.is_dir():
            raise ValueError('Unsupported candidate entry')
    return result


def verify(root, manifest):
    if inventory(root) != manifest['files']:
        raise ValueError('Candidate missing/corrupt/extra file or symlink')
    for info in manifest['repositories'].values():
        for name, source in info['sources'].items():
            p = root / name
            data = os.readlink(p).encode() if p.is_symlink() else p.read_bytes()
            if sha(data) != source['sha256']:
                raise ValueError('Committed source mismatch')
    print('PASS candidate files/symlinks and committed source hashes')


def runtime(dist):
    if not (dist / 'bin/node').is_file() or not (dist / 'lib/node_modules/npm/bin/npm-cli.js').is_file():
        raise ValueError('Missing required bundled runtime/npm')
    version = run([dist / 'bin/node', '--version'], capture_output=True, text=True).stdout.strip()
    if version != VERSION:
        raise ValueError('Required Node 20.20.2; system Node 18 is not supported')
    return {'version': version, 'node_sha256': sha((dist / 'bin/node').read_bytes())}


def rules(root, node):
    env = dict(os.environ, DIPLOMACY_CLIENT_ROOT=str(root / 'diplomacy'))
    run([node, root / 'diplomacy_server/server/tools/rules-manifest.js', '--game-dir', root / 'diplomacy', '--check'], env=env)
    run([node, root / 'diplomacy/tools/rules-manifest.js', '--check'], cwd=root / 'diplomacy', env=env)
    html = (root / 'diplomacy/index.html').read_text()
    for src in re.findall(r'<script\b[^>]*\bsrc=["\']([^"\']+)', html):
        if '://' not in src and not (root / 'diplomacy' / safe_path(src.removeprefix('./').split('?')[0])).is_file():
            raise ValueError('Missing browser script closure')
    print('PASS committed client/server rules compatibility and browser/server closure')


def prepare(client, server, output, dist):
    identity = runtime(dist)  # reject before creating output
    output.mkdir(parents=True, exist_ok=False)
    root = output / 'candidate'
    root.mkdir()
    repositories = {role: snapshot(repo, role, root) for role, repo in [('diplomacy', client), ('diplomacy_server', server)]}
    # Validate source links before executing candidate code or installing packages.
    inventory(root)
    rules(root, dist / 'bin/node')
    shutil.copytree(dist, root / 'runtime', symlinks=True)
    node = root / 'runtime/bin/node'
    npm = root / 'runtime/lib/node_modules/npm/bin/npm-cli.js'
    env = dict(os.environ, PATH=str(node.parent) + ':' + os.environ['PATH'])
    env.pop('NODE_PATH', None)
    package = root / 'diplomacy_server/server'
    run([node, npm, 'ci', '--omit=dev', '--no-audit', '--no-fund'], cwd=package, env=env)
    run([node, '-e', "for(const n of Object.keys(require('./package.json').dependencies)) require(n)"], cwd=package, env=env)
    run([node, npm, 'ci', '--no-audit', '--no-fund', '--ignore-scripts'], cwd=root / 'diplomacy_server', env=env)
    identity['verification_lock_sha256'] = sha((root / 'diplomacy_server/package-lock.json').read_bytes())
    identity['lock_sha256'] = sha((package / 'package-lock.json').read_bytes())
    print('PASS Node 20.20.2 locked production dependencies installed and resolved ' + json.dumps(identity))
    # Seal every regular file/directory, including the installed dependency tree.
    for p in root.rglob('*'):
        if not p.is_symlink():
            p.chmod(0o555 if p.is_dir() or p.stat().st_mode & 0o111 else 0o444)
    root.chmod(0o555)
    manifest = {'repositories': repositories, 'runtime': identity, 'files': inventory(root)}
    verify(root, manifest)
    archive = output / 'candidate.tar.gz'
    with tarfile.open(archive, 'w:gz') as tar:
        tar.add(root, arcname='candidate')
    with tarfile.open(archive, 'r:gz') as tar:
        observed = {}
        for member in tar:
            if member.isdir():
                continue
            name = member.name.removeprefix('candidate/')
            safe_path(name)
            if name in observed:
                raise ValueError('Duplicate archive entry')
            if member.issym():
                observed[name] = {'link': member.linkname}
            elif member.isfile():
                observed[name] = {'sha256': sha(tar.extractfile(member).read()), 'mode': member.mode}
            else:
                raise ValueError('Unsupported archive entry')
        if observed != manifest['files']:
            raise ValueError('Archive readback mismatch')
    print('PASS archive readback every file/symlink matches manifest')
    manifest['archive_sha256'] = sha(archive.read_bytes())
    (output / 'candidate-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print('PASS immutable fresh candidate; artifacts/secrets/untracked/patches excluded; files=' + str(len(manifest['files'])))
    return manifest


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('client', 'server', 'output', 'node-dist'):
        parser.add_argument('--' + name, type=Path, required=True)
    a = parser.parse_args()
    prepare(a.client.resolve(), a.server.resolve(), a.output.resolve(), a.node_dist.resolve())
