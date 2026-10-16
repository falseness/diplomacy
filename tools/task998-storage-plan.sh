#!/usr/bin/env bash
set -euo pipefail
python3 - "$@" <<'PY'
#!/usr/bin/env python3
"""Measure lossless, path-preserving deduplication without modifying evidence.

Only completed tasks outside the protected twenty are candidates. Symlinks and
mounted archive views are excluded; existing hardlinks count once. Hash matches
are confirmed byte-for-byte. This report is a plan, never a storage reservation.
"""
import argparse
import collections
import hashlib
import json
import os
from pathlib import Path
import stat
import time


def measure(root, tasks, deadline):
    boundary = next((i for i, t in enumerate(tasks) if t['status'] in ('pending', 'to-verify')), len(tasks))
    completed = [t['id'] for t in tasks[:boundary] if t['status'] == 'done']
    eligible = set(completed[:-20])
    seen = set()
    groups = collections.defaultdict(list)
    total = allocated = 0
    for directory, dirs, files in os.walk(root, followlinks=False):
        dirs[:] = [d for d in dirs if not os.path.ismount(Path(directory) / d)]
        for name in files:
            if time.monotonic() >= deadline:
                raise TimeoutError('storage scan deadline exceeded')
            path = Path(directory) / name
            s = path.lstat()
            key = (s.st_dev, s.st_ino)
            if not stat.S_ISREG(s.st_mode) or key in seen:
                continue
            seen.add(key)
            total += s.st_size
            allocated += s.st_blocks * 512
            if path.relative_to(root).parts[0] in eligible and s.st_size:
                groups[s.st_size].append(path)
    duplicates = []
    hashed = 0
    for size, paths in groups.items():
        if len(paths) < 2:
            continue
        by_hash = collections.defaultdict(list)
        for path in paths:
            digest = hashlib.sha256()
            before = path.stat()
            with path.open('rb') as f:
                while block := f.read(1024 * 1024):
                    if time.monotonic() >= deadline:
                        raise TimeoutError('hash scan deadline exceeded')
                    digest.update(block)
            after = path.stat()
            assert (before.st_ino, before.st_size, before.st_mtime_ns) == (after.st_ino, after.st_size, after.st_mtime_ns), str(path)
            by_hash[digest.hexdigest()].append(path)
            hashed += size
        for digest, matches in by_hash.items():
            if len(matches) < 2:
                continue
            for other in matches[1:]:
                with matches[0].open('rb') as a, other.open('rb') as b:
                    while True:
                        if time.monotonic() >= deadline:
                            raise TimeoutError('comparison deadline exceeded')
                        block = a.read(1024 * 1024)
                        assert block == b.read(1024 * 1024), str(other)
                        if not block:
                            break
            duplicates.append(dict(sha256=digest, bytes=size, paths=[str(p) for p in matches], reclaimableBytes=size * (len(matches)-1)))
    savings = sum(x['reclaimableBytes'] for x in duplicates)
    return dict(storedBytes=total, allocatedBytes=allocated, capBytes=40*1024**3,
                headroomBytes=40*1024**3-total, eligibleTasks=sorted(eligible),
                protectedCompletedTasks=completed[-20:], hashedBytes=hashed,
                duplicateGroups=duplicates, potentialReclaimableBytes=savings,
                filesModified=False, reservationAdmitted=False,
                qualification='Measured identical bytes only. No files linked or deleted; mutable files must never be linked. Savings are not reserved.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    root = Path('/root/diplomacy/artifacts').resolve()
    out = Path(args.output).resolve()
    assert out.is_relative_to(root / 'TASK-998'), 'output must remain in TASK-998'
    tasks = json.loads((root / 'tasks.json').read_text())
    if isinstance(tasks, dict):
        tasks = tasks['tasks']
    start = time.monotonic()
    report = measure(root, tasks, start + 580)
    report['elapsedMs'] = (time.monotonic()-start)*1000
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, indent=2)+'\n')
    print('PASS byte-identical duplicate measurement; filesModified=false')
    print('STORAGE storedBytes={} potentialReclaimableBytes={} headroomBytes={}'.format(report['storedBytes'], report['potentialReclaimableBytes'], report['headroomBytes']))
    print('NOT RESERVED: no mutation or service expansion authorized by measurement alone')


if __name__ == '__main__':
    main()

PY
