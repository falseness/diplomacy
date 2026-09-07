#!/usr/bin/env python3
"""Archive a fresh TASK-101 timing run of the frozen, original fast-action entrypoint."""

import argparse
import difflib
import hashlib
import json
import os
from pathlib import Path
import shlex
import subprocess
import time


FAST_REVISION = "211548c"
RUN_ID = "task101-fast-full-real"


def output(*command, cwd, env=None):
    return subprocess.check_output(command, cwd=cwd, env=env, text=True).strip()


def instrument_teacher_outcomes(source, artifacts):
    """Log original runGame results without changing options or error propagation."""
    runner = source / "ai/cloud-train-runner.js"
    original = runner.read_text()
    start = original.index("function makeRuntimeCombatTeacherBatch(")
    end = original.index("\nasync function fitRuntimeCombatTeacherBatch", start)
    batch = original[start:end]
    assert batch.count("    runGame({") == 1
    batch = batch.replace("    runGame({", """    const scenario = {seed: seed + stageIndex * 997 + game,
      batchSeed: seed, stageIndex, game, side: 'A', mapName: 'tiny-duel',
      playerA: 'AIPlayer', playerB: 'SimpleAiPlayer'};
    console.log('TEACHER_GAME_START: ' + JSON.stringify(scenario));
    try {
    const result = runGame({""")
    needle = "    });\n  }\n  const sampleCount"
    assert batch.count(needle) == 1
    batch = batch.replace(needle, """    });
    console.log('TEACHER_GAME_RESULT: ' + JSON.stringify({scenario,
      ...result, crash: false, failure: result.winnerSide !== 'A'}));
    } catch (error) {
      console.log('TEACHER_GAME_RESULT: ' + JSON.stringify({scenario,
        winner: null, winnerSide: null, crash: true, failure: true,
        nonResult: true, error: String(error.stack || error)}));
      throw error;
    }
  }
  const sampleCount""")
    instrumented = original[:start] + batch + original[end:]
    runner.write_text(instrumented)
    (artifacts / "teacher-logging.diff").write_text("".join(difflib.unified_diff(
        original.splitlines(True), instrumented.splitlines(True),
        fromfile="a/ai/cloud-train-runner.js", tofile="b/ai/cloud-train-runner.js")))


def archive_teacher_outcomes(artifacts, revision):
    log = artifacts / "full-real-training.log"
    lines = log.read_text().splitlines()
    starts = [json.loads(line.removeprefix("TEACHER_GAME_START: "))
              for line in lines if line.startswith("TEACHER_GAME_START: ")]
    results = [json.loads(line.removeprefix("TEACHER_GAME_RESULT: "))
               for line in lines if line.startswith("TEACHER_GAME_RESULT: ")]
    report = {"base_revision": revision,
              "full_real_training_log_sha256": hashlib.sha256(log.read_bytes()).hexdigest(),
              "source_manifest_sha256": hashlib.sha256(
                  (artifacts / "source-sha256.json").read_bytes()).hexdigest(),
              "attempted": len(starts), "completed_records": len(results),
              "games": results}
    (artifacts / "teacher-game-results.json").write_text(json.dumps(report, indent=2) + "\n")
    assert starts == [result["scenario"] for result in results], "Unaccounted teacher attempt"
    assert len(starts) == 38, f"Expected 38 teacher games, observed {len(starts)}"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--node-bin", required=True, type=Path)
    parser.add_argument("--artifacts", type=Path, default=Path("artifacts/TASK-101"))
    args = parser.parse_args()
    repo = Path(__file__).resolve().parent.parent
    artifacts = args.artifacts.resolve()
    artifacts.mkdir(parents=True, exist_ok=True)
    source = artifacts / "fast-source"
    revision = output("git", "rev-parse", FAST_REVISION, cwd=repo)
    if not source.exists():
        subprocess.run(["git", "worktree", "add", "--detach", str(source), revision],
                       cwd=repo, check=True)
    assert output("git", "rev-parse", "HEAD", cwd=source) == revision
    dependencies = source / "node_modules"
    if not dependencies.exists():
        dependencies.symlink_to(repo / "node_modules", target_is_directory=True)
    dirty = output("git", "status", "--porcelain", cwd=source)
    assert dirty in ("", "?? node_modules"), dirty
    instrument_teacher_outcomes(source, artifacts)
    dirty = output("git", "status", "--porcelain", cwd=source)
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
    assert "class AIPlayerWithEconomy extends AIPlayer" in players
    assert players.count("this.scoreActionCommandsWithFastVectorGrid(") == 3
    assert "applied = applyFastAction(mutableGrid, commands[i])" in players
    assert "undoFastAction(mutableGrid, applied)" in players
    (artifacts / "fast-scoring-source.txt").write_text(players)
    with (artifacts / "full-real-training.log").open("w", buffering=1) as log:
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
            "FAST_SCORING": "PASS AIPlayer and AIPlayerWithEconomy use shared applyFastAction/undoFastAction scorer",
            "START_UTC": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }.items():
            log.write(f"{key}: {value}\n")
        started = time.monotonic()
        result = subprocess.run(command, cwd=source, env=env, stdout=log, stderr=subprocess.STDOUT)
        elapsed = time.monotonic() - started
        log.write("END_UTC: " + time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()) + "\n")
        log.write(f"EXIT_CODE: {result.returncode}\nELAPSED_WALL_SECONDS: {elapsed:.6f}\n")
        assert all(hashlib.sha256((source / name).read_bytes()).hexdigest() == digest
                   for name, digest in hashes.items())
        log.write("POST_RUN_SOURCE_HASH_MATCH: PASS\n")
    archive_teacher_outcomes(artifacts, revision)
    print(f"Exit {result.returncode}; elapsed {elapsed:.6f}s; {artifacts / 'full-real-training.log'}")
    raise SystemExit(result.returncode)


if __name__ == "__main__":
    main()
