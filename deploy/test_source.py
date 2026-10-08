#!/usr/bin/env python3
"""Isolated integration tests; preflight host checks replaced, Git/locks are real."""
import contextlib
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time

SOURCE = Path(__file__).resolve().parent
OUT = Path(sys.argv[1]).resolve()
OUT.mkdir(parents=True, exist_ok=True)
BASE = Path(tempfile.mkdtemp(prefix='deploy-source-'))

def cmd(*args, cwd=None):
    p = subprocess.run(args, cwd=cwd, capture_output=True, text=True)
    assert p.returncode == 0, (args, p.stdout, p.stderr)
    return p.stdout.strip()

def git(root, *args):
    return cmd('git', '-C', str(root), *args)

def fixture(name):
    base = BASE / name
    base.mkdir()
    roots = []
    for label, branch in [('diplomacy', 'master'), ('diplomacy_server', 'demons')]:
        remote = base / (label + '.git')
        git(base, 'init', '--bare', str(remote))
        seed = base / (label + '-seed')
        git(base, 'clone', str(remote), str(seed))
        git(seed, 'config', 'user.email', 'fixture@example.invalid')
        git(seed, 'config', 'user.name', 'Fixture')
        git(seed, 'checkout', '-b', branch)
        (seed / 'tracked').write_text('initial\n')
        if label == 'diplomacy':
            (seed / 'deploy').mkdir()
            for name in ('source.py', 'deploy.sh'):
                shutil.copy2(SOURCE / name, seed / 'deploy' / name)
        git(seed, 'add', '.')
        git(seed, 'commit', '-m', 'fixture initial')
        git(seed, 'push', '-u', 'origin', branch)
        root = base / label
        git(base, 'clone', '-b', branch, str(remote), str(root))
        git(root, 'config', 'user.email', 'fixture@example.invalid')
        git(root, 'config', 'user.name', 'Fixture')
        git(root, 'config', 'core.hooksPath', str(root / '.git/hooks'))
        roots.append(root)
    live = base / 'live'
    live.mkdir()
    for p in ('service', 'web', 'DB', 'releases'):
        (live / p).write_text('untouched')
    return base, roots

def advance(root, filename='tracked', content='advanced\n'):
    seed = root.parent / (root.name + '-seed')
    (seed / filename).write_text(content)
    git(seed, 'add', '.')
    git(seed, 'commit', '-m', 'advance')
    git(seed, 'push')
    return git(seed, 'rev-parse', 'HEAD')

def snapshot(base):
    return {str(p.relative_to(base)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in sorted(base.rglob('*')) if p.is_file()}

def run(base, roots, args=(), wait=True):
    # Exercise main with real fixtures, substituting only production host preflight.
    code = '''import importlib.util,sys,pathlib
s=importlib.util.spec_from_file_location('source',sys.argv[1]); m=importlib.util.module_from_spec(s); s.loader.exec_module(m)
sys.path.insert(0,str(pathlib.Path(sys.argv[1]).parent))
m.LOCK=pathlib.Path(sys.argv[2]); m.preflight=lambda roots,dry: None
m.finish=lambda client,server: (_ for _ in ()).throw(RuntimeError('fixture orchestration boundary'))
try: sys.exit(m.main(sys.argv[4:], pathlib.Path(sys.argv[3])))
except Exception as e: print('ERROR:',str(e)); sys.exit(1)
'''
    p = subprocess.Popen([sys.executable, '-B', '-c', code, str(roots[0] / 'deploy/source.py'),
                          str(base / 'deploy.lock'), str(roots[0]), *args],
                         cwd='/', stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    if not wait:
        return p
    output = p.communicate(timeout=30)[0]
    print(output, end='')
    print('INVOCATION_EXIT_STATUS=' + str(p.returncode))
    assert all(p.read_text() == 'untouched' for p in (base / 'live').iterdir())
    return p.returncode, output

@contextlib.contextmanager
def log(name):
    with (OUT / name).open('w') as f, contextlib.redirect_stdout(f):
        try:
            yield
        except BaseException:
            print('EXIT_STATUS=1')
            raise
        else:
            print('EXIT_STATUS=0')

try:
    with log('published-pair.log'):
        b, r = fixture('published-pair')
        initial = [git(x, 'rev-parse', 'HEAD') for x in r]
        expected = [advance(x) for x in r]
        args = ['--expected-client', expected[0], '--expected-server', expected[1]]
        rc, out = run(b, r, args + ['--dry-run'])
        assert rc == 0
        rc, out = run(b, r, ['--expected-client', expected[0]])
        assert rc == 1 and 'Both published full commit SHAs' in out
        advance(r[1], content='remote moved\n')
        rc, out = run(b, r, args)
        assert rc == 1 and 'Remote tip does not match published pair' in out
        assert [git(x, 'rev-parse', 'HEAD') for x in r] == initial
        print('PASS moved remote pair rejected before either pull or activation')
        expected[1] = git(r[1].parent / 'diplomacy_server-seed', 'rev-parse', 'HEAD')
        rc, out = run(b, r, ['--expected-client', expected[0], '--expected-server', expected[1]])
        assert rc == 1 and 'PUBLISHED_PAIR_MATCH ' + ' '.join(expected) in out
        assert 'fixture orchestration boundary' in out
        print('PASS exact published pair reaches orchestration')
        spec = importlib.util.spec_from_file_location('source', SOURCE / 'source.py')
        module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
        info = module.inspect(r[1]); info['expected'] = expected[1]
        advance(r[1], content='fetch raced\n')
        try:
            module.pull(r[1], info)
            raise AssertionError('fetch race accepted')
        except RuntimeError as error:
            assert 'Published pair changed during fetch' in str(error)
        assert git(r[1], 'rev-parse', 'HEAD') == expected[1]
        print('PASS fetch race rejected before pull or activation')
    with log('cli.log'):
        print(cmd(str(SOURCE / 'deploy.sh'), '--help', cwd='/'))
        b, r = fixture('cli')
        rc, out = run(b, r, ['--dry-run'])
        assert rc == 0 and 'origin/master' in out and 'origin/demons' in out
        override = b / 'alternate-server'
        r[1].rename(override)
        rc, out = run(b, r, ['--dry-run', '--server-repo', str(override)])
        assert rc == 0 and str(override) in out
        # Real entrypoint resolves its source from arbitrary caller CWD, before host preflight.
        p = subprocess.run([str(r[0] / 'deploy/deploy.sh'), '--help'], cwd='/', capture_output=True, text=True)
        assert p.returncode == 0 and '--server-repo' in p.stdout
        print('PASS help arbitrary-CWD sibling override current-branch upstream')
    with log('source-tests.log'):
        b, r = fixture('ff')
        before = [git(x, 'rev-parse', 'HEAD') for x in r]
        after = [advance(x) for x in r]
        (r[0] / 'foreign').write_text('preserved')
        rc, out = run(b, r)
        assert rc == 1 and 'fixture orchestration boundary' in out
        assert all(s in out for s in before + after)
        assert [git(x, 'rev-parse', 'HEAD') for x in r] == after
        assert (r[0] / 'foreign').read_text() == 'preserved'
        print('PASS different branches fast-forward exact before/after SHAs foreign file preserved live unchanged')
        for case in ('dirty', 'staged', 'detached', 'upstream', 'auth', 'divergence', 'collision', 'ignored-collision'):
            b, r = fixture(case)
            old = [git(x, 'rev-parse', 'HEAD') for x in r]
            advance(r[0])
            if case == 'dirty': (r[1] / 'tracked').write_text('dirty')
            if case == 'staged':
                (r[1] / 'tracked').write_text('staged'); git(r[1], 'add', '.')
            if case == 'detached': git(r[1], 'checkout', '--detach')
            if case == 'upstream': git(r[1], 'branch', '--unset-upstream')
            if case == 'auth': git(r[1], 'remote', 'set-url', 'origin', 'https://SENTINEL_SECRET@127.0.0.1:1/missing')
            if case == 'divergence':
                (r[1] / 'local').write_text('local'); git(r[1], 'add', '.'); git(r[1], 'commit', '-m', 'local')
                advance(r[1])
            if 'collision' in case:
                advance(r[1], 'collision', 'remote')
                (r[1] / 'collision').write_text('foreign')
                if case == 'ignored-collision': (r[1] / '.git/info/exclude').write_text('collision\n')
            rc, out = run(b, r)
            assert rc == 1 and 'fixture orchestration boundary' not in out and 'SENTINEL_SECRET' not in out
            if case in ('divergence', 'collision', 'ignored-collision'):
                assert git(r[0], 'rev-parse', 'HEAD') != old[0]
            else:
                assert git(r[0], 'rev-parse', 'HEAD') == old[0]
            if 'collision' in case: assert (r[1] / 'collision').read_text() == 'foreign'
            print('PASS', case, 'rejected; live unchanged')
        # Multiple entries matter: stripping the first NUL-delimited path used
        # to corrupt a different path in each list and miss the real collision.
        for label, name in (('space', ' collision'), ('tab', '\tcollision'),
                            ('newline', '\ncollision'), ('trailing-space', 'collision ')):
            b, r = fixture('whitespace-' + label)
            old = [git(x, 'rev-parse', 'HEAD') for x in r]
            advance(r[0])
            advance(r[1], name, 'REMOTE')
            foreign = {name: b'FOREIGN COLLISION', ' before': b'FOREIGN BEFORE'}
            for path, data in foreign.items():
                (r[1] / path).write_bytes(data)
            (r[1] / '.git/info/exclude').write_text('*\n')
            rc, out = run(b, r)
            assert rc == 1 and 'Unsafe untracked path collision' in out
            assert 'fixture orchestration boundary' not in out
            assert git(r[0], 'rev-parse', 'HEAD') != old[0]
            assert git(r[1], 'rev-parse', 'HEAD') == old[1]
            assert all((r[1] / path).read_bytes() == data for path, data in foreign.items())
            print('PASS whitespace-' + label + ' ignored collision rejected; multiple foreign files byte-identical; server HEAD unchanged; live unchanged')
        print('PASS second-repository pull failure leaves first advanced without activation')
    with log('dry-run.log'):
        b, r = fixture('dry')
        advance(r[0]); advance(r[1])
        (r[0] / 'untracked').write_text('keep')
        before = snapshot(b)
        rc, out = run(b, r, ['--dry-run'])
        after = snapshot(b)
        assert rc == 0 and before == after and not (b / 'deploy.lock').exists()
        (OUT / 'before-after-state.json').write_text(json.dumps(dict(before=before, after=after, equal=True), indent=2))
        print('PASS dry-run byte-identical refs/files live/service/web/DB/releases locks unchanged')
    with log('lock-tests.log'):
        b, r = fixture('lock')
        advance(r[0])
        # Local upload-pack blocks only the pull (ls-remote uses a different protocol request).
        hook = r[0] / '.git/hooks/post-merge'
        hook.write_text('#!/bin/sh\ntouch "' + str(b / 'entered') + '"\nsleep 2\n')
        hook.chmod(0o755)
        first = run(b, r, wait=False)
        deadline = time.monotonic() + 15
        while not (b / 'entered').exists() and time.monotonic() < deadline: time.sleep(.02)
        if not (b / 'entered').exists():
            print(first.communicate(timeout=5)[0])
            raise AssertionError('post-merge hook did not run')
        rc, out = run(b, r)
        assert rc == 1 and 'already locked' in out
        output = first.communicate(timeout=30)[0]
        print(output); print('INVOCATION_EXIT_STATUS=' + str(first.returncode))
        assert first.returncode == 1 and 'fixture orchestration boundary' in output
        rc, out = run(b, r)
        assert rc == 1 and 'fixture orchestration boundary' in out and 'already locked' not in out
        print('PASS concurrent mutation excluded; lock released after failure')
        b, r = fixture('self-update')
        seed = r[0].parent / 'diplomacy-seed'
        code = (seed / 'deploy/source.py').read_text().replace("print('SELF_UPDATE_RESUMED", "print('PULLED_IMPLEMENTATION\\nSELF_UPDATE_RESUMED")
        code = code.replace("        return finish(client, server)",
                            "        (client.parent / 'resumed').touch()\n        __import__('time').sleep(2)\n        raise RuntimeError('fixture orchestration boundary')", 1)
        advance(r[0], 'deploy/source.py', code)
        pinned = [git(x.parent / (x.name + '-seed'), 'rev-parse', 'HEAD') for x in r]
        updated = run(b, r, ['--expected-client', pinned[0], '--expected-server', pinned[1]], wait=False)
        deadline = time.monotonic() + 15
        while not (b / 'resumed').exists() and time.monotonic() < deadline: time.sleep(.02)
        assert (b / 'resumed').exists()
        rc, contender = run(b, r)
        assert rc == 1 and 'already locked' in contender
        out = updated.communicate(timeout=30)[0]
        rc = updated.returncode
        print(out); print('INVOCATION_EXIT_STATUS=' + str(rc))
        assert all(p.read_text() == 'untouched' for p in (b / 'live').iterdir())
        assert rc == 1 and out.count('PULLED_IMPLEMENTATION') == 1 and out.count('SELF_UPDATE_RESUMED') == 1
        assert 'PUBLISHED_PAIR_MATCH ' + ' '.join(pinned) in out
        assert out.count('"after_branch"') == 2 and 'fixture orchestration boundary' in out
        rc, out = run(b, r)
        assert 'already locked' not in out
        print('PASS self-update pulled implementation exactly once; inherited lock; no recursive pulls')
finally:
    shutil.rmtree(BASE)
