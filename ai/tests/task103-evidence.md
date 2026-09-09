# TASK-103 evidence capture

`npm run test-model-predict-batching` checks the production browser `predict()`
function against the previous allocation algorithm on seeded random boards of
sizes 1, 2, 48 and 200. A TensorFlow facade is necessary because tfjs re-exports
`tensor3d` through a getter without a setter: direct assignment silently leaves
the old test's spy uninstalled. The test checks exact allocation, inference and
readback counts, tensor lifetime, and observes 48 allocations in the old path as
a negative control.

With Node 20 on PATH, capture all npm test scripts and the required short smokes:

```sh
NODE_PATH=/usr/share/nodejs NODE_OPTIONS=--max-old-space-size=6144 \
  python3 ai/tests/task103-evidence.py --mode regression \
  --artifacts artifacts/TASK-103/regression-NEW
```

After regressions finish, capture the original TASK-103 implementation against
its immediate parent, with three runs per arm in A/B/B/A/A/B order:

```sh
NODE_PATH=/usr/share/nodejs NODE_OPTIONS=--max-old-space-size=6144 \
  python3 ai/tests/task103-evidence.py --mode canonical \
  --artifacts artifacts/TASK-103/canonical-NEW
```

The tool refuses an existing destination, checks out the actual historical
revisions in isolated local clones, and shares the host dependencies. It records
commands, revisions, hashes, environment, elapsed wall times, exits and complete
stdout/stderr. The same observational preload records all exported runtime game
starts, results and exceptions in both arms; it does not change gameplay inputs
or outcomes. Runs use fresh storage, 15 training steps, one epoch, seed 87087,
two old-versus-new games and the original plateau arguments. Regression commands
have a 300-second limit; canonical commands have a 3600-second limit. An unfinished
command is an explicit failure, never a successful measurement.

The historical comparison isolates commit `94a8d8e` from parent `d03d37a`.
Besides predict batching, that commit changed combat projection allocations,
coordinate scoring allocations and fit batch size. Its timings cannot establish
that batching alone speeds up training, or that a test-only correction speeds
up current HEAD. Current production `ai/model.js` can be compared separately to
the historical implementation; later training changes must not be credited to
this task. Preserve all failed runs and do not select replacements based on speed.

A successful capture process is insufficient for task readiness. Audit the
1000-call/48-candidate micro-benchmark's median reduction, the canonical speed
gate, every regression exit, all 15-step completion manifests, source hashes and
per-game outcome coverage. Retain pending status when any required gate fails.
