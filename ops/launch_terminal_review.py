#!/usr/bin/env python3
"""Detach the bounded supervisor from an interactive command session.

Detachment does not waive exit/timeout checks: require process-exit.json with an
actual zero runner exit, no signal, and a passing handoff audit before credit.
"""
import json
import pathlib
import subprocess
import sys
import time


def launch(output):
    out = pathlib.Path(output).absolute()
    assert out.parent.is_dir() and not out.exists(), 'fresh output in an existing parent required'
    receipt = pathlib.Path(str(out) + '-launch.json')
    log = pathlib.Path(str(out) + '-launcher.log')
    command = ['python3', 'ops/supervise_terminal_review.py', str(out)]
    # Reserve both files before starting the supervisor; an existing receipt
    # must never be overwritten after processes have already been launched.
    with receipt.open('x') as record, log.open('x') as stream:
        child = subprocess.Popen(command, cwd='/root/diplomacy', stdin=subprocess.DEVNULL,
                                 stdout=stream, stderr=subprocess.STDOUT, start_new_session=True)
        identity = pathlib.Path('/proc') / str(child.pid) / 'stat'
        result = dict(argv=command, cwd='/root/diplomacy', pid=child.pid,
                      procStart=identity.read_text().split()[21], launchedMs=round(time.time()*1000),
                      stdin='DEVNULL', stdout=str(log), startNewSession=True,
                      ownsDeadline='supervisor timeout 3300s with 60s cleanup reserve',
                      plannedFinalReceipt=str(out/'process-exit.json'))
        record.write(json.dumps(result, indent=2)+'\n')
    return result


if __name__ == '__main__':
    print(json.dumps(launch(sys.argv[1])))
