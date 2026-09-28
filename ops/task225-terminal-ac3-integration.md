# TASK-225 whole terminal AC3 integration

Current consumed selection remains join-139/run-01 until an actual AC3 consumer
transition passes. Immutable review-114/review-127 ancestry is never rewritten.
Run `python3 ops/run_terminal_ac3_integration.py <fresh-directory>` for one
30-minute estimated scoped invocation, with a cumulative 55-minute work deadline
and cleanup/reporting before 60 minutes. This is not the full TASK-225 audit.

| AC3 clause | Producer boundary | Independent reader / consumer |
| --- | --- | --- |
| Actual menu and next game in each mode | Original mouse menu inputs preserved, menu-before/menu-after for both recipients | Ordered real tap receipts; visible menu, old socket disconnected, old timer stopped; new mode/connection and distinct persisted game |
| New connection and first legal movement | Both recipients at first-move-before/after plus read-only games collection | Select unit by actual input coordinates; independent hex adjacency, own empty land and blocking registry checks; exact decrement by one, same unit identity/HP, unchanged ownership, gold, remainder, turn/commit, native timers and peer |
| Old sockets/timers cannot affect replacement | Per-document identities retained before menu and read at every subsequent boundary | Exact old identities retained, new socket/timer distinct, connected replacement and stopped old resources |
| Queued old events do not change board | Named nonempty retain/invoke receipts; both recipients callbacks-before/after and read-only databases | All three event names, indexes and successful invocation receipts; exact original terminal body; complete raw state unchanged, including occupancy/ownership/HP/moves/gold/turn/commit/controls/timer storage |
| Preserve AC2 and original journeys | Existing AC2 preload with hash-pinned AC3 helper instrumentation | All four original assertions, real packet/reconnect/persistence checks and lifecycle independently revalidated from same new provider |
| Actual cumulative transition | Separate TASK-221-AC3 provider key; same-run rebound AC2 | Absent/present whole AC3 review on identical proof; preserve non-target rows, eight self owners and ancestry; intended 62 to 61 |

Only the test helper is instrumented in memory; its exact original hash and
instrumented hash are recorded and independently checked. Served client/server
rules are unchanged. The added peer callback invocation uses the same bare
`fn(body)` call as the original source control. It is explicitly source-tier,
not authenticated packet replay. Natural clocks and original input predicates
remain active. Raw snapshots preserve storage; only newly allocated empty grid
unit identities are normalized for first-move comparison, and every occupied
alias is checked exactly. Callback comparisons do not normalize anything.

Before acquisition, source tests exercise both modes and content-rebound missing
receipts/boundaries, game/recipient, socket/timer, movement/HP/gold/ownership,
turn/commit, timer storage, peer change, real input and callback-body corruptions.
Source fixtures cannot grant gameplay credit. Acquisition or semantic failure
stops consumption at its actual boundary, retains diagnostics, and leaves the
current selection and task status unchanged. Full TASK-225 remains pending while
any required local obligation or current-invocation self check is unresolved.

## join-141 acquisition result

`artifacts/TASK-225/join-141/run-01` completed the one declared invocation in
910370 ms. All 52 source tests and all four original browser journeys (145
provider assertions) passed. The provider parent exited zero and all eight owned
service PIDs/directories were absent after cleanup. The same-run AC2 reader passed
1285 assertions, but no candidate successor was consumed.

The whole AC3 reader failed at `AC3/coop/p1/first-move-full-raw`: the human unit
array identities changed from 635/640 to 1247/1248. Subsequent legacy observations
again changed them before the callback boundary. The raw callback before/after
capture and named receipts are present; neither their presence nor the original
projected provider checks establishes whole AC3 coverage. Both next-game traces
contain 20 ordered raw records and three retained/invoked names per participant.

The instrumented helper still calls legacy `OBSERVE` between the passive
snapshots. That observer reads `Player.isLost`, whose `updateUnits()` replaces the
units array. Do not waive these identity checks or retry the unchanged provider.
The next producer repair must supply the original projected assertion fields
from passive storage, preserving every assertion and input while avoiding the
mutating getter reads. First add an integrated production-getter regression,
then acquire one changed four-journey run and attempt real cumulative consumption.
Read `join-141/acquisition-diagnosis.json` and `raw-boundary-differences.json`.

TASK-225 remains pending; join-139 is still the current selection, 62 prior
obligations and eight self owners remain, and full-invocation steps stay gated.
No gameplay/input repair, full-pass, new current credit, or external blocker is
claimed. All tested source bytes and the original failing evidence are retained.

## join-142 changed acquisition result

The four later `localGameplay` observations now use passive own-storage and
reviewed private getters, preserving all original input and assertion sites.
The production Player fixture verifies projected values and reference/descriptor
stability; the legacy mutation counterexample remains. All 52 source tests pass.

`artifacts/TASK-225/join-142/run-01` completes in 999434 ms with provider exit 0,
consumer/runner exit 1, four cleanups and all 145 provider checkpoints passing.
Same-run AC2 again passes 1285 checks. AC3 still fails at
`AC3/coop/p1/first-move-full-raw`: human unit arrays 635/640 become 1247/1248.
Competitive exhibits the corresponding replacement. The projection repair does
remove the subsequent observation mutation: post-move to callbacks-before and
callbacks-before to callbacks-after are now exactly unchanged for both players
in both modes. Co-op p2 additionally changes `next.unactive` true to false during
the first-move interval. No raw comparison is waived and no successor is consumed.

The previous assertion that legacy OBSERVE alone caused the first-move mismatch
was incomplete. Static inspection finds another path: `sendInstructions` calls
`AiRuntime.recordHumanCommand`, then `vectoriseGrid`, global income channels,
`playerIncome`, `Player.income`, `armySalary`, and `updateUnits`. This is a
candidate mechanism, not an observed runtime call stack. Before another provider,
reproduce this production command/vectorization effect with independent reference
assertions and characterize the peer control transition, preserving callback
semantics and natural timing. Do not remove runtime training or normalize array
identities speculatively. Do not repeat the unchanged four journeys.

Current selection remains join-139, with 62 prior obligations and eight self
owners; all full-audit prerequisites remain. Read join-142/acquisition-diagnosis.json,
raw-boundary-differences.json and handoff-audit.json. Historical failures and all
unrelated source/index bytes remain preserved. No external blocker is established.

## join-143 command boundary repair

The focused production-source regression `ops/test_terminal_command_boundary.js`
uses the existing declared mechanics fixture and the actual Events command,
unit movement, command recording and vectorization implementations. The retained
pre-change run `join-143/reproduction-03.log` fails both modes' clean-array
identity assertions. Its recorded stacks prove the command → recording → vector
→ income → salary → `updateUnits` path in this source fixture. Contents, gold,
legal movement, undo count and one recorded command remain independently checked.
This is source-tier attribution, not a recovered stack from the earlier browser.

`Player.updateUnits` now returns early for an already clean registry. Its original
killed-unit removal and adjacent duplicate cleanup remain intact; a separate
regression checks those semantics and salary. Command recording remains enabled.

The production pause setter invokes `gameLogicButtons.deactivate`, which sets
`unactive` and clears it through a native 1000 ms timeout. The source test observes
this actual timer without freezing or replacing it. The integrated provider now
waits for both participants' existing cooldowns before the first-move boundary,
and saves before/after readiness receipts. The reader requires those receipts;
missing and still-pending controls are rejected. Raw movement/callback identity,
control, timer, ownership, gold and board comparisons remain unchanged.

One changed acquisition is declared in `join-143/run-01/verification-plan.json`.
The production repair changes source freshness: older evidence must retain its
staleness, even if that increases required prior-proof counts. Do not restore a
fixed count by waiving hashes. Full TASK-225 remains prerequisite-gated.

The changed acquisition completed all four original journeys and 145 provider
checkpoints (provider OS exit 0). All 58 source tests pass. Both modes' raw
movement and callback readers pass 110 checks each, including the formerly
failing registry identities and unchanged peer controls. The actual co-op peer
readiness receipt records `unactive: true` before the wait and `false` after it.

Cumulative consumption stops earlier, at
`terminal/implementation/client/player.js`: the immutable outcome reviewer pins
`85123d8a…`, whereas this deliberately repaired source hashes to `09095f1b…`.
Consumer OS exit is 1; neither whole AC2 nor whole AC3 has been rebound/consumed.
Do not overwrite that historical implementation review or waive the new hash.
The next integrated work needs a separately reviewed current implementation
binding, retaining the historical pin and proving this exact cleanup delta,
before another acquisition is justified. Account for source staleness in older
selections and remove assumptions that the old 62/61 counts necessarily survive
a runtime repair. Do not replay these four journeys unchanged.

`join-143/run-01/verification-budget.json` records 952936 ms, scopePass false and
cleanup true. Source/provider/consumer exits are 0/0/1. The outer tool session
ended with observed exit 143 and no supervisor runner-exit receipt; do not infer
or fabricate a runner OS exit from its printed summary. All owned service PIDs
and directories are independently absent. No external cause is established.
The join-139 selection pointer is preserved, but its old freshness/count claims
must not be presented as current after this production change. TASK-225 stays
pending; full audit steps remain gated and no successor has been selected.
