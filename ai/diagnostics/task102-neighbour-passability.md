# TASK-102 within-call passability diagnostic

Actual predecessor: 4bd52df209590fdca6ed89079a8ccbba57a322f9. Production stays
unchanged. The previous undo-copy acceptance cycle is complete and failed its
component gate. This is a distinct controlled computation intervention.

Historical simulation samples place Way.create at 11.67–12.13% inclusive teacher
time and sortNeighbours at 2.53–2.57% self time. These are historical bounded
shares, not current full canonical shares or forecasts. Full-phase evidence
places simulation/evaluation at 91.44%. Source inspection finds two identical
passability tests per neighbor. All five current implementations are pure reads;
Border.createLine only appends drawing lines. A local bit mask can retain the
first answer without changing either partition's order or border callbacks.
No result survives the call and no grid, policy, seed, model or context is shared.

Before running, freeze tracked sources, diagnostic tooling and checkpoint bytes
in artifacts/TASK-102/neighbour-passability/manifest.json. Reuse the six teacher
and six component fixtures from the completed simulation study; no seed selection
based on results. Run control/candidate/candidate/control, each in its own Node
20.20.2 process with a 6144-MiB heap, sequentially. Retain all complete results
and elapsed times. Then run audit mode, which compares the original and candidate
neighbor objects/order and complete ordered border callbacks on every real call.
The audit instrumentation is excluded from timings. Compare every retained
teacher example and complete result, not merely winners.

Promotion requires exact results and at least 10% mean improvement in BOTH
bounded workload groups, without a reversed paired effect. This conservative
screen is not TASK-102 acceptance. If it fails, preserve the diagnostic and do
not install the candidate or launch unchanged full gates. If it passes, current
early/late evolving-checkpoint evidence is still needed before a production
candidate's complete correctness and actual-predecessor median-of-three gates.

No learned-strength claim is made; existing fixture overlaps are intentional
paired equivalence, not a holdout. Model ablation is inapplicable to this pure
movement-search change. This finite mechanism study does not repeat the completed
lookup, allocation-owner, ownership or full-phase observation experiments.
