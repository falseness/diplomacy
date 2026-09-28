# Terminal AC7 saved-proof stop

`ops/inspect_terminal_scope.js` checks one bounded-coverage clause against
the immutable join-143 acquisition. It is a sufficiency diagnostic, not a
whole-row reviewer. A matching size cannot grant AC7 credit. It binds the
trace to the consumed AC1 selection's original manifest and the shipped map
definitions to both acquisition source snapshots before evaluating them.

The next competitive game's original persisted board is 21 by 21 (441 cells).
The shipped two-human map catalog includes `tiny deathmatch`, 20 by 10 (200
cells), its smallest map by cell count. Both dimensions are no larger than the
observed board, so this discrepancy does not depend on choosing area over width
or height as the size measure. The checker selects the new document at the
`first-move-before` boundary by identity, verifies the old terminal document is
unchanged, and rejects ambiguous/missing boundaries or a co-op board.

The source explains the mismatch: `terminal-flow-next-game.js` toggles from
co-op into competitive mode and starts a new game without selecting a map.
`menu/menu.js` restores the competitive sliders. The initial reconnect's
`tiny deathmatch` argument applies only to its competitive branch; this
provider reconnects into co-op before starting the next game. Tiny co-op
fixtures and a passing first move therefore cannot establish the next
competitive game's smallest-map clause.

Evidence and actual process receipts are in
`artifacts/TASK-225/scope-152`. The inspector exits 2 for this saved mismatch;
its passing verification parent requires that exact exit and independently
checks 200 expected versus 441 observed cells. Synthetic corruption controls
test the checker only. The original provider, sources, projections and receipts
remain unchanged. No provider or cumulative consumer is launched, and no
successor selection or semantic closure is claimed.

AC4's previously recorded acquisition-location problem remains separate. AC5
and AC8 also cannot inherit a successful complete invocation from the provider
child: the original outer consumer exited 1, and a successful original outer
supervisor receipt is absent. Later review successes are their own invocations.
AC6 still needs a separate complete tier/independence review; this map failure
neither disproves nor establishes it. AC7's other clauses are retained as
candidate observations, not credited through a partial reader.

Before a justified changed acquisition, include actual shipped-menu selection
of the smallest competitive map in its declared observation contract, together
with AC4's location/records and complete original parent/child receipts. Record
the chosen map and persisted dimensions before the first move. Changing the
helper also changes a pinned acquisition dependency; freeze and account for
that source change before reuse. Do not patch archived traces, infer a new
board from fixture metadata, or rerun the unchanged provider. The current
selection remains `ac1-148/run-02/reviewed-crosswalk.json` with
`evidence_terminal_ac1_current_gate_v2.js`; saved counts remain 134 prior
obligations and eight self owners. Full steps 3/4/5/7 remain prerequisite-gated.
