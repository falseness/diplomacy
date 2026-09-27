# Complete retained TASK-211/AC1 consumption

Run from the client repository into a fresh local artifact directory:

```sh
NODE_PATH=/opt/diplomacy/node_modules /usr/local/bin/node20 ops/run_asset_review.js artifacts/TASK-225/review-UNIQUE
```

This prerequisite comparison starts from review-50's crosswalk and historical
annex, validates the catalog adapter, and freezes current task/research inputs.
It reviews AC1 only. AC2 version compatibility and AC3 gameplay are separate
obligations. Neither those obligations nor the complete TASK-225 gate is claimed
by this command.

The original green-07 assets archive uses `proofPaths`; the generic inspector
only understands `proof`/`proofs`. A copied archive adds the `proofs` alias to each
case in its coverage report. The original report is retained byte-identically as
`original-coverage.json`. The consumer adapter validates that exact transformation,
all original file hashes, the selected file set and the manifest before calling
the unchanged production archive inspector. It never rewrites the original run,
its plan, selected cases, checkpoints, budget or source identities.

The independent report combines the existing asset reader with shipped HTML
external dependency URLs, bound instrumentation, cold/warm and failure/recovery
phases, admission slots, inbound packets for both participants and the observed
context counts. Expectations do not derive from checkpoint `expected` or `pass`
fields. The hash-matching instrumentation delays via CDP continueRequest and
fails via route.abort; it does not fulfill replacement library bytes. Its full
source is inspected when this contract is reviewed. The Python oracle is rerun
at consumption; an arbitrary JSON report cannot supply the assertions. The
production clause validator still enforces source, tier, case, context,
milestone, trace, hash and exact target-text ownership.

The same measured inventory feeds both sides of the comparison. Only AC1 is
re-consumed with the prepared archive. Every non-target result and all eight
self checks must remain exactly equal. The full inventory and summaries are
persisted, including unresolved later-ticket dependencies. Missing/tampered
proof, changed ownership, omitted assertions and altered archive projection must
fail the same adapter/consumer path on separate copies.

With stale sources the successful transition is `unresolved-local` to
`reviewed-historical`. Semantic review improves; current coverage and the number
of unresolved required prior targets do not. A narrowly bounded provider refresh
is appropriate only after affected dependencies freeze. The selected crosswalk
requires `consume_asset_review.js`, its prepared directory and the validated
historical adapter; passing that JSON alone to the existing full gate is not
supported. Full-gate integration, current-source transition, TASK-230's intended
red contract, later TASK-231/232 dependencies, G09 and remaining clauses stay
explicit obligations. This command does not launch services or browsers.
