# Complete canonical phase accounting

This diagnostic implements the finite experiment in
`artifacts/TASK-102/diagnosis.md`. It makes no production optimization or speed
acceptance claim. It runs four complete canonical commands in off/on/on/off order,
on one frozen actual predecessor, without concurrent local benchmarks. It refuses
to overwrite its destination or replace failed repetitions.

```sh
python3 ai/diagnostics/task102-full-phases.py \
  --output artifacts/TASK-102/full-phases \
  --node-bin /root/.npm/_npx/ebaba8b9e55fd0a9/node_modules/node/bin
python3 ai/diagnostics/task102-audit-full-phases.py artifacts/TASK-102/full-phases
```

The driver archives the complete current HEAD and links the installed dependencies.
It records their versions, the Node binary directory, common 6144-MiB heap,
commands, source hashes and prospective external-baseline hashes before starting.
The command retains its original default external-baseline path; its bytes are
copied to the evidence directory and checked before and after every process.
This cannot recover the missing historical hash of that input.

The opt-in preload changes only the runner's in-memory diagnostic source, saved as
`observed-runner.js`. Archived source files remain unchanged. Both modes use the
same wrappers and preserve complete game results, teacher examples and every fit
loss history. Only the on mode adds monotonic intervals, boundary memory and GC
observation. No candidate-level trace, forced GC, retention changes, inference
substitutions, policy switches or worker changes are introduced.

The phase stack requires the canonical single-worker execution. Each interval's
exclusive time subtracts its immediate nested children. Ranking preparation and
cleanup surround the ranking fit; pretraining preparation surrounds its fit.
Teacher rollout and three distinct evaluation classes remain separate. Model
loads/disposal and checkpoint writes are nested within their calling phase.
Startup ends immediately before main execution. The named residual includes
unobserved preparation, metadata work and common evidence serialization. External
wall time minus the Node monotonic lifetime measures process/bootstrap/shutdown
overhead. All these exclusive shares reconcile to the outer command time. GC
intervals are clipped and unioned as overlapping time, never added to the shares.

Memory snapshots retain only numeric counts and process memory statistics, not
game/model objects. The ranking boundary records the live input batch's retained
results and examples. Step boundaries record retained metric counts. Cumulative
teacher counts are explicitly cumulative, not a claim that all teacher examples
remain live. Evaluation result objects in retained metrics are available in the
complete metrics file. Natural runtime ownership and retention are unchanged.

The auditor requires all 130 outcomes, 50 teacher games, 15 training steps,
32 fit histories and 16 saved models. It compares complete outcomes, exact teacher
bytes, all losses, all model topology/weight hashes, and complete metrics/progress
objects across every run. Only each run's storage directory is normalized. It
independently checks interval nesting, reconciliation, required phase names,
source/input/log hashes and final completion markers. Its summary retains every
boundary and scenario, not just averages. On/off time ratios are calibration with
unisolated host/lifecycle variation; no overhead is subtracted.

Inspect `summary.json` to form the measured phase/retention decision. Phase shares
alone cannot establish a regression or external blocker. A supported intervention
must subsequently isolate one mechanism with policy and outcomes fixed; only a
justified production candidate triggers the original actual-predecessor
determinism/regression and both median-of-three 10% speed gates.

The completed observation experiment must not be repeated unchanged. Its targeted
undo-vector ownership follow-up uses `--ownership-reversal`, observation on in all
four arms, and the protocol in [task102-ownership-phases.md](task102-ownership-phases.md).
The same auditor validates the complete semantics and phase accounting for both
experiment types, including the exact single-expression source delta.
