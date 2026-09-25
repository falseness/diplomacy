# TASK-225 catalog reconciliation prerequisite

`reconcile_evidence_catalog.js` validates a historical annex against the retained
`green-03/task-input.json` and the selected `review-43` crosswalk. All 22 absent
historical criterion reviews remain in that annex. Four provider identities are
explicitly historical-only; their archived task definitions do not become current
obligations. The current catalog and the 22 research targets remain authoritative.

The adapter invokes the production `evidence-reviews.inventory` consumer with
provider-only projections whose criterion arrays are empty. It asserts exact
current target conservation before doing so. The consumer inspects their real
retained archives and recomputes reviewed-clause proof normally. No fake run
objects or manufactured current-source flags are used. Historical definition
and selected run bindings are checked independently before projection.

The controlled comparison changes only catalog/review metadata: stale TASK-224
reviewed clauses and G11 gain bounded refresh follow-ups, and self AC1 regains
ownership of its actual current text. It does not finalize any self check. G09,
TASK-209/AC3 and historical TASK-231 natural-clock/death/result obligations remain
unresolved. Source staleness is not interpreted as a gameplay regression.

Run in a fresh output directory from the client repository:

```sh
NODE_PATH=/opt/diplomacy/node_modules /usr/local/bin/node20 ops/run_catalog_reconciliation.js artifacts/TASK-225/review-UNIQUE
```

This command is a prerequisite comparison, not the full evidence-audit gate.
Its reports explicitly distinguish structural normalization, semantic closure,
freshness and full readiness. The historical annex must accompany its candidate;
passing the normalized JSON alone to the old gate omits provider metadata and
must not be claimed as complete integration. The full gate needs this validated
adapter at its inventory boundary before eventual execution, once all local proof
is available; modifying that provider-bound server source now would invalidate
existing current archives. The comparison checks both inventories' common
measured run objects for exact equality.

The controls reject unknown/missing current targets, rehashed tampered historical
definitions and provider bindings, altered self text/ownership, and omitted annex
reviews. Immutable archive bytes are read only. No service or browser is launched.
