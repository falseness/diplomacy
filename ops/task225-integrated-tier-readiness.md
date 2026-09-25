TASK-225's TASK-245 tier preflight reads a selected immutable archive, including
its later `evidence-hashes.json` index of finalized receipts. Run it explicitly:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 ops/review_integrated_tier_readiness.py \
  artifacts/TASK-225/review-22/integrated/selected-245 \
  --output /tmp/task245-tier-readiness.json
TASK225_INTEGRATED_ARCHIVE=artifacts/TASK-225/review-22/integrated/selected-245 \
  PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s ops \
  -p test_review_integrated_tier_readiness.py -v
```

The output must be new. Exit 1 and `readyForSupplement=false` are intentional:
this is an incomplete proof report, never a passing verification or a consumed
tier supplement. It independently examines raw UI observations, literal stats,
inspection state equality, scout movement and undo, inputs, recipient summaries,
served source hashes, case binding and cleanup. The tests use copied real data;
rehashed semantic corruption, missing proof and path escapes fail.

The frozen refresh-245-23 browser trace has one revision-zero summary for each
of `p0/playYourTurn` and `p1/waitYouTurn`. Both contain a redacted digest but no
serialized received board. `persisted.json` contains complete MongoDB boards;
selection observations contain the first browser's local state. Neither is the
missing second recipient's complete received state. The separate `protocol/`
child records HTTP Socket.IO with in-memory persistence and cannot establish
HTTPS/MongoDB equivalence. No source-to-browser tier promotion is justified.

Before whole AC2/AC5 can close, add sanitized complete inbound state capture
for both reloaded browser recipients to the bounded producer. Independently
compare full entities, economy, metadata, commit and recipient identity with
the persisted current-format snapshot. Preserve the old archive; freeze changes
before the dependency-justified refresh. Then implement the TASK-245-specific
supplement and actual consumer comparison, including its required corruption
controls. This reader deliberately does not accept a newly invented payload
schema or close criteria. TASK-244's path reconciliation and remaining providers
also remain prerequisites to the complete TASK-225 audit.

The bounded producer now writes `received-boards.jsonl` via the browser driver's
raw transport callback. It captures both reload recipients without changing the
page and redacts credentials before persistence. A separate diagnostic compares
every board field with the initial MongoDB board plus saved slot-one preparation:

```sh
python3 ops/review_received_boards.py <journey-directory> --output <new-report>
TASK225_RECEIVED_ARCHIVE=<journey-directory> PYTHONDONTWRITEBYTECODE=1 \
  python3 -m unittest discover -s ops -p test_review_received_boards.py -v
```

This diagnostic requires exactly two recipients, revision zero, current format,
the declared round-four single component and independent income values 106/100.
It does not validate archive/source freshness, assign tiers, emit a supplement,
or close whole criteria. The historical readiness reader continues rejecting
old summary-only evidence. `review-24/capture` is a new focused journey, not a
replacement parent TASK-245 invocation. Integrate the provider-specific consumer
and its bindings before freezing sources and refreshing affected providers.
