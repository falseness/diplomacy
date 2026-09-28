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

## Joined acquisition entry point

`python3 ops/run_terminal_ac2_integration.py <fresh-directory>` declares one
30-minute estimate, runs the source contracts, all four original terminal
journeys with the preload, then the independent reader and actual cumulative
consumer. It retains actual OS exits and full output; failure stops consumption.
The outer deadline covers the entire sequence and leaves cleanup time.

`review_terminal_ac2.js` reuses the frozen initial/commit/outcome derivation,
then `review_terminal_ac2_join.js` joins fixture hashes, actual assignment slots,
UUID game identity (distinct from Mongo `_id`), ordered passive page/database
records, original packet bytes and dispatch, reconnect sessions, and winner UI.
Both participants and all boundaries are mandatory. Same-document replay compares
raw storage; reconnect compares independently checked board content and commit
identity. The supported four fixtures end with no living towns; any expansion
fails closed until its town/production contract is reviewed. Source synthetic
positives never grant coverage.

`evidence_terminal_ac2_gate.js` consumes the complete AC2 row through the actual
inventory consumer using a separate provider key. AC1, AC3, the historical
sequence rows and self owners retain their prior dispositions. A fresh
`reviewed-crosswalk.json` is a candidate only until the comparison succeeds.

The first real acquisition found two capture defects hidden by the earlier
source fixtures: StaticNature has an own `hp: undefined`, and real unit movement
uses `InterationWithUnit.#moves` while DemonPlayer gold is a constant getter.
The adapter distinguishes stored undefined from absence and pins those reviewed
getters. It rejects unreviewed moves overrides (including the catapult override,
which these four terminal fixtures do not use), rather than treating base private
storage as an overridden value. No gameplay code or old assertions are changed.
Failed runs and their exact tested source copies remain under join-138.

## Current acquisition stop (join-138)

No whole AC2 row has been consumed. `run-01` failed on stored undefined nature
HP; `run-02` passed the complete original four-journey provider but the independent
reader rejected `moves required` (demon gold was also absent). `run-03` tested
the corrected private moves/gold capture: all 27 source tests passed and victory
and draw completed, but the third journey failed at the existing prepared-state
reconnect with `p1: input "reconnect slot" had no observed effect (!menu.visible)`.
Its fourth journey never ran. Three owned service cleanup receipts pass.

A cheap read of the completed current victory trace then failed at
`terminal-victory/capture-1/visible`: `raw.ui.menu` is `{absent:true}`. Both shipped
`Menu.visible` (`menu/menu.js`) and `NextTurnPauseInterface.visible`
(`interface/nextTurnPause.js`) are private getters, unlike the earlier source
fixture's own boolean properties. Retain this strict rejection; do not replace
absence with false, drop the assertion, or grant partial criterion credit.

Next acquisition must first model those exact production UI getter brands in the
source fixture and add a reviewed passive route. Separately capture the prepared
reconnect failure's actual page/input/connection state **before** withServices
teardown: current failure screenshots are taken after service cleanup and show a
connection error, so they cannot establish its initiating cause. The existing
observer wrapper delegates that nonterminal reconnect to the original helper;
no controlled comparison attributes the failure to capture changes, gameplay,
or an external blocker. Do not retry the unchanged full provider or alter input
semantics speculatively. Once both input/capture prerequisites are demonstrated,
use one fresh <=45-minute four-journey/reader/consumer invocation (55-minute stop,
cleanup before 60). Preserve all old assertions, genuine packet dispatch, and
both failed runs. Current selection remains review-114/evidence_competitive_gate;
review-127 ancestry remains frozen. The new AC2 selection/gate is a candidate,
not a consumed successor; full TASK-225 remains prerequisite-gated.
