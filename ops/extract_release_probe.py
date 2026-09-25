"""Extract hash-verified archives into a fresh private tree, without link traversal."""
import os, sys, tarfile
from pathlib import Path, PurePosixPath
out, root = map(Path, sys.argv[1:])
root.mkdir(exist_ok=False)
for role, names in [('candidate', ['candidate/candidate.tar.gz', 'candidate/runtime-dependencies.tar.gz']),
                    ('rollback', ['rollback/prior-installation.tar.gz'])]:
    dest = root / role
    dest.mkdir()
    links = []
    seen = set()
    for name in names:
        with tarfile.open(out / name) as tar:
            for member in tar:
                rel = PurePosixPath(member.name)
                if rel.is_absolute() or '..' in rel.parts or member.name in seen:
                    raise ValueError('unsafe-or-duplicate-archive-path')
                seen.add(member.name)
                target = dest.joinpath(*rel.parts)
                target.parent.mkdir(parents=True, exist_ok=True)
                if member.isdir(): target.mkdir(exist_ok=True)
                elif member.isfile():
                    with target.open('xb') as stream: stream.write(tar.extractfile(member).read())
                    target.chmod(member.mode & 0o777)
                elif member.issym(): links.append((target, member.linkname))
                else: raise ValueError('special-archive-member')
    # No symlink existed during regular-file extraction. Relative dependency
    # links are allowed only when their fully resolved target stays in this tree.
    for target, link in links:
        if os.path.isabs(link): raise ValueError('absolute-archive-link')
        (target.parent / link).resolve().relative_to(dest.resolve())
        target.symlink_to(link)
    for target, _ in links: target.resolve(strict=True).relative_to(dest.resolve())
