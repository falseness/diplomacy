"""Retain an observed prior installation without activating or restoring it.

Library operation only. The release gate must authorize real staging and obtain
fresh authenticated host observations. Synthetic observations are diagnostics.
No service commands, database operations, archive extraction or network calls.
"""
import gzip
import io
import json
from pathlib import Path
import stat
import tarfile

import prepare_runtime_bundle as bundle


ROLES = ('client', 'server', 'web', 'runtime', 'config')


def inventory(roots, stop_at):
    if set(roots) != set(ROLES):
        raise ValueError('rollback-root-roles')
    paths = {role: Path(roots[role]).absolute() for role in ROLES}
    if any('..' in root.parts for root in paths.values()):
        raise ValueError('noncanonical-rollback-root')
    for role, root in paths.items():
        for other, second in paths.items():
            if role != other and (root == second or root in second.parents):
                raise ValueError('overlapping-rollback-roots')
    records, payloads = {}, {}
    for role, root in paths.items():
        items, data = bundle.snapshot(root, stop_at)
        if not items:
            raise ValueError('empty-rollback-root: ' + role)
        mode = stat.S_IMODE(root.stat().st_mode)
        if mode & 0o7000:
            raise ValueError('privileged-rollback-root: ' + role)
        records[role] = {'type': 'directory', 'mode': mode}
        records.update({role + '/' + name: record for name, record in items.items()})
        payloads.update({role + '/' + name: data for name, data in data.items()})
    return records, payloads


def validate_observation(value, roots):
    """Require concrete process/layout fields, not a historical Git revision."""
    if not isinstance(value, dict):
        raise ValueError('invalid-rollback-observation')
    for key in ('host', 'boot_id', 'service', 'process_start', 'observed_at'):
        if not isinstance(value.get(key), str) or not value[key].strip():
            raise ValueError('missing-rollback-identity: ' + key)
    if type(value.get('pid')) is not int or value['pid'] <= 0:
        raise ValueError('missing-rollback-identity: pid')
    expected = {role: str(Path(roots[role]).absolute()) for role in ROLES}
    if value.get('roots') != expected:
        raise ValueError('rollback-layout-mismatch')
    for key, role in (('cwd', 'server'), ('executable', 'runtime')):
        path = Path(value.get(key, ''))
        if not path.is_absolute() or '..' in path.parts or Path(expected[role]) not in path.parents:
            raise ValueError('rollback-process-path: ' + key)
        if path.is_symlink() or not (path.is_dir() if key == 'cwd' else path.is_file()):
            raise ValueError('rollback-process-path: ' + key)
        if key == 'executable' and not path.stat().st_mode & 0o111:
            raise ValueError('rollback-node-not-executable')


def retain(roots, observation_file, observation_sha256, observe, out, stop_at):
    """Capture stable bytes and process identity into a fresh local directory.

    observe is a caller-owned read-only host collector. Both observations must
    equal the supplied receipt, apart from observed_at. Their authenticity and
    freshness are the production adapter's responsibility. stop_at is the parent
    Unix deadline. This receipt is intermediate and cannot authorize rollback.
    """
    bundle.check_deadline(stop_at)
    out = Path(out).absolute()
    if '..' in out.parts:
        raise ValueError('noncanonical-rollback-output')
    if out.exists() or out.is_symlink():
        raise ValueError('existing-rollback-output')
    if any(p.is_symlink() for p in out.parents):
        raise ValueError('symlink-rollback-output-parent')
    if any(Path(root).absolute() == out or Path(root).absolute() in out.parents for root in roots.values()):
        raise ValueError('rollback-output-inside-input')
    raw = Path(observation_file).read_bytes()
    if bundle.source_package.sha(raw) != observation_sha256:
        raise ValueError('rollback-observation-hash-mismatch')
    expected = json.loads(raw)
    validate_observation(expected, roots)

    def check_observation():
        bundle.check_deadline(stop_at)
        actual = observe()
        validate_observation(actual, roots)
        stable = lambda v: {k: x for k, x in v.items() if k != 'observed_at'}
        if stable(actual) != stable(expected):
            raise ValueError('rollback-process-drift')

    check_observation()
    records, payloads = inventory(roots, stop_at)
    # No recursive copy of host directories or database paths. Only explicitly
    # selected installation roots, including installed server dependencies.
    out.mkdir(parents=True, exist_ok=False)
    archive = out / 'prior-installation.tar.gz'
    with archive.open('xb') as stream, gzip.GzipFile(filename='', mode='wb', fileobj=stream, mtime=0) as compressed:
        with tarfile.open(fileobj=compressed, mode='w') as tar:
            for name, record in sorted(records.items()):
                bundle.check_deadline(stop_at)
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
    count = bundle.verify_archive(archive, records, stop_at)
    # A stable archive alone is not proof the currently running pair is stable.
    if inventory(roots, stop_at)[0] != records:
        raise ValueError('rollback-installation-drift')
    check_observation()
    if Path(observation_file).read_bytes() != raw:
        raise ValueError('rollback-observation-changed')
    bundle.check_deadline(stop_at)
    receipt = {'releaseReady': False, 'scope': 'local retained installation; authenticated current-host gate required',
               'observation_sha256': observation_sha256, 'observation': expected,
               'archive_sha256': bundle.source_package.sha(archive.read_bytes()),
               'inventory': records, 'archive_members': count,
               'databaseActions': [], 'serviceActions': [], 'restorationPerformed': False}
    (out / 'retained-installation.json').write_text(json.dumps(receipt, indent=2) + '\n')
    print(f'PASS retained installation expected_members={len(records)} observed_members={count}')
    print('PASS stable process and installation; databaseActions=0 serviceActions=0 releaseReady=false')
    return receipt
