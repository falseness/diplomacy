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

Measure cross-proof sharing separately from existing per-proof `cas-v1` savings:

```sh
timeout 590 tools/task998-shared-proof-plan.sh "$(realpath artifacts)/TASK-998/<new-attempt>"
```

This offline tool reads original indexed proofs and the hash-checked compressed
reference map. It includes both compatible pilots, the eight largest readable
saved cases, and a deterministic sample covering modules, player counts, fog
and sequence/recovery variants. It checks original execution/proof hashes and
lossless codec round trips, without writing blobs or rewriting original evidence.
The checkpoint records every completed sample; a failed or interrupted run is
not a completed capacity plan.

The proposed layout keeps each proof's manifest and blob-ID list and shares
identical existing codec blob values across proofs. `crossProofSavingsOnly`
compares that layout with compact **already encoded** proofs; it does not count
within-proof encoding savings again. The blob manifest records serialized sizes,
content hashes and reuse counts, not copied proof payloads. Logs, execution
receipts and receipt-index entries are counted separately. Retained original
bytes stay in canonical accounting; they are never subtracted as future savings.

The report provides optimistic and linear full-volume projections, not statistical
confidence bounds. The optimistic estimate assumes all unsampled blobs already
exist; the linear estimate repeats the sample's sharing rate. Neither proves an
upper bound for dynamic future states. Runtime staging remains explicitly
unmeasured, so the tool never reserves capacity or authorizes execution. Use the
reported component costs and uncovered dimensions to design the next bounded
experiment; do not treat a favorable average as storage admission. A native
shared reader/writer still needs missing/corrupt-blob and provenance controls
before any fresh proof uses that representation.

For a bounded follow-up, pass an inward JSON array of at most 48 exact matrix IDs
as the second argument. Requested unavailable or duplicate IDs fail closed. Keep
separate reports and merge their blob manifests by ID/content hash with disjoint
sample IDs; adding the two unique-byte totals would count shared blobs twice.

The codec tool's overhead subtotal includes worker logs, execution receipts and
index entries. Count additional retained service logs, comparison checkpoints
and lifecycle sidecars separately before capacity admission. Recovery-7's
`sidecar-inventory.json` and `combined-storage-plan.json` demonstrate that
additional accounting without copying the original files.

The compressed shared-CAS comparison is checkpointed separately:

```sh
# OUT must resolve beneath the real artifacts/TASK-998 directory.
# Invoke each group with a 590-second outer timeout, retaining its actual exit.
bash tools/task998-compressed-shared-plan.sh "$OUT" 0
# Repeat explicitly for groups 1 through 11, then:
bash tools/task998-compressed-shared-summary.sh "$OUT"
```

Groups measure six cases each (the last measures the added town-capture-coop
case), reuse recovery-9 sidecar and per-proof baseline measurements only after
hash checks, and reconstruct each candidate proof with the existing codec.
Missing and corrupt blobs must fail decoding. The 67 exact sample IDs cover all
18 modules; fine player/fog/sequence strata remain explicit in the summary.
Per-blob compression, compressed manifests including reference IDs, blob lookup
IDs/content hashes, exact sidecars, index entries, and retained originals are
charged separately. Equal allocation of shared blobs supports module-weighted
comparison but is not a prediction of population reuse. The sample mean and
maximum are also reported and neither is an upper bound. No native writer is
installed, so additional collection reports and write/cleanup staging remain
unresolved and the planner cannot admit capacity. Candidate payloads remain in
memory; only measurements and original proof references are retained.

A subsequent pack experiment reuses those exact checkpoint inputs and baseline
costs, checking their hashes before comparison:

```sh
# Use a new inward OUT and an outer 590-second deadline for every group.
bash tools/task998-packed-proof-plan.sh "$OUT" 0
# Explicitly measure groups 1 through 11, retaining group-N-execution.json.
bash tools/task998-packed-proof-summary.sh "$OUT"
```

Each immutable pack holds at most 1 MiB of decoded blob data, except a single
larger indivisible blob. Its separately compressed index records exact offsets,
lengths, content hashes and a pack hash. Per-proof manifests identify their root
and pack references. Reconstruction verifies the pack, slices, and original CAS
semantics; controls reject corrupted packs, altered offsets and missing blobs.
The experiment writes one pack/index pair beneath OUT, reads it back, removes
it in a finally block, and records the maximum simultaneous stored bytes.
This is offline pack staging, not service-writer staging or a full-volume bound.

Sharing is bounded to each six-case checkpoint. Pack costs are allocated by raw
blob size and sample users; this is an accounting convention, not predicted
population reuse. The summary retains all 18 module weights and the saved
unsampled fine strata, and distinguishes payload, compressed offset/hash index,
per-case roots, sidecars, receipts and originals. Native writer staging and
additional collection-report reserves remain unresolved. Neither a favorable
sample mean nor passing reconstruction admits capacity or certifies gameplay.
The runtime codec and active receipt index are unchanged by these tools.

Measure a disk-backed transaction before installing the pack format:

```sh
# Separate 590-second outer deadlines and execution receipts are required.
bash tools/task998-writer-staging.sh "$OUT" largest-pack
bash tools/task998-writer-staging.sh "$OUT" largest-sidecars
bash tools/task998-writer-reservation.sh "$OUT"
```

These select the largest candidate and largest sidecar samples from recovery-11,
then use their complete recovery-10 inventories and hash-checked recovery-9
classifications. Packs, indices, proof roots, exact compressed sidecars and the
transaction manifest coexist on disk. One plain sidecar also coexists during
replacement; atomic rename does not duplicate its compressed bytes. Reconstruction
reads the saved packs and indices. Corrupt or absent packs and absent blobs fail.
The largest-pack transaction injects a failure after writing the complete
transaction and removes owned files during stack unwinding; largest-sidecars
checks normal cleanup. Originals remain references, and disposable candidate
files live inside the task output directory.

The reservation report inventories existing collection reports and proposes twice
those bytes for report replacement. It also calculates population-weighted and
per-module sample-maximum projections. Neither historical sample maxima nor
rejected-collection report sizes bound future successful output. Unsampled strata,
actual service-writer staging and report growth remain admission conditions. This
prototype does not change runtime identity, install a native codec, or certify
fresh service receipts.
