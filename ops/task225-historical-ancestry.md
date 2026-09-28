# TASK-225 explicit historical ancestry

The current terminal gate uses `terminal_ancestry_v1/evidence_sequence_gate.js`.
These static modules are copies of the frozen ancestry readers and adapters,
with only relative import/tool-path routing and historical freshness observations
changed. `historical_ancestry_modules.json` binds both original and versioned
module hashes. No original reader, archived selection, report or pin is edited.
The original consumer path still rejects join-143's new Player implementation.

`historical_source_pins.json` separately pins review-127's entire selection,
ten exact source manifests and their saved independent review reports. The
historical helper requires acquisition before/after identities to agree, an
empty acquisition-stale list, and the exact recorded passing freshness
assertions. It returns that recorded past observation, not a fabricated current
comparison. Unknown directories, rewritten source objects, changed reports,
missing proof and changed original/versioned tools fail closed. Other semantic
assertions and all source-code inspections still execute unchanged. This reader
path accepts only the explicitly listed history; it cannot acquire new proof.

The helper also performs the real live source comparison and exposes its full
results in `historical-source-observations.json`. The ordinary `inspectRun` and
cumulative consumer retain their independent live comparisons and choose
`reviewed-historical` for stale archives. Current AC2/AC3 readers retain the exact
reviewed Player pin and all raw-state, movement, listener and readiness checks.
Their selection tool bindings additionally include every versioned ancestry
module and policy file, separately from the original acquisition tool hashes.

Run the scoped comparison with a fresh directory:

```
NODE_PATH=/opt/diplomacy/node_modules python3 ops/run_terminal_binding_review.py artifacts/TASK-225/<fresh>/run-01
```

The supervisor declares a 30-minute estimate, a single 55-minute work deadline
and a 60-minute cleanup ceiling. It runs eight source tests, the old rejection,
the new readers, nine corruption controls and actual cumulative consumption.
It checks a target-only AC3 transition relative to the newly computed baseline,
unchanged non-target rows and eight self owners; it does not restore old counts.
The caller must record the supervisor's actual OS exit as well. Saved failures
must be kept, and an unchanged provider acquisition is not authorized.

This command remains scoped: even successful consumption cannot certify the
aggregate audit or its eight current-invocation self checks. Required full-run
artifacts must be reported as absent or scoped until the task's prerequisites
close. Do not mark TASK-225 ready for verification from this comparison alone.

The first changed comparison, ancestry-146/run-01, failed after all ten ancestry
preflights because the oldest Python asset oracle returned new live freshness
fields inside an otherwise identical report. Its OS exit 1, 441146 ms budget,
4661-check handoff audit and tested tool copies remain preserved. The versioned
base selection now compares every semantic field unchanged, validates the exact
pinned historical report/source manifest, and independently checks both new
freshness fields against a live comparison. It records full Python oracle
stdout/stderr, argv, cwd and actual exits in historical-oracle-executions.json;
old and current freshness are separately reported. Original Python tools and
reports remain unchanged. A source regression rejects rebound semantic changes,
suppressed live differences and rewritten historical report data.

Final scoped run: `ancestry-147/run-01`, actual consumer/supervisor exits 0,
839657 ms, cleanup true. Eight source tests and nine corruption controls pass.
AC2 consumes 137 -> 136; AC3 consumes 136 -> 135, preserving non-target rows and
eight self owners. The separate handoff audits 20144 checks and distinguishes
74 source-driven historical downgrades from the temporary pre-AC2 omission and
current rebind. The full task remains pending with 135 prior obligations; no
full coverage-audit or current-invocation self-check completion is claimed.
