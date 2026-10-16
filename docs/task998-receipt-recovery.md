# TASK-998 receipt recovery

Keep the active `artifacts/TASK-998/receipt-index.json` as an overlay keyed by
`matrixID`. Rebuilding it from historical lane handoffs can silently discard
newer compatible receipts. Receipt inventory is not execution certification.

Before refreshing a case:

1. Read the task diagnosis and preserve the active index under a distinct
   directory inside `artifacts/TASK-998`.
2. Finalize source changes, record `multiplayerGate.inputIdentity()` using
   `/usr/local/bin/node20`, and validate existing fresh receipts with
   `undoReceiptModules.validateExactReceipt`. Do not rewrite proof identities.
3. Measure stored evidence with the canonical mount-aware accounting in
   `tools/agents/ralph.py`: unique regular-file sizes, no interior symlink
   traversal, and no expanded archive mount traversal. Report allocation and
   free disk separately. Reserve space before execution. Only older completed
   tasks outside the twenty-task protected window may be compressed, preserving
   original readable paths and tested restoration. Lane originals stay intact.
4. Execute exactly one stale case through `runUndoCoverage.js --case-id`, with
   a distinct inward output directory, the isolated main client/server pair,
   and a 590000 ms outer deadline including cleanup. Record the actual exit.
5. Validate the fresh receipt and previously compatible receipts together.
   Compare the complete source/runtime identity before and after. Replace only
   the selected matrix ID; preserve every other entry and the previous index.
6. Record cumulative validation results, replacement reasons, original proof
   paths, hashes and cleanup. Derive counts from validated receipts. A metadata
   classification of stale or unexamined evidence is not a gameplay failure.

The undo/chain pilot requires both receipts to pass under one identity before
expansion. A full proof scan may be bounded and checkpointed. A prefix-only
identity scan can classify a mismatched recorded digest as stale; it cannot
certify matching or unresolved evidence. Keep unexamined cases explicit.

The final gate remains 3900 validated scenarios, with 528 restart scenarios
outside scope and 1404 original structural exclusions. Invoke the collection
validator explicitly with `--validate-collection --receipt-index`; never start
an implicit service-backed full collection. Registered gate tests and negative
controls do not substitute for the complete receipt audit. Keep the task pending
when any proof or storage reservation is unresolved.

For the recovery-4 unresolved paths, run the metadata-only reference resolver:

```sh
timeout 590 tools/task998-proof-references.sh artifacts/TASK-998/<new-attempt>
```

It checks original execution hashes, locates inward plain or gzip proof references,
and verifies the SHA-256 of the original uncompressed bytes before classifying the
recorded identity. It does not copy other tickets' proof, rewrite receipts, restore
filesystem aliases, or start services. A resolved compressed reference is not yet
a readable original path for `validateExactReceipt`, and a stale identity still
requires fresh execution. Preserve its reference index as a recovery map; avoid
expanding stale historical proof merely to reach the already-known identity failure.

Plan historical-path restoration separately from new execution storage. Sum the
reference index's `originalBytes` for compressed references to measure the cost of
restoring plain paths; a gzip file's stored size is not that cost. Pending task
outputs must remain uncompressed. Estimate new proof using current pilot sizes,
include logs and transient peak usage, and do not admit a full refresh based on
one small case or filesystem free space alone. When no full-volume plan fits the
canonical 40 GiB budget, retain pending and state the measured shortfall without
claiming a gameplay failure or full coverage.
