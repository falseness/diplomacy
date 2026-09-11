# TASK-106 two-game baseline evaluation experiment

`evaluateCurriculumBaselineAiWinrate` accepts the programmatic
`baselineEvaluationConcurrency` option. It defaults to zero (the original
in-process path). A positive integer uses fresh model snapshots and isolated
per-game processes; a custom `curriculumPredictFunction` always stays serial.
This experimental option is not enabled by the training CLI or `--workers`.

The evaluator shares the original game logic with children. It preserves indices,
seeds, sides, limits, routes, ordered results and non-results. Each evaluation
snapshots its current model once, waits for all launched children to exit, and
rejects missing, duplicate, misidentified, stale-model and failed responses.
Children dispose both models before reporting and exiting. A ten-minute process
deadline rejects an unfinished child; it never converts it to a game result.

Run the bounded comparison with Node 20.20.2, `NODE_PATH=/usr/share/nodejs` and
`NODE_OPTIONS=--max-old-space-size=6144`:

```
node ai/tests/task106-two-game-evaluation.cjs FROZEN_SOURCE CURRENT_CHECKPOINT BASELINE_CHECKPOINT OUTPUT_JSON
node ai/tests/task106-evaluation-lifecycle.cjs
node ai/tests/task106-evaluation-callback.cjs FROZEN_SOURCE BASELINE_CHECKPOINT
```

Freeze the actual predecessor before edits. The comparison has two separate
boundaries, state seeds 87087/87089, games 1/2, and reversed arm order. A fixed
one-element in-memory weight change distinguishes the live model from its disk
checkpoint. Compare complete outcomes and inference counts, not just winners.
Timing includes snapshotting, baseline loading, IPC, startup and child teardown;
current model initialization is outside every arm because training already has it.
The callback check compares actual callback invocation counts and full outcomes
against the frozen evaluator, with a null current model and concurrency requested.
Lifecycle protocol fixtures test the real launcher; the invalid-model case uses
the real child entry point. These fixtures do not supply gameplay results.

Iteration 16 against 4e5138632c7fc2554bc4cc6c293be7903c541dc6 passed full result
parity but failed the predeclared conservative opportunity gate: 20.480586% net
local saving projects only 9.770994% total saving at the minimum historical
baseline-evaluation share. This is a two-boundary screen under shared-host
contention, not a canonical median-of-three measurement. Do not enable it by
default, claim the TASK complete, or repeat unchanged full timings on this basis.
Immutable logs, checkpoints' hashes, source freeze and outcome records are under
`artifacts/TASK-106/iteration-16`; artifacts must never be committed.
