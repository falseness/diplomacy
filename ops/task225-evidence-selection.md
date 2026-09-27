# TASK-225 explicit evidence selection

`evidence_selection.js` derives a fresh inventory from the frozen review-70
selection, canonical original provider and definition-bound historical annex.
The saved inventory is only a comparison reference. It never supplies computed
dispositions. Independent AC1/2/3/7 readers rerun against original proof.

The optional preload installs the selection at the existing gate's actual
`A.inventory(tasks, research, reviews)` boundary without modifying tested server
source. Raw reviews keep their existing behavior. Full-gate invocation, **only
after all required local prerequisites close**, uses:

```sh
NODE_OPTIONS='--require /root/diplomacy/ops/evidence_selection_gate.js' \
EVIDENCE_AUDIT_REVIEWS=/absolute/fresh/reviewed-crosswalk.json \
NODE_PATH=/opt/diplomacy/node_modules /usr/local/bin/node20 \
tests/reliability/run.js --suite evidence-audit --output-dir /absolute/fresh/green-run
```

Run that command from `/root/diplomacy_server`. Its supervisor remains responsible
for the single invocation deadline and owned cleanup. The selection comparison
is `node ops/run_evidence_selection.js <fresh-output>` from the client repository.
It is a prerequisite experiment, never a full audit PASS.

Fresh bytes may be reused inside one synchronous transaction. Each proof first
passes canonical containment and SHA-256 validation. All cached read/proof files
are hashed again before returning, including on failures. No cache survives a
call, no persisted verdict is cached, and sources retain the existing inspector's
current-versus-historical decision. Transaction tests cover changed bytes and
escaped paths. The measured comparison records timings and reuse counts.

The fixed baseline protects prior row ownership and omissions. Additional
criteria must have their own complete independent reader, be explicitly selected,
and pass through the same ordinary clause consumer; file presence does not
establish semantics. Retained source changes require a precise refresh and must
never be suppressed. All evidence remains local under artifacts/TASK-225.

The cumulative extension command is:

```sh
NODE_PATH=/opt/diplomacy/node_modules timeout --signal=TERM --kill-after=10s 3300s \
/usr/local/bin/node20 ops/run_evidence_extension.js <fresh-output> \
asset-records,asset-AC5,asset-AC6,asset-AC8
```

Each selected criterion is consumed separately, checking every non-target
disposition after each transition. The adapter accepts only registered independent
readers and their exact owners/receipts. Its compact annex reference is hash bound
and expanded before the same retained inventory validator. The report records
the complete cumulative selection; never resume from a raw crosswalk alone.

`inspect_evidence_remaining.js` recomputes recorded source differences and lists
remaining obligations. Its output adds no coverage. Existing directory-proof
formats and stale sources require explicit projections and affected refreshes;
G09 workload/progress, long-phase and natural-clock obligations remain required.
