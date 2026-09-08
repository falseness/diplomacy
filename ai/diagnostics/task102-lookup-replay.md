# TASK-102 canonical lookup replay

The prescribed experiment was completed in commit `900e25c`; its evidence is in
`artifacts/TASK-102/lookup-replay/`. The instructions below document reproduction,
not an outstanding experiment. The first pending task in `artifacts/tasks.json`
remains the authority for whether another experiment is permitted.

The archived scan ablation improved six of eight canonical early/late pairs but
regressed early old/new by 8.56% and early baseline by 2.22%. Two repetitions per
side did not establish a consistent lookup cost reversal. No production
correction was promoted, and no new full speed cycle was triggered. The replay
auditor can check the saved files without rerunning games. Do not repeat the
unchanged experiment or interpret its diagnostic passes as speed acceptance.

The unresolved coverage includes fitting, full-process training-data retention,
and the original process's JIT/GC history. The external baseline's original-run
weight hash binding is also unavailable. These are limits of the evidence, not
proof of an external blocker or justification for another allocation prototype.

`task102-prepare-lookup.py OUTPUT` freezes the current sources and selects the first
and last archived A/B pair of each of four inference classes from
`artifacts/TASK-102/undo-ownership/full-speed/canonical-training-after-1-outcomes.jsonl`.
It includes the six existing component fixtures. Selection uses archive order.
Generated checkpoint model/weight hashes must match the original run manifest.
The external baseline checkpoint is frozen at the exact archived path; see the
attempt's checkpoint-provenance log for any missing historical hash binding.

Run `node ai/diagnostics/task102-lookup-replay.cjs MANIFEST VARIANT MODE OUTPUT`
with Node 20.20.2 and `NODE_OPTIONS=--max-old-space-size=6144`. Variants are `control`
and `scan`; modes are `off`, `counts`, `trace`. Use control/scan/scan/control in
that order for each mode, retaining every result and complete command log. Run
`python3 ai/diagnostics/task102-audit-lookup.py OUTPUT_DIRECTORY` after all passes.

The scan variant disables construction and use of suburb lookup in full
vectorization and fast apply. It uses the original scan already in production,
including neighbour getter reuse. Tensor packing, undo ownership and context
isolation are fixed. Only the component uses the optimized component packer;
canonical evaluations use `cloud-train-runner.createRuntimeModelPredict` with
original checkpoint routing. Teacher games use the real expert-label collector.
All results and teacher examples are retained, and traces assert prediction
snapshot lifetime. Complete canonical outcomes must match the saved run.

Counters report site executions, including Set and string construction estimates,
suburb visits, and eligible vectorized cells (both full-grid and changed-cell
refreshes). They do not report allocated bytes. Off runs have no per-cell hooks.
Count/trace overhead is calibrated separately per variant and early/late class.
GC intervals overlap wall time; the auditor clips and unions them instead of
adding them to elapsed time. Before/after memory readings are observed values,
not exact peaks or allocation volumes.

This is a diagnostic replay, with models loaded once and its results retained.
It omits fitting, full-process training-data retention, and the original training
process's JIT/GC history. Its means are not the required full median-of-three
speed gates. No learned-strength or unseen-holdout claim is made. Keep TASK-102
pending unless a justified production candidate passes both original gates.

For supplemental full/changed-cell eligibility counts, preload
`ai/diagnostics/task102-lookup-phases.cjs` with Node's `-r` option before the replay
in `counts` mode, once for control and once for scan. Freeze the preload hash and
order in `phase-predeclared.json`. The auditor reconciles these phase counts with
the original totals and reports the additional observational overhead separately.
The teacher game-number recovery reproduces `runtimeCombatTeacherGameSeed`'s
997-per-stage offset; it does not choose new seeds.
