TASK-101 measures the original fast-action full training entrypoint at historical
base `211548c60c730e0da1454a745de8e4d1161c6dfd`, with a disclosed teacher-outcome
logging patch. This is a historical comparison, not current-HEAD performance.

Reproduce from the repository root with an unused artifact directory:

```sh
NODE_PATH=/usr/share/nodejs python3 ai/task101-measure-fast.py \
  --node-bin /root/.npm/_npx/ebaba8b9e55fd0a9/node_modules/node/bin \
  --artifacts artifacts/TASK-101-repeat
python3 ai/task101-audit-teachers.py --artifacts artifacts/TASK-101-repeat
```

Use Node 20+. The wrapper creates a detached worktree and applies only the
`instrument_teacher_outcomes` logging transformation before freezing sources.
`teacher-logging.diff` records that exact change. It logs each teacher scenario
before the original runGame call and its returned outcome afterwards, including
non-results. Exceptions are logged and rethrown. Game options, player classes,
predictions, tensors, training order and result interpretation remain intact.
No runtime player or benchmark function is monkey-patched.

The wrapper records command, cwd, Node/npm/environment, dependencies, base SHA,
dirty status (including the logging patch), complete output, UTC boundaries,
monotonic wall time and exit. Every tracked timed source is hashed before/after.
It refuses reused training output or an already modified historical worktree.
Logging overhead stays in the measured time. `teacher-game-results.json` contains
all original teacher results and SHA256 links to that run's complete log and
source manifest. The audit compares every record against raw output, checks all
source hashes, independently derives the expected teacher seed sequence from
curriculum progress, and checks classes, map, side and non-win accounting.

The full command retains TASK-087 parameters: 15 steps, 1 epoch, seed 87087,
checkpoint interval 1, old/new comparisons 2, plateau window 2, minimum delta 2,
patience 1 and curriculum-lr-reduction-attempted. Output paths and run ID differ.
The logging patch is the only change to the historical training runner; train.sh,
benchmarkHarness.js, model.js and vectorizeContent.js match the old baseline.
The existing curriculum flag declares an attempt; it is not proof of an actual
learning-rate experiment.

The corrected TASK-087 baseline is 599.525253 seconds. The original TASK-101
528.164610-second evidence was rejected because it omitted teacher outcomes;
it is retained under `artifacts/TASK-101/prior-missing-outcomes/`. The replacement
run completed in **462.719008 seconds**, a **22.819096%** raw reduction
(1.295657x old-over-fast ratio). All 38 teacher outcomes and all 30 evaluation
outcomes are accounted, including 12 evaluation sudden-death non-results.
The comparison and throughput are recorded in `artifacts/TASK-101/summary.json` and
`artifacts/progress.md`. Do not combine teacher outcomes from one run with another
run's timing or checkpoints. Earlier 331.097/247.16/264.05-second figures are not
the evidence for this comparison.

All 38 teacher games use heuristic labels; 30 curriculum evaluations directly
use TensorFlow model predictions. Both use real AIPlayer versus SimpleAiPlayer,
tiny-duel 9x7, candidate side A. `episodeLength=96` counts synthetic samples,
and the 28 old/new comparisons are prediction-loss comparisons, not games.
Economy fast scoring is smoke-tested separately; this command trains combat AI.
Missing/zero/random/restored prediction controls establish weight dependence
only. All seed lists and intersections are reported; no balanced unseen holdout
or learned-strength claim is made.

Both historical AI player classes share fast apply/undo candidate scoring. That
version refreshes all cells and caches per batch. Vectorization-only speedup is
INCONCLUSIVE: intervening candidate filtering, undo/ownership/catapult fixes,
variable game lengths, unseeded TensorFlow shuffling and shared-host contention
confound attribution. Timing includes logging and no concurrent test suites.

Existing TASK-105 covers incremental updates and redundant comparisons. Its
performance work should freeze identical policy/candidate ordering, compare
prediction inputs and selected actions on identical scenarios, then measure
repeated alternating runs without concurrent tests. TASK-102 and TASK-103 cover
loading and inference batching. A raw timing regression or correctness/stress
failure requires explicit follow-up; other tasks are not edited by TASK-101.

Task-scoped evidence includes full-real-training.log, teacher-game-results.json,
teacher-audit.log, anti-cheating-audit.md, fast-source/, training/ (all models),
source-sha256.json, teacher-logging.diff, checkpoint-sha256.txt, summary.json,
evaluation-results.json, model-controls.log, policy.diff, workload-match.log and
evidence-audit.log. Artifacts are intentionally not committed.
