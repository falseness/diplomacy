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
a current executable service deployment/rollback adapter,
and final release/rollback manifest validation. `guarded-plan.json` describes
archive guards and required future steps. `rehearse_release_layout.py` now copies
regular client and retained web files from the bound archives into a private
temporary directory, performs six filesystem switch/rollback actions, and checks
candidate visibility, retained/restored bytes, override ownership and cleanup.
`layout-dry-run.log` and `layout-rehearsal.json` prove this isolated filesystem
rehearsal only. They do not satisfy the final `dry-run.log` contract: no systemd
restart, runtime execution, HTTPS health check or real-host transition is tested.
Archive web links are rejected rather than followed. Negative controls cover
existing backup/override paths and changed ownership before rollback. No operation
here activates a live service or writes a ready manifest. The historical TASK-065
switch script is never invoked.

Run the new isolated comparison from the client repository:

```sh
NODE_PATH=/opt/diplomacy/node_modules python3 ops/test_release_operations.py artifacts/TASK-226/<fresh-boundary-directory>
python3 ops/test_rehearse_release_layout.py
```

The separate Python entry point creates identical temporary candidate/runtime and
prior-installation fixtures and invokes the JS parent/worker with one deadline.
It does not repeat the older component suites. The parent uses TASK-224's existing
release supervisor, and checks missing-map, complete-map, changed receipt,
changed observation, missing smoke validator, expired identities, and changed
archive and rehearsal receipt outcomes. It independently checks archive members/bytes, guarded plan
bindings, smoke inputs, actual worker/supervisor exits, unchanged input/sentinel
bytes, and cleanup. TASK-223's real source isolation policy validates fixture
identities, but no public authentication, browser, or network claim is made.

Output includes per-scenario helper stdout/stderr and actual exits, source archive,
runtime/dependency archive, retained rollback archive, stage proofs, parent exact
expected/observed checkpoints and cleanup receipts. Negative scenarios are passing
controls only when the parent observes their exact expected failure. The complete
arm is still diagnostic and cannot authorize production staging. All output must
remain local and uncommitted.

### Offline producer/constructor comparison

`compare_release_receipts.js SAVED_DIRECTORY FRESH_OUTPUT_DIRECTORY SERVER_REPO
ABSOLUTE_DEADLINE_MS` is an explicit diagnostic, run with `/usr/local/bin/node20`.
It copies saved helper receipts and archives without executing their contents,
checks archive claims against their bytes, and invokes the actual final constructor
with direct receipts and an explicit normalized variant under one deadline.
The normalized variant derives package/rollback proof references and a layout
binding. It does not invent issuer provenance, service execution or health checks.
Independent contract probes expose failures hidden behind the constructor's first
rejection. Both variants must reject; diagnostic exit zero never grants readiness.

The saved inputs must include `candidate/paired-package.json`,
`candidate/candidate-manifest.json`, `candidate/candidate.tar.gz`,
`candidate/runtime-dependencies.tar.gz`, `rollback/retained-installation.json`,
`rollback/prior-installation.tar.gz`, `prepared-smoke-inputs.json`,
`layout-rehearsal.json` and `layout-dry-run.log`. Outputs contain frozen hashes,
source closure, the exact command/runtime, individual contract results and
`fullTaskPass:false`. A clearly marked synthetic prerequisite is confined to
this diagnostic directory. No production runner imports this script.

This comparison does not complete the production acquisition, issuer, executable
service rehearsal, operations wiring or authenticated final consumer. Those
remain required together with finalized current TASK-225 proof before TASK-226
can pass. The production fail-closed guards remain in force.
