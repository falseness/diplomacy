#!/usr/bin/env python3
"""Bounded read-only service/DB and saved-game probes for activation/rollback."""
import argparse
import json
import os
from pathlib import Path
import subprocess


def command(args, **kwargs):
    result = subprocess.run(list(map(str, args)), capture_output=True, text=True,
                            timeout=45, **kwargs)
    if result.returncode:
        raise RuntimeError('Read-only probe command failed: ' + Path(str(args[0])).name)
    return result.stdout


def process():
    data = command(['systemctl', 'show', 'diplomacy-server.service',
                    '-p', 'MainPID', '-p', 'ActiveState'])
    props = dict(line.split('=', 1) for line in data.splitlines())
    if props['ActiveState'] != 'active' or int(props['MainPID']) <= 0:
        raise RuntimeError('Service unavailable')
    proc = Path('/proc') / props['MainPID']
    return (proc / 'exe').resolve(), (proc / 'cwd').resolve()


def health():
    process()
    output = command(['mongosh', '--quiet', 'gameDB', '--eval',
                      'if(db.runCommand({ping:1}).ok!==1)quit(1);print("DB_READY")'])
    if 'DB_READY' not in output.splitlines():
        raise RuntimeError('Database unavailable')
    print('PASS active service and gameDB ping')


def games():
    node, cwd = process()
    env = dict(os.environ, DIPLOMACY_CLIENT_ROOT=str(cwd.parent.parent / 'diplomacy'))
    output = command([node, Path(__file__).with_name('existing_games.js')], cwd=cwd, env=env)
    if not any(line.startswith('SUMMARY games=') for line in output.splitlines()):
        raise RuntimeError('Incomplete saved-game probe')
    return {row['gameID']: row for row in
            (json.loads(line) for line in output.splitlines() if line.startswith('{'))}


def compare(before, after):
    for key, row in after.items():
        if not row['ok'] and (key not in before or before[key]['ok'] or
                              before[key].get('error') != row.get('error')):
            raise RuntimeError('Existing-game compatibility regression')
    print('PASS existing-game compatibility baseline=%d current=%d' % (len(before), len(after)))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=['health', 'capture', 'games'])
    parser.add_argument('--baseline', type=Path)
    args = parser.parse_args()
    if args.mode == 'health':
        health()
    elif args.mode == 'capture':
        print(json.dumps(games()))
    else:
        if not args.baseline:
            raise RuntimeError('Saved-game baseline required')
        compare(json.loads(args.baseline.read_text()), games())


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('FAIL ' + (str(error) if isinstance(error, RuntimeError) else type(error).__name__))
        raise SystemExit(1)
