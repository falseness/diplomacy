# TASK-225 prerequisite archive review

The latest immutable review input is local
`artifacts/TASK-225/review-13/reviewed-crosswalk.json`. It retains the completed
TASK-224/AC1..9 reviews from review-12 and reviews TASK-230/AC2, AC3 and AC5
against the affected provider refresh `refresh-230-13`. This provider run passed
25 cases with eleven zero command exits, cleanup, and a 173,387 ms budget.
There are still 163 required prior targets and eight current-invocation self
checks. TASK-225 remains pending; no complete audit has passed.

Use the independent remote-fixture reader with a fresh output path:

```sh
python3 ops/review_remote_fixture_archive.py \
  artifacts/TASK-225/refresh-230-13 \
  artifacts/TASK-225/review-13/new-reader-report.json
python3 -m unittest discover -s ops -p test_review_remote_fixture_archive.py -v
```

The reader verifies the embedded archive hashes and current source bytes,
replays entity projections and economic events using literal prices, checks
typed portal quotas, weak stats and wave schedules, and checks all 3,195 saved
assertions including three deliberate failures. It labels ordinary recorded
comparisons separately from independent entity/economy replay. Authored fixtures
do not prove natural games. A reader pass alone does not close a criterion:
the exact review is consumed by `evidence-reviews.js`, with nine missing-proof,
changed-hash and wrong-expectation controls in review-13.

`review-13/selected-230` is an explicitly later, byte-identical archive copy,
not another game run. Its new manifest exposes the producer's embedded
`coverage-results.json:evidenceHashes` and finalized coverage file to the
existing run-reference consumer. The original 126 files and their original
paths in logs are unchanged; `selected-230-provenance.json` identifies every
copied byte. Neither the original run nor its embedded manifest was rewritten.

TASK-230/AC1 and AC4 remain unresolved: this provider's plan stores string case
IDs without per-case tiers, so the current consumer classifies them as
`unclassified`. Closing its browser/network clauses needs validated per-case
tier binding and full trace/context/milestone review. Do not use a source tier
for those claims, alter historical plans, or refresh an unchanged provider to
work around that metadata gap. The full TASK-225 audit remains prohibited until
all required prior targets have substantive proof.

The following describes the preserved review-11 investigation; its final-receipt
gap was subsequently fixed and validated in review-12. Do not repeat that repair.

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
