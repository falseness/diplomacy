"""Backstop cleanup for detached test services, including killed/timed-out tests."""
from contextlib import contextmanager
import json
import os
from pathlib import Path
import shutil
import signal
import tempfile
import time
import uuid


@contextmanager
def owned_environment(env, output):
    token = uuid.uuid4().hex
    temp = Path(tempfile.mkdtemp(prefix='candidate-check-'))
    marker = ('CANDIDATE_CHECK_OWNER=' + token).encode()

    def owned():
        result = []
        for proc in Path('/proc').glob('[0-9]*'):
            try:
                if marker in (proc / 'environ').read_bytes().split(b'\0'):
                    # Zombies have no running resources and cannot receive signals.
                    if (proc / 'stat').read_text().rsplit(')', 1)[1].split()[0] != 'Z':
                        result.append(int(proc.name))
            except (OSError, ProcessLookupError):
                pass
        return result

    def stop(pids, sig):
        for pid in pids:
            # Recheck ownership immediately before signalling; never use names/ports.
            if pid in owned():
                try:
                    os.kill(pid, sig)
                except ProcessLookupError:
                    pass

    try:
        yield dict(env, CANDIDATE_CHECK_OWNER=token, TMPDIR=str(temp))
    finally:
        residual = owned()
        stop(residual, signal.SIGTERM)
        deadline = time.monotonic() + 2
        while owned() and time.monotonic() < deadline:
            time.sleep(.05)
        stop(owned(), signal.SIGKILL)
        deadline = time.monotonic() + 2
        while owned() and time.monotonic() < deadline:
            time.sleep(.05)
        remaining = owned()
        shutil.rmtree(temp)
        proof = dict(ownedToken=token, residualBeforeCleanup=residual,
                     aliveAfter=remaining, temporaryRoot=str(temp),
                     existsAfter=temp.exists())
        (output / 'owned-cleanup.json').write_text(json.dumps(proof, indent=2) + '\n')
        if remaining or temp.exists():
            raise RuntimeError('Candidate owned resources survived cleanup')
