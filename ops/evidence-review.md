# TASK-225 prerequisite archive review

Run the read-only reviewer against the explicitly selected bounded archive and
write a new report under artifacts:

```sh
python3 ops/review_ticket_green_archive.py \
  artifacts/TASK-225/refresh-224-09 \
  artifacts/TASK-225/review-11/tier-budget-review.json
```

The output path must not exist. This command verifies evidence and current source
hashes, the 25-case tier manifest, both real service lifecycles, participant and
commit counts, independent economy expectations, elapsed-time arithmetic and
cleanup observations. It launches no game, browser, service or public request.
A successful command is a prerequisite inspection, not a complete audit pass.
Full trace interpretation and exact clause reviews remain separate requirements.

The immutable local `review-11/reviewed-crosswalk.json` continues review-10,
retains its seven current TASK-224 reviews, and adds TASK-224/AC7. The selected
archive is unchanged. Source-only mocked matchmaking cases establish source
behavior; real service startup and browser/wire/state traces establish the two
selected UI/network journeys. Optional cross-products remain unproved.

TASK-224/AC9 remains unresolved: the worker's immutable evidence manifest omits
`verification-budget.json` and `invocation-owned.jsonl.cleanup.json`, which are
written after worker exit. Their observed arithmetic and cleanup are consistent,
but a clause review cannot hash-bind them through the current archive proof
schema. The candidate worker budget and inner cleanup receipt are not substitutes
for those final reports. Preserve the original archive when resolving this
binding; neither rewriting old evidence nor calling a copied archive a fresh
execution is acceptable.

At this review, 167 prior targets remain unresolved and eight self criteria await
current-invocation finalization. Select the crosswalk explicitly through
`EVIDENCE_AUDIT_REVIEWS` when all prerequisites are satisfied. Do not run the full
gate just to rediscover these unresolved reviews. Public TASK-226..229 are deferred
and unproved. Exact delta, corruption controls, trace review, checker output and
artifact audit are local under `artifacts/TASK-225/review-11`.
