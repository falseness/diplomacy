# Current terminal outcome consumption

`evidence_terminal_ac1_current_gate_v2.js` extends the retained AC3 gate with a
separate `TASK-221-AC1` provider identity. It consumes only the whole outcome
criterion, after revalidating the retained AC2/AC3 selections. The outcome oracle
and lifecycle/receipt/served-source checks are unchanged. Frozen historical
readers, selections and original provider bytes remain untouched.

The AC1 adapter uses the existing independent outcome row builder, with a new
provider key. Its review includes the AC2 lifecycle checks to bind the outcome
observations to original successful execution and cleanup. A passing provider
flag alone is insufficient. Preflight recomputes the report, exact row, original
manifest, projection, reviewer identities and live source validity. Unknown
implementation hashes and rebound semantic corruption fail closed.

Run one bounded offline comparison in a fresh directory:

```
NODE_PATH=/opt/diplomacy/node_modules python3 ops/run_terminal_ac1_current_review.py artifacts/TASK-225/<fresh>/run-01
```

The supervisor records command output and actual child exits, enforces a single
55-minute work cutoff and 60-minute cleanup ceiling, and declares a 30-minute
estimate. Record the supervisor's own OS exit externally. No browser or service
is launched. Source regressions and nine corruption controls run before actual
cumulative consumption. The old/new arms differ only by the AC1 review row;
non-target dispositions and eight self owners must remain identical. Baseline
counts are recomputed, never forced to a historical total.

The runner publishes `reviewed-crosswalk.json` only after real consumption. A
successful scoped result still leaves TASK-225 pending until all prior local
proofs and the full current-invocation self checks close. Required full-task
artifacts are explicitly reported missing or scoped; this runner cannot produce
a complete audit PASS. Historical source differences and remaining obligations
are saved in `inspection.json`; no blanket historical refresh is performed.

The first successful comparison is `artifacts/TASK-225/ac1-148/run-02`: actual
consumer and supervisor exits 0, elapsed 1,122,287 ms, cleanup true. Eight source
regressions and nine corruption controls pass. Actual AC1 consumption changes
135 required prior obligations to 134; non-target dispositions and all eight
self owners are unchanged. Use its `reviewed-crosswalk.json` with
`ops/evidence_terminal_ac1_current_gate_v2.js` as the scoped successor. Do not
repeat this unchanged completed comparison or launch the prerequisite-gated full
audit. `run-01` retains the supervisor wiring failure and exact tested tools.
