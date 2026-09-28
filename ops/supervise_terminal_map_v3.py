#!/usr/bin/env python3
"""Versioned acquisition supervisor with kernel-reported signal provenance.

No provider retry, signal suppression, or inference about the signal's sender.
The v2 acquisition worker and its source/evidence contracts remain unchanged.
"""
import json
import os
import pathlib
import signal
import subprocess
import sys
import time


def process_identity(pid):
    """Read process identity only; argv/environment can contain credentials."""
    result = {"pid": pid}
    try:
        raw = pathlib.Path("/proc", str(pid), "stat").read_text()
        name, fields = raw.split("(", 1)[1].rsplit(")", 1)
        fields = fields.split()
        result.update(comm=name, state=fields[0], parentPid=int(fields[1]),
                      processGroup=int(fields[2]), session=int(fields[3]),
                      startTicks=int(fields[19]))
    except (FileNotFoundError, ProcessLookupError, PermissionError):
        result["unavailable"] = True
    return result


def supervise(out, command, *, cwd="/root/diplomacy", stop_seconds=3300,
              cleanup_seconds=60):
    out = pathlib.Path(out).absolute()
    assert not out.exists(), "fresh acquisition required"
    assert 0 < stop_seconds <= 3300 and 0 < cleanup_seconds <= 60
    started = time.monotonic()
    stop_at = started + stop_seconds
    signals = []
    timed_out = False
    escalated = False
    watched = {signal.SIGINT, signal.SIGTERM}
    previous_mask = signal.pthread_sigmask(signal.SIG_BLOCK, watched)

    def save(name, value):
        target = out / name if out.is_dir() else pathlib.Path(str(out) + "-" + name)
        target.write_text(json.dumps(value, indent=2) + "\n")

    def forward(child, number):
        try:
            os.killpg(child.pid, number)
            return True
        except ProcessLookupError:
            return False

    try:
        with open(str(out) + "-supervisor.log", "x") as log:
            child = subprocess.Popen(
                command, cwd=cwd, env={**os.environ, "NODE_PATH": "/opt/diplomacy/node_modules"},
                stdout=log, stderr=subprocess.STDOUT, start_new_session=True,
                # sigwait requires the supervisor to block these signals. Its
                # worker must retain the original mask and receive forwarding.
                preexec_fn=lambda: signal.pthread_sigmask(signal.SIG_SETMASK, previous_mask))
            save("supervisor-start.json", {
                "startedMs": round(time.time() * 1000), "command": command, "cwd": cwd,
                "supervisor": process_identity(os.getpid()),
                "launcher": process_identity(os.getppid()),
                "child": process_identity(child.pid),
                "supervisorSource": str(pathlib.Path(__file__).resolve()),
                "stopSeconds": stop_seconds, "cleanupSeconds": cleanup_seconds})
            cleanup_at = None
            while child.poll() is None:
                info = signal.sigtimedwait(watched, 0.1)
                if info is not None:
                    row = {"signal": info.si_signo, "atMs": round(time.time() * 1000),
                           "siCode": info.si_code, "senderPid": info.si_pid,
                           "senderUid": info.si_uid, "sender": process_identity(info.si_pid),
                           "forwarded": forward(child, signal.SIGTERM)}
                    signals.append(row)
                    save("supervisor-signal.json", signals)
                    cleanup_at = min(cleanup_at or float("inf"),
                                     time.monotonic() + cleanup_seconds)
                now = time.monotonic()
                if now >= stop_at and not timed_out:
                    timed_out = True
                    forward(child, signal.SIGTERM)
                    cleanup_at = min(cleanup_at or float("inf"), now + cleanup_seconds)
                if cleanup_at is not None and now >= cleanup_at and child.poll() is None:
                    escalated = True
                    forward(child, signal.SIGKILL)
                    child.wait()
            code = child.wait()
            record = {"command": command, "cwd": cwd, "actualRunnerExit": code,
                      "timedOut": timed_out, "escalated": escalated,
                      "elapsedMs": round((time.monotonic() - started) * 1000),
                      "observedBy": "Python Popen.wait OS child exit; sigtimedwait kernel sender",
                      "fullInvocation": False, "supervisorSignals": signals}
            save("process-exit.json", record)
            print(json.dumps(record), flush=True)
            return 0 if code == 0 and not timed_out and not signals else 1
    finally:
        signal.pthread_sigmask(signal.SIG_SETMASK, previous_mask)


if __name__ == "__main__":
    output = os.path.abspath(sys.argv[1])
    sys.exit(supervise(output, ["python3", "ops/run_terminal_map_v2.py", output]))
