# TASK-102 dense vector construction diagnostic

Actual predecessor: f0e6283880c0b09ee3ef8a8d580a375f0123bf62.
The completed lookup/ownership factorial is rejected and will not be repeated.
This distinct mechanism replaces the two zero-filled sparse vector allocations
with copies of a dense zero template. The template is private to each fresh VM,
rebuilt on schema-length changes, and never returned to callers. Every result
remains an independent ordinary Array. Undo capture/restoration, candidate
snapshots, lookup, predictors, policies and game lifetimes remain unchanged.
Dense storage may reduce downstream element-access cost; this is a hypothesis,
not a measured claim or a reason to assume either full speed gate passes.

Freeze complete sources, Node/dependency/model bytes before execution. Use Node
20.20.2, tfjs 4.22.0 and a 6144-MiB heap. The existing bounded six teacher fixtures
(137088–137093) and six component fixtures (10200–10205) run in
control/candidate/candidate/control order, followed by an untimed oracle arm.
Keep all outcomes and complete teacher examples, including every failure. The
oracle compares every global/local vector with the original constructor using
Object.is. Exercise that oracle through the movement/combat invariant suite.
Focused controls check independently owned vectors, schema resizing, positive
zero and rejection of an intentionally corrupt constructor and malformed source.

Advance only with exact semantics and >=10% mean improvement in both bounded
groups, with positive effects in both pairs. Otherwise close this intervention
and retain pending; do not repeat it unchanged. These small diagnostic fixtures
exclude full training lifecycle effects and cannot satisfy acceptance. A passing
screen requires a frozen production candidate, actual-predecessor determinism,
all prescribed regressions and both original median-of-three >=10% gates against
that single predecessor. No historical canonical pass may be banked.

Teacher/component seed sets are disjoint; repeated arms deliberately share their
fixtures. Checkpoint training seeds are not established. This tests representation
equivalence, with no learned-strength or unseen-holdout claim.
