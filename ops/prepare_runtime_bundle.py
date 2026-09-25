"""Archive verified Node and installed dependencies beside a verified source pair.

This is a byte-packaging operation, not a release authorization entry point.
The caller must validate the completed TASK-225 proof before calling prepare().
This module never installs packages, starts a service, or writes a ready manifest.
"""
import gzip
import io
import json
import os
from pathlib import Path
import stat
import tarfile
import time

import prepare_release as source_package


def check_deadline(stop_at):
    if time.time() >= stop_at:
        raise ValueError('runtime-package-deadline')


def snapshot(root, stop_at):
    """Record files, directories, and safe relative links without following links."""
    root = Path(root).absolute()
    if any(p.is_symlink() for p in (root, *root.parents)) or not root.is_dir():
        raise ValueError('unsafe-runtime-root: ' + str(root))
    records, payloads = {}, {}

    def visit(directory):
        for file in sorted(directory.iterdir()):
            check_deadline(stop_at)
            name = file.relative_to(root).as_posix()
            if any(p in ('artifacts', '.artifacts', '.git', '__pycache__') for p in file.relative_to(root).parts):
                raise ValueError('excluded-runtime-path: ' + name)
            info = file.lstat()
            if stat.S_ISLNK(info.st_mode):
                target = os.readlink(file)
                if os.path.isabs(target):
                    raise ValueError('absolute-runtime-link: ' + name)
                try:
                    resolved = file.resolve(strict=True)
                    resolved.relative_to(root)
                except (ValueError, OSError, RuntimeError) as error:
                    raise ValueError('escaping-or-broken-runtime-link: ' + name) from error
                records[name] = {'type': 'symlink', 'target': target, 'mode': 0o777}
            elif stat.S_ISDIR(info.st_mode):
                records[name] = {'type': 'directory', 'mode': stat.S_IMODE(info.st_mode)}
                visit(file)
            elif stat.S_ISREG(info.st_mode):
                # Opening with O_NOFOLLOW also rejects a link swapped after lstat.
                with os.fdopen(os.open(file, os.O_RDONLY | os.O_NOFOLLOW), 'rb') as stream:
                    opened = os.fstat(stream.fileno())
                    data = stream.read()
                if (opened.st_dev, opened.st_ino, opened.st_mode) != (info.st_dev, info.st_ino, info.st_mode):
                    raise ValueError('changed-runtime-file: ' + name)
                records[name] = {'type': 'file', 'sha256': source_package.sha(data),
                                 'mode': stat.S_IMODE(info.st_mode)}
                payloads[name] = data
            else:
                raise ValueError('special-runtime-file: ' + name)
            if records[name]['mode'] & 0o7000:
                raise ValueError('privileged-runtime-mode: ' + name)
    visit(root)
    return records, payloads


def verify_archive(archive, expected, stop_at):
    """Read back without extraction; reject duplicates and altered link/mode data."""
    observed = {}
    with tarfile.open(archive) as tar:
        for member in tar:
            check_deadline(stop_at)
            if member.name in observed:
                raise ValueError('duplicate-runtime-archive-member: ' + member.name)
            if member.isfile():
                record = {'type': 'file', 'sha256': source_package.sha(tar.extractfile(member).read()),
                          'mode': member.mode}
            elif member.issym():
                record = {'type': 'symlink', 'target': member.linkname, 'mode': member.mode}
            elif member.isdir():
                record = {'type': 'directory', 'mode': member.mode}
            else:
                raise ValueError('special-runtime-archive-member: ' + member.name)
            observed[member.name] = record
    if observed != expected:
        raise ValueError('runtime-archive-readback-mismatch')
    return len(observed)


def prepare(client, server, sources, runtime, dependencies, verified_runtime, out, stop_at):
    """Use the exact tested installation; never substitute a fresh npm install.

    verified_runtime binds source-manifest bytes, Node version/platform/arch,
    and complete snapshot() inventories for both supplied roots. Its authenticity
    and relationship to successful tests belong to the mandatory upstream gate.
    The output is an intermediate package, never release-manifest.json or READY.
    stop_at is the parent's cumulative Unix deadline, not a fresh per-stage timer.
    """
    check_deadline(stop_at)
    if out.exists() or out.is_symlink():
        raise ValueError('Refusing to overwrite an existing runtime package')
    receipt_bytes = verified_runtime.read_bytes()
    receipt = json.loads(receipt_bytes)
    if receipt.get('source_manifest_sha256') != source_package.sha(sources.read_bytes()):
        raise ValueError('runtime-source-receipt-mismatch')
    identity = receipt.get('identity', {})
    if any(not isinstance(identity.get(key), str) or not identity[key]
           for key in ('node', 'platform', 'arch')):
        raise ValueError('missing-runtime-identity')
    inventory, payloads = {}, {}
    roots = [('runtime', runtime, 'runtime'),
             ('dependencies', dependencies, 'diplomacy_server/server/node_modules')]
    for key, root, prefix in roots:
        records, data = snapshot(root, stop_at)
        if not records or records != receipt.get(key):
            raise ValueError('verified-runtime-inventory-changed: ' + key)
        inventory[prefix] = {'type': 'directory', 'mode': 0o755}
        inventory.update({prefix + '/' + n: r for n, r in records.items()})
        payloads.update({prefix + '/' + n: b for n, b in data.items()})
    node = inventory.get('runtime/bin/node', {})
    if node.get('type') != 'file' or not node.get('mode', 0) & 0o111:
        raise ValueError('missing-executable-node')
    # Source packaging validates every selected source and lockfile before output.
    # Snapshot dependencies first so stale runtime receipts cause no staging writes.
    source_package.prepare(client, server, sources, out)
    check_deadline(stop_at)
    candidate = json.loads((out / 'candidate-manifest.json').read_bytes())
    if candidate['verified_source_manifest_sha256'] != receipt['source_manifest_sha256']:
        raise ValueError('changed-package-evidence')
    # Bind declared direct packages to concrete installed manifests and lock entries.
    with tarfile.open(out / 'candidate.tar.gz') as tar:
        package = json.load(tar.extractfile('diplomacy_server/server/package.json'))
        lock = json.load(tar.extractfile('diplomacy_server/server/package-lock.json'))
    if lock.get('packages', {}).get('', {}).get('dependencies', {}) != package.get('dependencies', {}):
        raise ValueError('package-lock-root-mismatch')
    installed = {}
    for name in package.get('dependencies', {}):
        if not all(p and p not in ('.', '..') for p in name.split('/')) or name.startswith('/'):
            raise ValueError('unsafe-package-name')
        rel = 'node_modules/' + name + '/package.json'
        data = payloads.get('diplomacy_server/server/' + rel)
        if data is None:
            raise ValueError('missing-installed-dependency: ' + name)
        value = json.loads(data)
        version = lock.get('packages', {}).get('node_modules/' + name, {}).get('version')
        if not version or value.get('version') != version or value.get('name') != name:
            raise ValueError('installed-dependency-lock-mismatch: ' + name)
        installed[name] = {'version': version, 'manifest_sha256': source_package.sha(data)}
    archive = out / 'runtime-dependencies.tar.gz'
    with archive.open('xb') as raw, gzip.GzipFile(filename='', mode='wb', fileobj=raw, mtime=0) as compressed:
        with tarfile.open(fileobj=compressed, mode='w') as tar:
            for name, record in sorted(inventory.items()):
                check_deadline(stop_at)
                member = tarfile.TarInfo(name)
                member.mode = record['mode']
                if record['type'] == 'file':
                    data = payloads[name]
                    member.size = len(data)
                    tar.addfile(member, io.BytesIO(data))
                elif record['type'] == 'directory':
                    member.type = tarfile.DIRTYPE
                    tar.addfile(member)
                else:
                    member.type, member.linkname = tarfile.SYMTYPE, record['target']
                    tar.addfile(member)
    count = verify_archive(archive, inventory, stop_at)
    manifest = {'releaseReady': False, 'scope': 'verified byte package; gate readiness required',
                'identity': identity, 'installed_direct_dependencies': installed,
                'source_archive_sha256': candidate['archive_sha256'],
                'source_manifest_sha256': source_package.sha(sources.read_bytes()),
                'runtime_receipt_sha256': source_package.sha(receipt_bytes),
                'runtime_archive_sha256': source_package.sha(archive.read_bytes()),
                'inventory': inventory, 'archive_members': count}
    # Detect changing receipt/source evidence before publishing a successful receipt.
    if verified_runtime.read_bytes() != receipt_bytes or manifest['source_manifest_sha256'] != receipt['source_manifest_sha256']:
        raise ValueError('changed-package-evidence')
    check_deadline(stop_at)
    (out / 'paired-package.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(f'PASS runtime dependency archive expected_members={len(inventory)} observed_members={count}')
    print(f'PASS installed direct dependency lock agreement count={len(installed)}')
    print('PASS intermediate paired package releaseReady=false')
    return manifest
