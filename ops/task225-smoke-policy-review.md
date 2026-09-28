# Smoke isolation implementation review

This TASK-225 review follows smoke-155's missing implementation review. It
reviews the current code, without re-running that archive inspector or claiming
that old server evidence became current. `server/smokeIsolation.js` matches the
TASK-223/green-05 source identity; `server/index.js` does not. The measured
review and exact source hashes are under `artifacts/TASK-225/smoke-policy-156`.
No whole criterion is consumed. The active selection remains
`ac6-154/run-03/reviewed-crosswalk.json` and `evidence_terminal_ac6_gate.js`.

## TASK-223/AC1 source paths

`server/index.js` loads the policy once from the operator environment.
`hashPassword` derives the identity from the supplied credential. Both
`startGameOrConnect` and `nextTurn` call `bind` with that identity before
matchmaking; neither passes a request namespace or bypass flag to the policy.
This is credential possession authentication, not a claim of external identity
verification. `createPolicy` validates the configured identity, run and expiry,
copies and freezes entries, and returns null only for unlisted identities.
Expired listed identities are rejected instead of falling back to ordinary.

`bind` installs a nonwritable, nonconfigurable socket namespace. An attempted
switch between namespaces fails. Two credentials in the same authorized run
can share that namespace; the contract makes the namespace immutable, not the
credential itself. Binding a smoke identity schedules a real expiry disconnect
and clears the timer on disconnect. Each later binding rechecks authorization.
Revocation rejects subsequent authorization for every member of that run.

`getOrCreateGame` independently reauthorizes its identity/run pair, checks an
existing assigned game with `assertGame`, filters candidate matchmaking by
`smokeRun`, and stamps new games and account assignments with the authorized
run. Ordinary identities use null (including legacy absent-field Mongo
matching). `handleNextTurn` reauthorizes and checks the assigned game before
applying the submitted turn. It derives the player slot from persisted identity
membership. The unused `getPlayerIndexFromDB` declaration has no caller.

These reviewed source paths support AC1's implementation intent, but this
source review alone does not supply fresh real network proof or the required
whole-row cumulative consumer transition. No AC1 disposition changes.

## Cleanup scope and missing acquisition

`cleanupSmokeRun` derives the run from the authenticated identity, rejects
ordinary identities, revokes the run, and serializes cleanup with matchmaking.
It enumerates only that run's games and drains each game's operation queue.
It deletes turns by those owned game IDs, users by run/game and then run, and
games by run/game. It releases assignments and rooms only for matching peers.
There is no database-drop operation in this handler. This code review cannot
prove actual database preservation or absence of secrets in saved streams.

The next changed capture must retain all owned and sentinel game, user and turn
collections before and after cleanup, including orphan run-owned accounts;
explicitly map hashed identities to allowlist runs/expiries without storing
credentials; retain socket IDs, sent/received times, sanitized forged values,
and the expired-turn before/after documents. Review all resulting streams for
secrets using the actual generated credential set before accepting evidence.
Bind these observations to real handler execution and independent expected
values, along with original provider and parent exits and cleanup records.
Resolve the previously identified artifact-location conflict before launching.
No copied archive, source stand-in, or missing receipt can substitute.

## Executable checks

Run `node20 ops/test_smoke_policy_review.js <fresh-output-directory>`.
It executes the actual policy module with labeled EventEmitter socket stand-ins
and independent assertions for configuration, namespace immutability, ordinary
and cross-run behavior, lookup, expiry and revocation. It uses the real clock
for expiry, clears all owned timers, and writes checkpoints and tested hashes.
It launches no network service and makes no network or browser claim.

This review does not close the known missing trace/cleanup evidence. Full
TASK-225 steps 3/4/5/7 remain gated and status must remain pending until every
required local proof and all eight invocation self checks close.
