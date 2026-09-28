# Terminal AC2 proof sufficiency stop

`node20 ops/inspect_terminal_ac2.js <predeclared-output-directory>` inspects the
frozen TASK-221/green-12 archive without running a provider or consumer. It binds
the original evidence hashes and review-127 tools and selections. The retained
run is `artifacts/TASK-225/review-128`.

The late-update proof has a concrete observation defect. The pinned
`terminal-flow-next-game.js` imports `OBSERVE` from `observation-game.js` for
both sides of `late-active-receipt-no-change`. That observer reads `p.isLost`
and `players[0].isGameEnded`. In the pinned production `player.js`, these getters
prune town/unit registries and assign `gameSettings.coop.result`. The source
counterexample executes the complete production class definitions and exact
observer: a killed unit and town disappear and a stored defeat becomes draw.
This demonstrates observer mutation capability, **not** that the historical
game actually experienced this counterexample or that production gameplay fails.

The exact insufficient fields are `checkpoints.json` entries
`terminal-to-coop/next/late-active-receipt-no-change.{expected,observed}` and
`terminal-to-competitive/next/late-active-receipt-no-change.{expected,observed}`.
Both values were gathered after invoking these getters. There is no independent
raw pre/post observation at this boundary to exclude observer repair or pruning.
The saved database comparisons do not recover the missing browser state.
`endTurnEnabled` in this observer means `!unactive`; it is not `canClick` and
must not be treated as evidence of enabled invalid controls.

Captured packet bytes, their earlier capture, appended polling response and
dispatch are present in both defeat journeys. Victory/draw need not repeat this
same network boundary: absence of their replay is not the stop reason. UI and
both reconnect records are mapped separately. No partial whole-criterion credit
is granted; semantic corruption controls and the cumulative consumer comparison
remain unexecuted because the required proof is insufficient.

## Bounded affected-proof acquisition plan

Before refreshing the terminal provider, complete the separately owned AC3 and
lifecycle/tier inspection as already required. Replace only this terminal
observer with a dedicated passive observer: serialize raw unit/town registries,
killed flags, ownership, gold, round, stored result, waiting, `canClick`, undo and
timer fields without invoking `isLost`, `isGameEnded`, `toJSON`, board packing or
pruning helpers. Preserve raw arrays; derive living players outside the browser.
Add a source control with throwing mutation getters to prove the observer does
not invoke them and compare registry identity/content before and after capture.

Keep the two existing defeat journeys as representative late-packet boundaries;
retain all four selected terminal journeys in the eventual complete provider.
Capture both participants immediately before replay and after confirmed dispatch,
bind packet bytes to their earlier authenticated receipt, and persist read-only
MongoDB snapshots plus post-reconnect raw observations. Use the existing legal
inputs, seed 1, two humans, initial fixtures and natural clocks. Do not mutate
runtime boards or reconstruct missing historical observations.

Declare one cumulative estimate of 30 minutes for the affected complete terminal
provider plus new reader/consumer comparison, with a 55-minute stop and cleanup
before 60 minutes; revise the estimate before execution if lifecycle work shows
it cannot fit. Require actual detached OS receipts and owned-resource cleanup.
Independently derive expected states from fixtures and pinned rules. Reject
resumed turns, extra income, resurrected players, enabled controls and changed
replay bytes even when hashes are rebound. Only then compare absent/present AC2
review on identical proof through the cumulative consumer, retaining AC1, all
five sequence historical rows and every non-target disposition.

This is an acquisition plan, not an executed refresh. Review-114 remains current,
review-127 remains immutable historical ancestry, and 63 required prior current
obligations, 74 current criteria and eight self owners remain. Full TASK-225
steps 3/4/5/7 are still prerequisite-gated; keep TASK-225 pending.
