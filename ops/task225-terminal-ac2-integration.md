# Whole AC2 acquisition contract

The provider integration is `terminal_ac2_provider.js`. It loads through an
explicit Node preload, before the existing provider imports its reconnect
function. Its server helper SHA-256 pin fixes the positions of the two replay
reads. All four journeys, real packet dispatch, legal inputs, natural clocks,
and existing AC3 checks remain in the original provider. Only the two legacy
replay observations are replaced with passive captures of **both** participants.
Reconnect capture surrounds the existing shipped-menu reconnect function and
waits for the authenticated terminal page before reading it. Each document gets
a fresh observer identity namespace. Persistence uses MongoDB `findOne`, never
an update. Records go through the existing trace redactor.

This integration is not yet authorized for a provider refresh: the complete
independent reader and cumulative adapter below are unfinished. Source wiring
tests are labeled as such and grant no browser/network/criterion credit.

| AC2 clause | Required raw fields | Producer and boundary | Independent check | Consumer binding |
| --- | --- | --- | --- | --- |
| Final ownership/alive registries | `raw.state.players`, grid ownership/occupants, extended town/external storage | Both participants at replay-before and terminal reconnect-before/after; declared fixture and persisted terminal board | Derive terminal board from initial fixture and legal commits, then run existing raw semantic interpreter; reject dead-player resurrection and inconsistent registry/grid aliases | Hash-bound whole AC2 review; absent until reader completes |
| Winner UI | Original `terminal-ui` result/text plus passive result | Original four journeys' rendered winner captures; page record at corresponding terminal boundary | Derive victory/defeat/draw from the fixture, require both recipients' rendered text | Same complete review; preserve AC1 historical row |
| Disabled actions | waiting, next/undo `canClick`, timer `isTick` | Each terminal page capture | Require waiting and stopped controls/timer, independently of `unactive` | Same complete review |
| No resumed turn/income/resurrection after late update | Both participants' complete passive before/after state, round/gold/registries, raw commit | Original captured packet receipt, original replay dispatch trace, replay-before/after page and database records | Join exact packet bytes, game, recipient, sequence and same-page session; reject changed raw state even with rebound hashes | Complete row transition through actual cumulative consumer, not a report-only addition |
| No resumed turn/income/resurrection after reconnect | Page before/after, DB before/after, game and recipient | Existing terminal reconnect for both participants in each of four journeys | Compare semantic board content and terminal controls across new page sessions; never compare observer IDs across navigation | Same complete review |
| Fixture/recipient policy | fixture hash, authored initial board, co-op human/demon slots, admission assignment, page game ID and recipient slot | `declared-fixture.json`, original `api-join`/`admission-assignments`, capture records | Validate policy from hashed producer input and real assignment, not a caller-supplied mode or recipient | Reader must reject wrong-policy, wrong-recipient, omitted participant/boundary |
| Execution validity | provider/reader source hashes, real exits, budget, cleanup and every original case | Existing lifecycle reports plus new preload identity and detached parent OS receipt | Reject incomplete coverage, stale sources, omitted preload identity, missing OS receipt or cleanup | Preserve review-127 ancestry, review-114 current selection and eight self owners |

## Remaining acquisition stop

The producer is wired, but a whole AC2 reader must still join these exact fields
and produce independent expected/observed assertions. In particular it must bind
the passive `fixtureSha256`, `recipientSlot`, `gameId`, `session` and `sequence`
to the original admission, dispatch, persisted board and reconnect observations.
The capture marker or provider PASS is not that validation. The existing
`review_terminal_semantics.js` accepts caller policy; it cannot grant whole AC2.
The current cumulative terminal adapter accepts AC1 only. Do not modify frozen
review-127 tools to make it accept incomplete AC2.

Before the single affected provider invocation, finish the reader/adapter and
its rehashed wrong-policy, wrong-recipient, missing participant/boundary,
extra-income, resumed-turn and resurrected-player controls. The synthetic
positive proves the reader contract only. Then predeclare at most 45 minutes
for all four existing journeys, reader, identical-proof consumer comparison,
hash audit and cleanup; stop at 55 minutes and finish cleanup before 60.

The eventual provider command adds `TERMINAL_AC2_CAPTURE=1` and
`NODE_OPTIONS="--require /root/diplomacy/ops/terminal_ac2_provider.js"` to the
existing terminal-flow runner environment. This document is not an execution
receipt. Full TASK-225 steps 3/4/5/7 remain gated; no full pass or current credit
is claimed.
