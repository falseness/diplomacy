# Undo-copy production candidate

The actual predecessor is fa614887c7150b790abb179be1d562d8a3edb8ee.
The candidate restores copying at undo capture; restoration continues copying.
No predictor, lookup, policy, context, training cadence or retention rule changes.

The completed ownership-phase intervention found whole-command reductions of
14.51% and 18.49%, and baseline evaluation reductions of 23.12% and 21.22%.
Its late-phase consistency rule failed (-2.83% and +12.73%); that diagnostic
remains rejected under its own rule. It does not prove a uniform lifecycle gain.
Nevertheless, TASK-102 AC6 permits a controlled mechanism comparison plus a
source-based plausible effect to justify candidate verification. Copying permits
the displaced vector to become unreachable before undo; this is a concrete
lifetime mechanism consistent with the repeated early GC and wall-time signal.
That evidence is sufficient to risk a fresh acceptance test, not to claim a pass.

Freeze the complete candidate tree before testing. Compare it with the actual
predecessor above using explicit --before/--after arguments to
ai/task102-measure-cache.py, Node 20.20.2 and a common 6144-MiB heap. Preserve
all repetitions in the wrapper's before/after, after/before, before/after order.
Both original ten-percent median-of-three gates apply, including the 50-game
component workload where this candidate has no established advantage. A failure
must remain pending; do not repeat unchanged timings or use diagnostic medians.

Evidence belongs in artifacts/TASK-102/undo-copy-candidate. Run fresh cache and
20-seed predecessor determinism checks, the four prescribed regressions, real
undo lifetime and original-scan invariants, tensor packing, and candidate trace /
teacher-example equality. Keep the historical external baseline hash gap explicit
while freezing future model inputs prospectively. No learned-strength claim.
