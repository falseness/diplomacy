TASK-087 measures the pre-fast-action training entrypoint at
`e293fc6fe1eda281efcf97cf6a9c9bd1eb063c5c`. Later production changes already
contain vectorized scoring, so this measurement uses an isolated historical
worktree, with every tracked file hashed before and after training.

Reproduce from the repository root, using an unused artifact directory:

```sh
NODE_PATH=/usr/share/nodejs python3 ai/task087-measure-baseline.py \
  --node-bin /root/.npm/_npx/ebaba8b9e55fd0a9/node_modules/node/bin \
  --artifacts artifacts/TASK-087-repeat
```

Point `--node-bin` at an installed Node 20+ binary directory. `NODE_PATH` above
allows this host's system npm to resolve its distribution-provided modules.
The wrapper uses the existing installed dependencies and records their inventory.
It refuses to overwrite training output or run a modified historical tree.

The fresh September 7, 2026 run completed with exit 0 in **599.525253 seconds**
on Node 20.20.2/npm 8.5.1. Fast vectorized actions were not used: each candidate
still applies its command, calls `vectoriseGrid()`, and undoes the command.

The output contains 15 training steps, 15 metrics rows and 15 progress rows.
Thirty actual evaluation games expose 354 total rounds, 1,482 inference calls
and 29,878 inference positions. These are evaluation-only counters, not full-run
action counts. Evaluation outcomes were 16 model wins and 14 sudden-death
non-results, all retained. No speedup or model-strength threshold is asserted.

Interpret historical field names carefully: `episodeLength=96` counts synthetic
samples, and the 28 old/new comparisons compare prediction loss rather than
playing games. The entrypoint also runs 38 heuristic-teacher games, whose outcomes
it does not emit. Training includes genuine TensorFlow fitting and model export,
but its teacher is handwritten. Evaluation uses direct TensorFlow predictions.
The candidate always plays side A on tiny-duel; there is no final holdout.
Synthetic checkpoint comparison and curriculum evaluation share numeric seed
104943 across different generators. This evidence cannot establish generalization.

Complete evidence lives in `artifacts/TASK-087/`: `full-training.log`,
`anti-cheating-audit.md`, frozen `baseline-source/`, `source-sha256.json`,
`checkpoint-sha256.txt`, `summary.json`, `evaluation-results.json`,
`model-controls.log`, and the full `training/` output tree. Controls confirm
missing-model failure, weight-dependent real/zero/random predictions, and exact
restoration; they run after timing and make no winrate claim. The artifact audit
and its actual grep output are recorded in `artifacts/progress.md`.

Artifacts are intentionally excluded from the commit. The committed changes
provide the repeatable measurement wrapper and this interpretation of the result;
they do not change gameplay, training, or candidate scoring.
