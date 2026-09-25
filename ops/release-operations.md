# Release helper boundary

`release_operations.js` constructs four intermediate operations for the server's
existing `continuePreparation` orchestrator. It checks the required collector and
smoke adapter configuration before running an operation. `release_helper_bridge.py`
uses the existing source/runtime packaging and rollback retention implementations;
JavaScript's absolute millisecond deadline is converted to Python Unix seconds.
Python commands have the remaining cumulative timeout. Run the factory under the
existing process supervisor so descendants are accounted for and cleaned up.

Every stage binds the preceding receipt and archive bytes. Archive guards read the
archives back without extraction. The final stage projects only public identity
hashes and run/expiry metadata into its intermediate smoke input; issuer secrets
are excluded. The caller owns authentication of both the observation collector and
smoke issuer. Never provide untrusted command arguments as `observerArgv`.

This is **not release readiness**. The production gate remains fail-closed and is
not wired to these operations yet. Its TASK-225 prerequisite must pass, and it
still needs authenticated current-host acquisition, real identity issuance,
a current executable deployment/rollback adapter with a local switch dry-run,
and final release/rollback manifest validation. `guarded-plan.json` describes
archive guards and required future steps; `archive-guard.log` is not `dry-run.log`
and proves no service switch. No operation here activates, restores, or writes a
ready manifest. The historical TASK-065 switch script is never invoked.

Run the new isolated comparison from the client repository:

```sh
NODE_PATH=/opt/diplomacy/node_modules python3 ops/test_release_operations.py artifacts/TASK-226/<fresh-boundary-directory>
```

The separate Python entry point creates identical temporary candidate/runtime and
prior-installation fixtures and invokes the JS parent/worker with one deadline.
It does not repeat the older component suites. The parent uses TASK-224's existing
release supervisor, and checks missing-map, complete-map, changed receipt,
changed observation, missing smoke validator, expired identities, and changed
archive outcomes. It independently checks archive members/bytes, guarded plan
bindings, smoke inputs, actual worker/supervisor exits, unchanged input/sentinel
bytes, and cleanup. TASK-223's real source isolation policy validates fixture
identities, but no public authentication, browser, or network claim is made.

Output includes per-scenario helper stdout/stderr and actual exits, source archive,
runtime/dependency archive, retained rollback archive, stage proofs, parent exact
expected/observed checkpoints and cleanup receipts. Negative scenarios are passing
controls only when the parent observes their exact expected failure. The complete
arm is still diagnostic and cannot authorize production staging. All output must
remain local and uncommitted.
