#!/usr/bin/env python3
"""Archive a fresh TASK-087 timing run of the frozen, pre-fast-action entrypoint."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import shlex
import subprocess
import time


BASELINE_REVISION = "e293fc6"
RUN_ID = "task087-old-full-real-baseline"


def output(*command, cwd, env=None):
    return subprocess.check_output(command, cwd=cwd, env=env, text=True).strip()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--node-bin", required=True, type=Path)
    parser.add_argument("--artifacts", type=Path, default=Path("artifacts/TASK-087"))
    args = parser.parse_args()
    repo = Path(__file__).resolve().parent.parent
    artifacts = args.artifacts.resolve()
    artifacts.mkdir(parents=True, exist_ok=True)
    source = artifacts / "baseline-source"
    revision = output("git", "rev-parse", BASELINE_REVISION, cwd=repo)
    if not source.exists():
        subprocess.run(["git", "worktree", "add", "--detach", str(source), revision],
                       cwd=repo, check=True)
    assert output("git", "rev-parse", "HEAD", cwd=source) == revision
    dependencies = source / "node_modules"
    if not dependencies.exists():
        dependencies.symlink_to(repo / "node_modules", target_is_directory=True)
    dirty = output("git", "status", "--porcelain", cwd=source)
    assert dirty in ("", "?? node_modules"), dirty
    storage = artifacts / "training"
    assert not storage.exists(), "Use a fresh artifact directory; never overwrite a timing run"
    env = os.environ.copy()
    env["PATH"] = str(args.node_bin.resolve()) + os.pathsep + env["PATH"]
    command = ["./train.sh", "--storage-dir", str(storage), "--run-id", RUN_ID,
               "--games", "15", "--epochs", "1", "--seed", "87087",
               "--checkpoint-interval", "1", "--old-vs-new-games", "2",
               "--plateau-window", "2", "--plateau-min-delta", "2",
               "--plateau-patience", "1", "--curriculum-lr-reduction-attempted"]
    files = output("git", "ls-files", cwd=source).splitlines()
    hashes = {name: hashlib.sha256((source / name).read_bytes()).hexdigest()
              for name in files}
    (artifacts / "source-sha256.json").write_text(json.dumps(hashes, indent=2) + "\n")
    players = (source / "ai/players.js").read_text()
    scoring = players.split("class AIPlayer extends Player", 1)[1].split("doActions(", 1)[0]
    assert "xCommands.push(vectoriseGrid())" in scoring
    assert "actionManager.undo()" in scoring
    assert "applyFastAction" not in players and "undoFastAction" not in players
    (artifacts / "old-scoring-source.txt").write_text(scoring)
    with (artifacts / "full-training.log").open("w", buffering=1) as log:
        for key, value in {
            "COMMAND": shlex.join(command), "CWD": str(source),
            "REPOSITORY_SHA": revision, "DIRTY_STATUS": dirty or "clean",
            "DEPENDENCY_LINK": str(dependencies.resolve()),
            "HOST_REPOSITORY_SHA": output("git", "rev-parse", "HEAD", cwd=repo),
            "HOST_DIRTY_STATUS": output("git", "status", "--short", cwd=repo),
            "NODE": output("node", "--version", cwd=source, env=env),
            "NPM": output("npm", "--version", cwd=source, env=env),
            "PLATFORM": output("uname", "-a", cwd=source),
            "CPU": output("node", "-p", "require('os').cpus()[0].model", cwd=source, env=env),
            "ENVIRONMENT": json.dumps({key: value for key, value in env.items()
                if key.startswith(("DIPLOMACY", "TF_", "CUDA", "OMP_", "NODE_"))
                or key in ("PATH", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS")}, sort_keys=True),
            "DEPENDENCIES": output("npm", "ls", "--depth=0", "--json", cwd=source, env=env),
            "OLD_SCORING": "PASS full vectoriseGrid() per candidate; fast vectorized actions were not used",
            "START_UTC": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }.items():
            log.write(f"{key}: {value}\n")
        started = time.monotonic()
        result = subprocess.run(command, cwd=source, env=env, stdout=log, stderr=subprocess.STDOUT)
        elapsed = time.monotonic() - started
        log.write(f"EXIT_CODE: {result.returncode}\nELAPSED_WALL_SECONDS: {elapsed:.6f}\n")
        assert all(hashlib.sha256((source / name).read_bytes()).hexdigest() == digest
                   for name, digest in hashes.items())
        log.write("POST_RUN_SOURCE_HASH_MATCH: PASS\n")
    print(f"Exit {result.returncode}; elapsed {elapsed:.6f}s; {artifacts / 'full-training.log'}")
    raise SystemExit(result.returncode)


if __name__ == "__main__":
    main()
