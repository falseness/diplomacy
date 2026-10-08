#!/usr/bin/env python3
"""Source preparation only. No release, service, web or database mutations."""
import argparse
import fcntl
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys

LOCK = Path('/home/bakharevns/.diplomacy-deploy.lock')
NODE = '/usr/local/bin/node20'


def git(root, *args):
    # Git diagnostics can include credential-bearing URLs: never forward them.
    env = dict(os.environ, GIT_TERMINAL_PROMPT='0', GIT_OPTIONAL_LOCKS='0',
               GIT_SSH_COMMAND='ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -o UpdateHostKeys=no -o ControlMaster=no')
    result = subprocess.run(['git', '-C', str(root), *args], stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, env=env)
    if result.returncode:
        raise RuntimeError('Git operation failed: ' + args[0])
    output = result.stdout.decode('utf-8', errors='surrogateescape')
    # NUL-delimited paths are exact names, including leading/trailing whitespace.
    # Other commands have one output newline; preserve any whitespace in values.
    return output if '-z' in args else output.removesuffix('\n')


def inspect(root):
    if Path(git(root, 'rev-parse', '--show-toplevel')).resolve() != root:
        raise RuntimeError('Repository root required')
    branch = git(root, 'symbolic-ref', '--quiet', '--short', 'HEAD')
    upstream = git(root, 'rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}')
    if git(root, 'status', '--porcelain', '--untracked-files=no'):
        raise RuntimeError('Modified or staged tracked files')
    remote = git(root, 'config', 'branch.' + branch + '.remote')
    merge = git(root, 'config', 'branch.' + branch + '.merge')
    remote_sha = git(root, 'ls-remote', '--exit-code', remote, merge).split()[0]
    return dict(branch=branch, upstream=upstream, before=git(root, 'rev-parse', 'HEAD'),
                advertised=remote_sha)


def pull(root, info):
    # Fetch the selected upstream, inspect its exact tree, then pull that immutable
    # local snapshot. This closes the remote-update race for ignored collisions.
    remote = git(root, 'config', 'branch.' + info['branch'] + '.remote')
    merge = git(root, 'config', 'branch.' + info['branch'] + '.merge')
    git(root, 'fetch', '--no-tags', remote, merge)
    target = git(root, 'rev-parse', 'FETCH_HEAD')
    tracked = git(root, 'ls-tree', '-r', '--name-only', '-z', target).split('\0')
    untracked = git(root, 'ls-files', '--others', '-z').split('\0')
    for path in filter(None, untracked):
        if any(path == t or path.startswith(t + '/') or t.startswith(path + '/')
               for t in filter(None, tracked)):
            raise RuntimeError('Unsafe untracked path collision')
    git(root, '-c', 'merge.autoStash=false', '-c', 'rebase.autoStash=false',
        'pull', '--ff-only', '--no-rebase', '--no-autostash', '.', target)
    after_branch = git(root, 'symbolic-ref', '--quiet', '--short', 'HEAD')
    if after_branch != info['branch']:
        raise RuntimeError('Branch changed during deployment')
    print(json.dumps(dict(repo=str(root), **info, after_branch=after_branch,
                          after=git(root, 'rev-parse', 'HEAD'))), flush=True)


def preflight(roots, dry):
    for tool in ('git', 'ssh', 'sudo', 'df', 'flock', 'python3'):
        if not shutil.which(tool):
            raise RuntimeError('Missing required tool: ' + tool)
    import pwd
    if pwd.getpwuid(os.geteuid()).pw_name != 'bakharevns':
        raise RuntimeError('Run as bakharevns')
    result = subprocess.run([NODE, '--version'], capture_output=True, text=True)
    if result.returncode or not result.stdout.startswith('v20.'):
        raise RuntimeError('Pinned Node 20 unavailable')
    # -N prevents timestamp updates; -n prevents prompts, -l does not execute.
    if subprocess.run(['sudo', '-n', '-N', '-l', 'systemctl', 'restart',
                       'diplomacy-server.service'], capture_output=True).returncode:
        raise RuntimeError('Noninteractive sudo unavailable')
    for root in roots:
        if shutil.disk_usage(root).free < 1024 ** 3:
            raise RuntimeError('Less than 1 GiB available')
    print('Preflight: tools, Node 20, disk and noninteractive sudo OK', flush=True)


def finish(client, server):
    # Retain flock while the privileged child recovers from interruption.
    child = subprocess.Popen(['sudo', '-n', 'python3', '-B', str(client / 'deploy/orchestrate.py'), str(client), str(server)], start_new_session=True)
    handlers = {}
    interrupted = False
    def forward(signum, frame):
        nonlocal interrupted
        if not interrupted:
            interrupted = True
            child.send_signal(signum)  # sudo forwards signals to its command
    try:
        for sig in (signal.SIGINT, signal.SIGTERM): handlers[sig] = signal.signal(sig, forward)
        code = child.wait()
    finally:
        for sig, handler in handlers.items(): signal.signal(sig, handler)
    if code or interrupted: raise RuntimeError('Release orchestration failed')
    return 0


def main(argv=None, client=None):
    parser = argparse.ArgumentParser(description='Deploy current upstream branches with complete verification')
    parser.add_argument('--dry-run', action='store_true', help='Read-only report; no fetch, pull or lock')
    parser.add_argument('--server-repo', type=Path, help='Default: sibling diplomacy_server')
    args = parser.parse_args(argv)
    client = (client or Path(__file__).resolve().parent.parent).resolve()
    server = (args.server_repo or client.parent / 'diplomacy_server').resolve()
    if client == server:
        raise RuntimeError('Client and server must be distinct repositories')
    resume = os.environ.pop('_DIPLOMACY_SOURCE_RESUME', None)
    if resume:
        state = json.loads(resume)
        fd = state['fd']
        if args.dry_run or state['client'] != str(client) or state['server'] != str(server):
            raise RuntimeError('Invalid source-update continuation')
        lock_stat = Path(state['lock']).stat()
        held_stat = os.fstat(fd)
        if (held_stat.st_dev, held_stat.st_ino) != (lock_stat.st_dev, lock_stat.st_ino):
            raise RuntimeError('Lost deployment lock')
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if [git(r, 'rev-parse', 'HEAD') for r in (client, server)] != state['heads']:
            raise RuntimeError('Source changed during continuation')
        print('SELF_UPDATE_RESUMED exactly once; lock retained', flush=True)
        return finish(client, server)
    preflight((client, server), args.dry_run)
    if args.dry_run:
        for root in (client, server):
            print(json.dumps(dict(repo=str(root), **inspect(root))), flush=True)
        print('DRY_RUN: read-only; untracked collision/ancestry checks deferred to guarded ff-only pull')
        return 0
    with LOCK.open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError('Deployment already locked') from None
        infos = [inspect(root) for root in (client, server)]
        old = {p: (client / 'deploy' / p).read_bytes() for p in ('deploy.sh', 'source.py')}
        for root, info in zip((client, server), infos):
            print(json.dumps(dict(repo=str(root), phase='before', **info)), flush=True)
            pull(root, info)
        if any((client / 'deploy' / p).read_bytes() != data for p, data in old.items()):
            for p in old:
                git(client, 'ls-files', '--error-unmatch', 'deploy/' + p)
            os.set_inheritable(lock.fileno(), True)
            os.environ['_DIPLOMACY_SOURCE_RESUME'] = json.dumps(dict(
                fd=lock.fileno(), lock=str(LOCK), client=str(client), server=str(server),
                heads=[git(r, 'rev-parse', 'HEAD') for r in (client, server)]))
            os.execv(str(client / 'deploy/deploy.sh'), [str(client / 'deploy/deploy.sh'),
                                                      '--server-repo', str(server)])
        return finish(client, server)


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (RuntimeError, OSError, ValueError, KeyError) as exc:
        # Only our bounded messages, not raw OS paths/URLs or exception details.
        message = str(exc) if isinstance(exc, RuntimeError) else 'Deployment preflight/continuation failed'
        print('ERROR: ' + message, file=sys.stderr)
        print(json.dumps({'status': 'failed', 'failure': {'stage': 'source/preflight/orchestration', 'reason': message},
                          'cleanup': 'see release result if orchestration started; otherwise not-needed',
                          'rollback': 'see release result if orchestration started; sources never reset'}), file=sys.stderr)
        sys.exit(1)
