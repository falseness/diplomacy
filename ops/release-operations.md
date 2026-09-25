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

The intermediate operations alone are **not release readiness**. The connected
production gate described below remains fail-closed without authenticated inputs. Its TASK-225 prerequisite must pass, and it
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

This historical comparison did not complete production integration. The connected
implementation below supersedes that missing implementation, while finalized
current TASK-225 proof and trusted production inputs still gate real readiness. The production fail-closed guards remain in force.

### Connected authenticated preparation

`release_production.js` now supplies the real operation factory to the server
worker. `release_service_adapter.js` extracts the hash-bound candidate/runtime
and retained rollback archives into an owned temporary tree. Each archived Node
runtime starts its archived server with the existing isolated HTTPS/MongoDB
launcher. A separate health process verifies TLS, Engine.IO, four password
admissions, persisted allowlist namespaces, revocation and scoped cleanup. These
are provisioning checks, not evidence of browser gameplay milestones. Both
service wrappers must actually exit zero, and all owned processes must stop.

`release_authenticated.js` normalizes proofs from archive bytes, invokes the
existing constructor and signs the final proof closure with Ed25519. The shared
final consumer verifies the separately supplied public key, invocation ID,
canonical output directory, prerequisite bytes, host pins, expiry, archive hashes,
actual health/provisioning observations and cleanup. Worker and supervisor use
this consumer; a schema, boolean or copied signed receipt alone cannot pass.
Final documents remain provisional (`releaseReady:false`); activation is TASK-227.

Production runs require `RELEASE_TRUSTED_CONFIG` pointing to an operator-owned
0600 JSON file. Required fields are `scope:"production"`, `host`, `machineId`,
`publicKey` (PEM), `privateKeyFile`, `credentialsFile`, `allowlistFile`, `client`,
`server`, `sources`, `runtime`, `dependencies`, `runtimeReceipt`, `rollbackRoots`
(client/server/runtime/web/config), `observationFile`, `observationSha256`, and
`service`. Paths are host-local. The host and machine ID must match this machine;
run acquisition/retention there. Production builds the existing systemd observer
command itself. It does not accept a caller-selected observer command.
`observationFile` must be the current pinned observation of that service.
`RELEASE_PREREQUISITE_DIR` must name a finalized current TASK-225 evidence tree.
Missing configuration reports field names, never credential values.

Private credential JSON is four `{password,run}` entries: the first pair for
competitive smoke, the second for co-op. Private allowlist JSON follows
`server/smoke-isolation.md`, with hashed IDs, matching runs and expiry beyond the
invocation deadline. Private key, credential and allowlist files must also be
operator-owned 0600 regular files. This contract assumes the operator and host
are trusted; signatures authenticate observed receipts, not an untrusted host.

The server wiring changes are carried in `release-connected-server.patch`, scoped
only to the two release helpers in the sibling repository. Apply with
`git -C /root/diplomacy_server apply /root/diplomacy/ops/release-connected-server.patch`
when those changes are not already present. This keeps the task's client and
server integration in one reviewable client commit without including unrelated
staged server work.

Run only the separate diagnostic harness for generated local trust:

```
NODE_PATH=/opt/diplomacy/node_modules python3 ops/test_connected_release.py artifacts/TASK-226/<fresh-directory>
```

It copies current source bytes into private fixture repositories, uses the real
Node/dependency bytes and an observed owned process for rollback provenance,
and runs the connected factory, constructor and final consumer. The prerequisite
and host service attribution remain explicit diagnostic fixtures. Forged
signatures and copied invocation IDs must fail in both consumers. One cumulative
ten-minute deadline includes setup, services, negative controls, audit and
cleanup. `diagnosticPass` never sets `fullTaskPass` or `releaseReady`. There is no
production CLI or environment option to select its synthetic prerequisite.

### Offline production loader boundary

Run `/usr/local/bin/node20 ops/test_release_production_config.js artifacts/TASK-226/<fresh-directory>`
from the client repository as root (the ownership controls change only disposable
fixture ownership). This two-minute diagnostic compares the direct real factories
with `loadProductionConfig` and `release_production.prepare`, observing arguments
while delegating to the actual factories. It verifies pinned observer construction,
helper-path removal, host roots, single-field rejections and real private-file
mode, symlink and ownership rejection. Child-process execution is prohibited and
returned operations are never invoked. Generated production-scope configuration
is loader fixture data only; no prerequisite gate or readiness receipt is produced.
A pass retires this experiment. Full release verification still requires finalized
current TASK-225 proof and authentic operator configuration.
