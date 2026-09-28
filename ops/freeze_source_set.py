#!/usr/bin/env python3
"""Freeze a stale source set and re-check it for drift.

  freeze_source_set.py freeze OUT.json ROLE/PATH...   record SHA-256 of each path
  freeze_source_set.py drift  OUT.json LABEL           re-hash and compare; exit 1 on drift

ROLE is client (/root/diplomacy) or server (/root/diplomacy_server). Read-only
apart from OUT.json; the HEAD blob hash shows whether the frozen bytes are committed.
"""
import datetime, hashlib, json, subprocess, sys

ROOTS = {'client': '/root/diplomacy', 'server': '/root/diplomacy_server'}


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')


def git(root, *args):
    r = subprocess.run(['git', '-C', root, *args], capture_output=True)
    return r.stdout if r.returncode == 0 else None


def identity(spec):
    role, _, rel = spec.partition('/')
    root = ROOTS[role]
    with open(f'{root}/{rel}', 'rb') as f:
        sha = hashlib.sha256(f.read()).hexdigest()
    blob = git(root, 'show', f'HEAD:{rel}')
    return {'path': spec, 'absolute': f'{root}/{rel}', 'sha256': sha,
            'headSha256': hashlib.sha256(blob).hexdigest() if blob is not None else None,
            'dirty': bool(git(root, 'status', '--porcelain', '--', rel))}


def main(argv):
    mode, out = argv[1], argv[2]
    if mode == 'freeze':
        heads = {role: git(root, 'rev-parse', 'HEAD').decode().strip() for role, root in ROOTS.items()}
        frozen = {'frozenAt': now(), 'heads': heads, 'paths': [identity(p) for p in argv[3:]]}
        with open(out, 'w') as f:
            json.dump(frozen, f, indent=1)
        for p in frozen['paths']:
            print(f"FROZEN {p['path']} {p['sha256']} head={p['headSha256']} dirty={p['dirty']}")
        return 0
    frozen = json.load(open(out))
    moved = []
    print(f'DRIFT-CHECK label={argv[3]} at={now()} frozenAt={frozen["frozenAt"]}')
    for p in frozen['paths']:
        cur = identity(p['path'])
        ok = cur['sha256'] == p['sha256']
        print(f"{'SAME ' if ok else 'MOVED'} {p['path']} frozen={p['sha256']} current={cur['sha256']}")
        if not ok:
            moved.append(p['path'])
    print(f'DRIFT {len(moved)} of {len(frozen["paths"])}' + (': ' + ' '.join(moved) if moved else ''))
    return 1 if moved else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
