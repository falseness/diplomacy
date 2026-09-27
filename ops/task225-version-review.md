# TASK-225 compatibility criterion review

`run_version_review.js <fresh-output>` consumes TASK-211/AC2 on the immutable
review-60 provider. Run from `/root/diplomacy` with
`NODE_PATH=/opt/diplomacy/node_modules /usr/local/bin/node20`.

This is a prerequisite review, not the full evidence-audit gate. It recomputes
the historical catalog adapter and revalidates retained AC1, then applies one
complete AC2 review with the actual clause consumer. Added later-numbered tasks
are informational; in-scope definitions and historical identities must match.
No provider refresh, board mutation, public command or gameplay source edit is
part of this command.

The independent reader uses original observed checkpoints, both browser wire
streams, input actions, requests, served hashes, fixtures and MongoDB snapshots.
It derives movement, gold, turn ownership and next-round expectations without
using the provider's expected/pass fields. Executed test, release extractor and
service launcher hashes bind release selection to the real spawn path; the
old-platform startup log and protocol streams corroborate the pairing. The two
original rejection screenshots were visually inspected. Source validity remains
a separate measurement, not a synonym for semantic review or release readiness.

The output selection consists of `catalog-crosswalk.json`,
`historical-annex.json`, `reviewed-crosswalk.json`, `provider-binding.json`,
`prepared/selected-211`, `prepared/version-review.json` and the original
review-60 AC1 adapter/provenance. The selected projection contains both independent
reports. Do not feed its raw crosswalk directly to the full gate: historical
identity normalization and both proof adapters still need integration there.
A subsequent independent-criterion review must retain these AC1 **and AC2** rows
and their selected run, rather than rerun this single-transition experiment or
reset to review-50/53/55/60 without AC2.

The command rejects missing/changed copied proof, wrong owner and wrong release
through the same consumer. Separate tests rebind copied manifest hashes to
ensure semantic defects still fail. Failed runs remain in their original
folders. Zero unresolved prior targets and all eight invocation self checks
are required before any full-gate or to-verify claim.
