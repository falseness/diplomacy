TASK-101 repeats the original post-fast-action full training measurement at
`211548c60c730e0da1454a745de8e4d1161c6dfd`. It uses a detached historical worktree,
just as the corrected TASK-087 baseline uses its pre-fast-action revision.
This is a historical comparison, not a measurement of current HEAD (which already
contains later training and inference changes).

Reproduce from the repository root with an unused artifact directory:

```sh
NODE_PATH=/usr/share/nodejs python3 ai/task101-measure-fast.py \
  --node-bin /root/.npm/_npx/ebaba8b9e55fd0a9/node_modules/node/bin \
  --artifacts artifacts/TASK-101-repeat
```

Use an installed Node 20+ binary directory. The wrapper records the exact command,
runtime/environment, dependency inventory, revision, dirty state, complete output,
UTC start/end, monotonic elapsed time and exit code. It refuses reused training
output or a modified historical worktree, and hashes every tracked source before
and after timing. It changes no runtime, gameplay or training source.

The September 7, 2026 run completed all 15 training steps and final export in
**528.164610 seconds**, exit 0, using Node 20.20.2/npm 8.5.1. The corrected,
verified TASK-087 baseline is **599.525253 seconds**, giving 71.360643 seconds
less elapsed time, **11.90% reduction / 1.135x old-over-fast ratio**. Earlier
331.097/247.16/264.05-second claims are not the evidence for this comparison.

The same train.sh arguments are used: 15 games, 1 epoch, seed 87087, checkpoint
interval 1, old/new comparisons 2, plateau window 2, minimum delta 2, patience 1,
and the historical curriculum-lr-reduction-attempted flag. Only artifact paths
and run ID differ. train.sh, cloud-train-runner.js, benchmarkHarness.js, model.js
and vectorizeContent.js are byte-identical between frozen revisions. Both use
the same host, Node/npm, NODE_PATH and installed dependency directory. Three
cheap checks overlapped the beginning of this timing (~3 seconds total); this
contention is disclosed and not subtracted.

Throughput is 0.028400 training steps/second. Thirty actual AIPlayer versus
SimpleAiPlayer evaluations expose 352 summed rounds, 1,324 inference calls and
19,932 candidate positions; these counters cover evaluation only. Outcomes:
14 model wins, 4 SimpleAiPlayer wins and 12 sudden-death non-results. All thirty
records are archived. The runner also executes 38 heuristic-teacher games but
does not emit their outcomes. `episodeLength=96` is synthetic samples, not turns;
the 28 old/new comparisons evaluate prediction losses, not played games.

Both historical AIPlayer and AIPlayerWithEconomy use the shared fast apply/undo
scorer. Its original handlers refresh every cell, and it creates one mutable
grid per scoring batch. Current HEAD separately passes its whole-turn cache
smoke, but is not the timed revision. Only combat AIPlayer training is exercised
by this historical command; the economy path is checked by its scoring smoke.

The isolated vectorization speedup is **inconclusive**. Intervening no-progress
candidate filtering, authoritative undo/ownership fixes and catapult changes
alter work, and evaluation positions differ from the baseline's 29,878. Fitting
shuffles are not explicitly seeded, curriculum decisions affect later seeds,
and this is one run on a shared host. No runtime failure or raw wall-time
regression occurred. The run proves neither model strength nor generalization.

Follow-up: existing TASK-105 covers incremental cell updates and redundant
full-board comparisons. Its performance verification should freeze identical
policy/candidate ordering on both paths, compare prediction inputs and selected
actions on identical scenarios, then measure repeated alternating runs without
concurrent checks. Existing TASK-102 and TASK-103 cover script loading and
inference batching. No new correctness/stress/regression ticket was needed for
this successful run; no other task entry was changed in this iteration.

Evidence is under `artifacts/TASK-101/`: full-real-training.log,
anti-cheating-audit.md, fast-source/, training/ (all intermediate/final models),
source-sha256.json, checkpoint-sha256.txt, summary.json, evaluation-results.json,
model-controls.log, policy.diff, workload-match.log and evidence-audit.log.
The baseline-reference directory contains the TASK-087 comparison evidence.
Missing/zero/random/restored controls prove weight-dependent predictions only;
heuristic teacher outputs are separately reported. All runtime training versus
evaluation seed intersections in this fast run are empty; there is no unseen,
balanced final holdout. Artifacts are intentionally not committed.
