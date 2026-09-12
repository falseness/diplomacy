# Value-output prerequisite

`task106-value-output.cjs` tests the hypothesis that runtime prediction can
execute only the consumed `combat_value` graph output. It retains the public
predictor's 32-position batches and follows each checkpoint's actual dependency
graph. In particular, the older baseline checkpoint still needs its shared
convolution layers. This does not change checkpoint weights or training.

The diagnostic accepts a JSON plan and a new output directory. A plan contains
`baseline` and ordered `boundaries`, each with `checkpoint`, `hash`, `state`, and
the two complete saved `results`. It refuses to overwrite an output directory.
Original predictions drive the real games; candidate calls alternate before
and after original calls. Every scalar must be exactly equal, and complete
game results, inference counts, and tensor lifetimes must match. The first
numeric or result mismatch fails the experiment. Partial attempts remain in
`report.json`; they are never completed games or timing samples.

The paired-call milliseconds are diagnostic component measurements with
duplicate work. They are not complete training times. Acceptance requires a
separate cold source comparison against the actual production predecessor,
unchanged fits/evaluations/serialization, the task's complete regression gates,
and its canonical median-of-three speed threshold.

`task106-value-output-controls.cjs` contains separate synthetic batch-boundary,
fresh-weight, missing-output, and execution-error controls. These models and
injected failures never participate in the gameplay comparison.

The iteration-29 source/configuration binding and disposition live under
`artifacts/TASK-106/iteration-29`. Consult that disposition before any further
experiment. A consumed or rejected experiment must not be rerun unchanged.

Iteration 29 rejected this candidate: all four cold four-step runs preserved
39 games, 10 fits, outcomes, weights, curriculum, checkpoint refreshes and
cleanup, but the balanced wall-time reduction was 6.373144887683431%, below
10%. The temporary production change was restored; its exact source copies,
diff and logs remain in the artifact directory. Full regressions and canonical
timing were not reached. TASK-106 remains pending. This closes the experiment;
it is not an active rerun instruction.

`task106-value-output-audit.py` reads that artifact directory, recomputes the
parity/configuration/checkpoint/lifecycle checks and speed result, and exits 1
for the real failed performance gate. Its `--self-test` mode checks separate
missing-result, changed-epoch and changed-weight negative fixtures without
running games or modifying recorded measurements.
