# TASK-946: natural paused authority reachability

Decision: **DESIGN CONFLICT — pending; certified=0 unresolved=36**. No untried legal event order was found that satisfies the unchanged warm-context criterion. This is a source argument for normal supported execution with fixed human ownership, not a new live coverage result. It does not establish a product defect. Cold-origin proposal remains **NOT ADOPTED**.

Reviewed server revision `09e69df2a87542340e1fd439d4dc4acfc745ab4c`, client runtime revision `f3fe3fa8c5890fdfdc1c1203f7af913f9669955c`. Source references below are relative to `/root/diplomacy_server`. Raw numbered source, historical trace extracts and hash checks are saved under `/root/diplomacy/artifacts/TASK-946/reachability/`. The required evidence copy of this document is `artifacts/TASK-946/reachability-matrix.md`.

## Predicate and ordering

Required conjunction: full `globalPause.status === 'paused'`; authenticated unchanged human ownership; the SAME current durable turn identity before pause and after resume; a naturally initialized authority (`ok === true`); `ended === false`; safe integer `lastSeq >= 0`; requested `seq === lastSeq + 1`; immutable paused authority/durable state; same legal mutation succeeds after unanimous resume; matched barrier-disabled live control exposes admission. See `tests/helpers/undoCoverageCases/demon-ranged-kill-coop.js:96-125`. An old ended context, missing context, or fault-initialized context fails this conjunction.

`server/index.js:283-293` serializes game operations through a promise chain. Opening enters it at 1415; submissions at 1474; actions through `server/gameActions.js:563`; pause votes through `server/pauseVoting.js:77` and its awaited boundary callback at 61. Boundary persistence and broadcasts finish inside that operation (`index.js:137-159`). Commit advances the durable cursor (878-881), settles the barrier (886-907), disposes the submitted context (1499), and awaits broadcast (1501) before the next queued probe can execute. Thus the moment inside commit after settle but before disposal is not a legal queued action observation. Timer expiry also enters this queue (113), checks the barrier (1539), and disposes before broadcast (1553-1554).

At boundary, `pauseBarrier.js:24-30` captures every eligible human head in every component, keyed by round/component/cursor/player. `allows` (12-16) admits only captured heads while pausePending, and none while paused. `settle` (17-22) intersects that frozen cohort with current heads: full pause requires no surviving cohort identity. Committing changes the durable cursor, so retaining an old identity cannot fix this. New heads cannot join the cohort.

## Production context creation inventory

Search of production `server/` finds exactly three `gameActions.turnStarted` calls, all in index.js. The sole authority seat insertion is `gameActions.js:243`.

| Path | Creation and guard | Result at full pause | Existing witness |
| --- | --- | --- | --- |
| Normal game open, reopen, reconnect, initial start | index.js:1415-1441, only if player is in whoNewToPlay; getCurrentParalleTurnInfo:750-774 filters via allows at 765 | No call to turnStarted. Waiting branch emits a board, not authority. Reconnecting an active cohort head is possible only before full pause. | T1 records 1-2: pause before activation then ordinary seat-2 open yields NO_CONTEXT. |
| Hidden-info broadcast, including per-socket autoscout views | index.js:1609-1618; callback passed only when `!waiting`; activePlayers comes from filtered whoNewToPlay | All human recipients wait. No callback creates a context; waiting disposal at 1621. | T1/T2 boundary and settle records; no separate fog-on live trace is claimed. Fog generalization follows the explicit callback guard. |
| Plain broadcast and hidden-info fallback when no seatView | index.js:1619-1627; creation is the `else if` after waiting disposal | All recipients take disposal, never fallback creation. | T2 context-trace.log: seat 2 created, cohort captured, committed, then disposed. |
| Reuse/rebase of existing same-round authority | gameActions.js:183-210; reachable only through one of the three calls above | Cannot bypass their active guard. `existing.ended` reuse also violates ended=false. | T2 records 1-3: valid initialized authority persists in pausePending, then disappears. |
| New view and truth VMs | gameActions.js:211,223; seats.set at 243 | Both created only within guarded turnStarted. Truth is not a separate admissible seat. | T1 cold opening and T2 activation/commit. |
| Rebase VMs | gameActions.js:265,306 (view and truth); called at 206-208 | Replace an existing seat only through guarded turnStarted; no independent admission path. | Same guarded-source argument; no live rebase-at-full-pause witness exists. |
| Incoming action / state inspection | gameActions.js:490,527-545 | Reads seats; does not create them. Missing seat or disallowed head returns NOT_YOUR_TURN at 538 before sequence application. | T3 actual cold paused request and same-payload resumed success. |

Other production `createGameContext` sites are not seat authority: `server/orderedReplay.js:60` (index.js:1150,1389 callers), `server/statusBuilder.js:58`, `server/filteredEmits.js:116`, `server/rulesWorkers.js:68`, and the factory `server/gameContext.js:186`. They return replay/status/filter/worker VMs and cannot insert into the closure-local gameActions seats map. `asyncPlayerClock.js:56` uses a different seats map containing clock entries, not action contexts. Test fixtures and preloads are not production admission paths.

## Topology and event-order matrix

All rows apply to fog 0/1 and autoscout off/on; these settings affect board/view preparation after admission, not cohort membership or allows. All six sequences encounter the same lifecycle requirement; committed-turn fencing remains a separate obligation.

| Human count | Component arrangements covered by source quantification | Initialized head before boundary | Waiting/non-cohort head exposed after boundary | Full-pause outcome |
| --- | --- | --- | --- | --- |
| 2 | One sequential component or up to two independent human heads | Every eligible current head is captured; while any survives, pausePending | Never added to frozen cohort; no natural initialization | Old heads commit/dispose; new heads have no authority |
| 3 | One sequential component, mixed 2+1, or up to three heads | Same universal iteration over components | Same allows rejection for every newly exposed identity | Same exclusion |
| 4 | One sequential component, mixed 3+1/2+2/2+1+1, or up to four heads | Same universal iteration over components | Same allows rejection for every newly exposed identity | Same exclusion |

These partitions describe human scheduling relationships, not invented live fixtures. Source loops quantify over all actual components, including automated components; the argument does not require that every listed partition is generated by a particular board. Actual live witnesses are two-human only. No new 3/4-human run or coverage is claimed.

Opening before the boundary initializes an eligible head, which is then captured. Opening after the boundary can initialize only an already captured head during pausePending. An action `end` without durable commit leaves the head in the cohort and ended=true; it cannot reach the conjunction. After commit that identity is stale. A head in another independent component prevents full pause while pending; sequential heads first exposed during draining are blocked. An empty initial cohort reaches full pause immediately, but its broadcast gives every human waiting status and disposes any stale context. A resume broadcast may initialize a legal head, but status is then running. Another pause captures that head anew. Disconnect/reconnect does not remove a durable cohort member. Timeout commits obey the same queue/barrier. Kicks, ownership changes, fault preparation, restart coverage and altered pause semantics are excluded by scope.

Therefore, at a completed queued full-pause boundary every natural current human authority is absent: an old eligible head either still prevents full pause, or has committed and lost both its identity and context; a new head is denied initialization. This contradicts required `authority.ok=true && ended=false && valid next sequence` for the SAME current identity. The argument assumes successful normal operations, not injected partial database/broadcast failure or fabricated state. No demonstrated failure path authorizes a different fixture.

## Historical evidence and limits

T1: `artifacts/TASK-946/context-lifecycle/retry-before-active/lifecycle.json`, records 0-2: initial NO_CONTEXT; pausePending cohort `["0:1:0:1"]`; full pause after seat-1 commit and normal seat-2 open still NO_CONTEXT, with durable seat-2 identity.

T2: `artifacts/TASK-946/context-lifecycle/retry-after-active/lifecycle.json`, records 1-3: seat-2 authority ok=true, lastSeq=0, ended=false while running; same warm authority with pausePending cohort `["0:1:1:2"]`; then full pause, empty cohort, NO_CONTEXT. Its `context-trace.log` shows create/boundary/commit/settle/dispose. The earlier non-retry after-active run failed with TypeError and is not used as passing evidence. Lifecycle inputs are historical; their receipts are not recertified for current inputs.

T3: `artifacts/TASK-946/cold-origin/{real,bypass}/cold-origin.json`, original tests.log files and `comparison.log`: actual natural cold refusal, immutable state, identical resumed payload success, matched bypass creation/acceptance. The existing comparison records 1839 matching inputs. This is diagnostic evidence only.

## Cold-origin proposal versus unchanged obligations

| Obligation | What the existing proposal supplies | Remaining conflict / work |
| --- | --- | --- |
| Full paused boundary, authenticated durable identity | Natural cold request at real full pause | Supports this part only; does not establish warm authority |
| Natural authority.ok=true, ended=false, valid paused lastSeq and next sequence | NO_CONTEXT; legality/sequence established after resume | FAIL: no paused authority counter exists; resumed counter cannot substitute |
| Immutable paused state/counters | Real cold before/after durable and missing-authority equality | State evidence exists; warm counter equality is impossible without a counter |
| Same-identity legal resumed mutation | Identical payload accepted after unanimous resume | Diagnostic satisfies this component for its fixture, not 36 scenarios |
| Otherwise identical barrier-disabled live sensitivity | Matched cold-origin bypass creates context and accepts | Detects combined initialization/admission gate, not a natural warm admission comparison |
| Old-turn undo fencing | Historical independent STALE_TURN refusal | Must remain separate; not pause proof |
| Adapter/family agree and reject stale/missing/forged positives | Current validator deliberately rejects missing natural authority | Proposal would require explicit criterion/validator redesign; no waiver adopted |
| 36 exact scenarios, both autoscout variants, six sequences | One diagnostic fixture, no new certifications | All 36 remain unresolved; no dispatcher until valid pilot under an agreed contract |
| Forward/inverse state, economy, views, renders, clocks, follow-up and exactly-once commit | Proposal says retain original obligations | No fresh full positive proof; historical false greens do not satisfy the strengthened contract |
| Exact identities, timing, cleanup, originals | Cold arms retain original matching input identities and bounded cleanup receipts | Metadata cannot convert diagnostics into positive coverage |

Next decision is an explicit proof-design resolution: authorize a revised cold-origin lifecycle contract, or identify a concrete legal counterexample to this source exclusion under the unchanged contract. Neither is silently selected here. No unchanged diagnostic rerun, bypass preparation, lane re-import, full collection or TASK-947 work follows this investigation.
