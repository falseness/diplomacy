# TASK-225 catalog reconciliation prerequisite

`reconcile_evidence_catalog.js` validates a historical annex against the retained
`green-03/task-input.json` and the selected `review-43` crosswalk. Historical criterion reviews whose ID and text hash do not match a current
target remain in that annex, including reused task numbers. Provider identities are
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

Task numbers can be reused by later catalog entries. Current rows therefore match
both ID and criterion-text SHA-256 outside the provider-only historical definitions.
Those definitions never transfer even an identical boilerplate criterion to a
current reused task number; new or changed criteria get explicit bounded
unresolved reviews. Historical provider keys include their archived definition
hash, so an old TASK-230 run cannot become the current newborn regression's run.
The original annex rows and definitions remain unchanged. G11's historical
provider reference is translated only in the validated consumer projection.

A retained complete review can become `reviewed-historical` when current sources
change. Its bounded refresh obligation explains the loss of freshness without
replaying the provider or claiming new coverage. The comparison reports every
changed disposition, including metadata repairs for new criteria.

Run the cheap identity regression before the actual consumer comparison:

```sh
NODE_PATH=/opt/diplomacy/node_modules /usr/local/bin/node20 ops/test_reconcile_catalog_identity.js
```

The legacy tier validators select their implementation by the original provider
label. `consume_historical_catalog.js` resolves validated namespaced references
in a per-review run set and calls the unchanged production `disposition` checker.
It rejects ambiguous labels and restores definition-bound names in the report.
Current task runs never enter that historical lookup. Summary counts are derived
from the actual disposition results; archive validation and source freshness are
still measured by the production consumer, without modifying server sources.

When a selected run's task disappears from the current catalog, its retained
historical definition and exact run reference become provider-only metadata as
well. The current catalog omits TASK-209/210; their review rows remain in the
annex. TASK-209/AC1 and AC2 are consumed separately against the validated retained
provider and reported as historical, without reintroducing current targets.
G09 and the archived AC3 unresolved long-phase obligation remain intact.
