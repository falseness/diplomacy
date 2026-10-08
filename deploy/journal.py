"""One local/SSH journal command builder, shared by live and final checks."""
from datetime import datetime, timezone
import shlex
import subprocess


def utc(value):
    if isinstance(value, str):
        value = datetime.fromisoformat(value.replace(' UTC', '+00:00').replace('Z', '+00:00'))
    if value.tzinfo is None:
        raise ValueError('Timestamp must have timezone')
    return value.astimezone(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')


def command(since, remote=None):
    args = ['journalctl', '-u', 'diplomacy-server.service', '--since', utc(since), '--no-pager', '-o', 'cat']
    return ['ssh', '-o', 'BatchMode=yes', remote, shlex.join(['sudo', '-n', *args])] if remote else args


def read(since, remote=None):
    return subprocess.check_output(command(since, remote), text=True, timeout=30)


if __name__ == '__main__':
    import sys
    print(read(sys.argv[1]), end='')
