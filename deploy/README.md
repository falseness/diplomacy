# Verified deployment entrypoint

Run as `bakharevns`: `/home/bakharevns/diplomacy/deploy/deploy.sh`.
Use `--help`, `--dry-run`, or `--server-repo PATH` as needed. The client
root follows the script, regardless of caller working directory. The default
server root is its sibling `diplomacy_server`. Each checkout retains its own
current symbolic branch and configured upstream.

Production defaults for the later activation stage are:

- Client/server repositories under `/home/bakharevns`.
- Releases: `/home/bakharevns/diplomacy_releases`.
- Service: `diplomacy-server.service`; web link: `/var/www/html`; DB: `gameDB`.
- Exclusive host lock: `/home/bakharevns/.diplomacy-deploy.lock`.
- Pinned executable: `/usr/local/bin/node20` (Node 20).

Normal execution continues through immutable packaging, isolated tests, read-only
existing-game baseline, smoke namespace admission, quiesced validated backup,
activation, live gameplay verification, smoke cleanup and final result. Every
stage gates success. A healthy service alone is never complete verification.
Untracked files are preserved; packaging uses committed Git blobs.

Preflight checks tools, at least 1 GiB of free space in both repositories,
pinned Node, the invoking user, noninteractive sudo authorization for the service,
and existing upstream access. It does not provision credentials. SSH requires
existing known-host trust and disables interactive authentication and host-key
updates. Git diagnostics are withheld because they can contain credential URLs.

Normal execution acquires a nonblocking flock before changing Git state. It
checks both checkouts first, fetches each selected upstream, rejects untracked
(including ignored) path collisions against that tree, then runs `git pull
--ff-only --no-rebase --no-autostash . <fetched-sha>` in that current branch.
Pulling the inspected immutable snapshot prevents a remote update between the
collision check and pull from overwriting ignored files. Git auto-stash config
is explicitly disabled. No reset, stash, forced checkout or cleanup is used.
A second fetch/pull failure can leave the first checkout advanced. Reports
contain before/after branch names and full SHAs; errors terminate before activation.
The source repositories must not be concurrently edited by unrelated processes.

Dry-run performs preflight and read-only Git inspection/ls-remote. Optional Git
index refresh locks are disabled. It creates no deployment lock, log, temp file
or checkout update. Remote trees that are not already present cannot be fully
checked without fetching: dry-run explicitly reports that ancestry/collision
validation is deferred to normal execution, and does not promise a deployable
update. Host tools may have their own system audit logging.

If the two tracked runtime files change during pull, the process execs the
updated tracked entrypoint once, inheriting the same flock file descriptor.
Continuation validates roots, lock inode and commit identities, skips pulls,
and continues into orchestration without releasing the lock. The private continuation environment is
an internal handoff, not a public CLI switch.

Run the isolated integration test (no production access):

```sh
TMPDIR=/mnt/storage/tmp-diplomacy DIPLOMACY_CLIENT_ROOT=/root/diplomacy \
NODE_PATH=/opt/diplomacy/node_modules \
python3 -B deploy/test_source.py artifacts/TASK-774
```

The suite creates and removes disposable local Git remotes/checkouts, replaces
only production user/tool/sudo/disk preflight and the lock path, and exercises
real Git, flock and self-exec behavior. It is a standalone Python deployment
suite, outside the game reliability registry; no game rules inputs change.

## Candidate and backup support

After source preparation, call the standalone helper with explicit repository,
output and validated runtime paths (a fresh output directory is mandatory):

```sh
python3 -B deploy/candidate.py --client /path/diplomacy \
  --server /path/diplomacy_server --output /path/releases/unique-candidate \
  --node-dist /usr/local/lib/nodejs/node-v20.20.2-linux-x64
```

This reads immutable Git blobs at the two captured HEADs, records branches,
full revisions and blob/content hashes, excludes local changes and credentials,
and checks both committed rules generators without rewriting them. It includes
client assets, server script closure, and tracked ops/test/deploy helpers.
Node must be exactly 20.20.2. Production dependencies are installed by its npm
from the committed lockfile, loaded to check native dependencies, and included
in the file/symlink manifest. Source and installed files are made read-only;
the archive checksum identifies the candidate. This is filesystem read-only
sealing, not protection from an administrator deliberately modifying it.
`candidate.verify` must pass again before any later activation. Failed candidate
directories remain diagnostic only and cannot be reused as fresh outputs.

Run the committed test suites from the candidate, with the locked root test dependencies installed alongside the server dependencies:

```sh
NODE_PATH=/opt/diplomacy/node_modules TMPDIR=/path/private-test-temp \
  python3 -B deploy/check_candidate.py /path/releases/unique-candidate/candidate \
  /path/releases/unique-candidate/candidate-manifest.json /path/new-evidence \
  --jobs "${TEST_JOBS:-6}"
```

The selected tracked suites cover authenticated lobbies, enforced actions and
client replay, undo/diff, and legacy saved rounds. Their service launcher owns
loopback ports, generated TLS/auth keys and disposable `diplomacy_test_*` databases;
cleanup removes only owned resources. Keys remain in private temporary directories,
never in the candidate/archive. The verification-only `candidate_tls.js` preload
redirects the two legacy dev-certificate reads to that generated pair only in
an explicitly isolated local test process. Candidate hashes are checked before and after.

`backup.js` is called by activation after all service writers are quiescent. Only
a caller that has already quiesced every writer may pass `--writes-quiesced`:

```sh
/path/candidate/runtime/bin/node deploy/backup.js /path/private-backups \
  /path/candidate --writes-quiesced
```

It dumps the full local `gameDB` into a unique directory, checks counts before
and after, parses every BSON document and checks every collection's count and
metadata, then writes a private `validated.json` receipt with hashes and sizes.
Unsupported collection types fail closed. A failed dump gets no receipt. Later
activation must call exported `verifyBackup(path)` and fail if the receipt or
any file is missing/corrupt. Keep writers quiescent throughout; equal counts
cannot prove that updates did not occur. Nothing here restores, wipes, activates,
or removes previous releases/backups. Credentials are not accepted in URI arguments.

Standalone deployment tests (outside the game test registry):

```sh
DIPLOMACY_CLIENT_ROOT=/path/diplomacy python3 -B deploy/test_candidate.py
DIPLOMACY_SERVER_ROOT=/path/diplomacy_server /usr/local/bin/node20 deploy/test_backup.js
```

## Standalone activation and code rollback

`activate.py` is the transaction used by orchestration; its standalone CLI also supports recovery. It targets `diplomacy-server.service`, its one owned
`99-zz-diplomacy-release.conf` drop-in and `/var/www/html`. Run with privileges
for those targets and the existing exclusive host lock. Required arguments:
`activate --candidate PATH --manifest PATH --record NEW_PRIVATE_FILE
--backups PRIVATE_DIRECTORY --health-probe EXECUTABLE
--existing-games-probe EXECUTABLE`. The probes must be trusted, bounded,
read-only executables, requiring no arguments, with nonzero status for failure;
they must inspect the current local service and existing-game compatibility.
Do not supply probes that write games. Caller must exclude other DB writers
and concurrent configuration edits throughout the transaction. Probes,
credentials/configuration and backup tools are host prerequisites, not packaged
secrets. The helpers do not provision them.

Before stopping, activation validates candidate hashes/repository/runtime
identities, records process cwd/executable, unit/effective settings, exact owned
config bytes/ownership/mode and the literal web link, checks initial health/game
compatibility and rejects competing later-sorting drop-ins. The recovery record
is private (0600); it may contain sensitive service settings and must not be
committed or printed. Other unit files are never rewritten. Non-release settings
in the owned file survive activation. The service must use control-group/mixed
kill mode; stop is followed by state/PID/cgroup checks. A fresh TASK-775 full
validated backup must succeed before either target switches. Existing releases
and backups are retained. Config and web use same-directory atomic rename;
the pair cannot switch atomically, so any intermediate failure requires rollback.

Failures, TERM and INT after a stop attempt restore the prior config/link and
restart/verify the prior process, effective configuration, health and game
compatibility. Before-stop errors leave the service alone. Child command groups
are killed/reaped on interruption before rollback proceeds. Further TERM/INT
are ignored during recovery. SIGKILL/power loss cannot run handlers: the private
record supports a later explicit `rollback --record FILE --backups DIRECTORY
--health-probe EXECUTABLE --existing-games-probe EXECUTABLE` under the same lock.
A failed activation always exits nonzero, even after successful recovery. JSON
output retains the original failure stage/reason and a separate rollback result.
No database is ever restored or wiped. A later code rollback preserves new-format
writes and reports existing-game incompatibility explicitly; it cannot promise
that the previous code understands those writes. Incomplete rollback must be
resolved manually using the retained private record.

Run isolated coverage with pinned Node and dependencies (Python drives the
transaction; backup BSON validation runs on Node 20):

```sh
DIPLOMACY_CLIENT_ROOT=/root/diplomacy NODE_PATH=/opt/diplomacy/node_modules \
TMPDIR=/mnt/storage/tmp-diplomacy python3 -B deploy/test_activate.py
```

The stateful service adapter is disposable; tests exercise shipped transaction,
preflight, atomic replacements, candidate inventory validation and real backup
validation using fake Mongo command fixtures. Production systemd/process/runtime
inspection is not exercised against a live host. These standalone deployment
tests do not change the game reliability registry or rules manifest inputs.

## Production orchestration configuration

Production execution is reserved for the production deployment ticket. Configure
`/home/bakharevns/.config/diplomacy/deploy.json` with absolute paths (no secrets
inline):

```json
{
  "releases": "/home/bakharevns/diplomacy_releases",
  "backups": "/home/bakharevns/diplomacy_backups",
  "node_dist": "/usr/local/lib/nodejs/node-v20.20.2-linux-x64",
  "health_probe": "/home/bakharevns/.config/diplomacy/health-probe",
  "existing_games_probe": "/home/bakharevns/.config/diplomacy/existing-games-probe",
  "public_url": "https://playdiplomacy.online/",
  "socket_url": "wss://playdiplomacy.online:8443",
  "google_client_id": "/home/bakharevns/credentials/diplomacy/client_id",
  "smoke_allowlist": "/home/bakharevns/credentials/diplomacy/smoke-allowlist.json",
  "smoke_key": "/home/bakharevns/credentials/diplomacy/smoke_hmac_key"
}
```

Use the host's actual endpoint and existing credential paths. Both probes must
be installed, bounded, read-only and fail on an unavailable service/database or
new compatibility regression. The health probe must test database readiness,
not just a port. The deployment user needs existing noninteractive sudo rights
for the tracked `python3 -B deploy/orchestrate.py CLIENT SERVER` command, which
performs the privileged systemd/config/web/backup operations. Restrict that
trust to operator-controlled checkouts. The parent retains the exclusive flock
while this child runs. Existing SSH agent and known-host authentication are
reused for the paired pulls; deployment never provisions or prints credentials.

Run as bakharevns, using each repository's CURRENT branch/upstream:

```sh
/home/bakharevns/diplomacy/deploy/deploy.sh --dry-run
/home/bakharevns/diplomacy/deploy/deploy.sh
```

No branch name is silently selected; client master/server demons are the
expected operator checkouts. The runtime is exactly Node 20.20.2, client root
is explicit, and tests use `TMPDIR=/mnt/storage/tmp-diplomacy` with
`${TEST_JOBS:-6}` workers. Provide that temporary directory and installed
MongoDB command tools before deployment.

Each release attempt keeps `orchestration.log`, `result.json`, private
`recovery.json`, per-suite original logs, gameplay outputs, baseline/after
loader results, public asset hashes, journal and residue checks under its
unique releases directory. Fresh validated backups live under `backups` and
include collection counts at quiescence. The result identifies full client and
server SHAs/branches, manifest/runtime, paths, start time, all stages, original
failure, cleanup and rollback. Source/preflight failures are printed before a
release directory exists; retain invocation stdout/stderr in operator logs.
Exit 0 means every required check passed; exit 1 means failure even if rollback
succeeded; argument errors exit 2. No real-traffic or 24-hour observation gate.

Smoke uses a new random namespace and the established HMAC auth policy. A
release-local allowlist preserves prior entries and adds only this run; the
owned service override selects it after the backup. Existing keys are referenced,
not copied. The service user must traverse the release directories and read the
allowlist; retained evidence and recovery files stay private. Cleanup sends an
operation only from an authenticated connected socket and always disconnects.
A timeout/authentication failure is retained; no unauthenticated cleanup retry
is issued. Retained game/account IDs make orphan turns/sessions detectable after
cleanup. Global collection counts are reported, never required to remain equal
during real traffic; no real records are deleted or restored.

Post-activation verification failure restores the previous web/config/process
and checks health plus existing-game compatibility. Database writes are never
rolled back. New-format writes may be incompatible with old code; the recovery
result reports this limitation. SIGKILL/power loss still require manual recovery
using the private record. Existing-game coverage compares read-only saved-game
loader/turn preparation to a pre-switch baseline, including packed v1/v2 rounds.
It does not impersonate real accounts or exercise their browser UI. Concurrently
deleted games are reported; new open failures fail deployment. Isolated fixture
baselines use the same source revision and cannot prove cross-version production
compatibility.

## Isolated orchestration verification

```sh
export TMPDIR=/mnt/storage/tmp-diplomacy DIPLOMACY_CLIENT_ROOT=/root/diplomacy
export NODE_PATH=/opt/diplomacy/node_modules:/root/diplomacy_server/node_modules
python3 -B deploy/test_orchestrate.py /path/to/new-evidence
/usr/local/bin/node20 deploy/test_live_fixture.js /path/to/new-live-evidence
python3 -B deploy/test_journal.py
/usr/local/bin/node20 deploy/test_cleanup.js
python3 -B deploy/test_source.py /path/to/new-source-evidence
python3 -B deploy/test_activate.py
```

The orchestration adapter mocks remote Git admission, packaging and systemd but
uses real config/link transactions, BSON backup validation and actual HTTP asset
fetches. The source suite separately runs real paired ff-only Git pulls/flock/
self-update. The gameplay fixture runs the real shipped service, MongoDB, TLS,
auth/lobby/action/undo/commit/diff/replay and cleanup. These layers are labeled
in evidence; none claims an actual production deployment. Deploy tests are
standalone, outside the game registry; no rules manifest or discovery pins change.

Live verification has a 300-second deadline. Timeout or parent cancellation sends
SIGTERM to the verifier process group and allows 15 seconds for bounded,
authenticated cleanup (10 seconds). The client persists owned account/game IDs
as acknowledgements arrive and cancels pending protocol waits on SIGTERM/SIGINT.
If graceful termination fails, the wrapper sends SIGKILL and records the actual
child exit status, explicitly marking cleanup unconfirmed. Cancellation always
fails verification, even if the child exits zero. The release result retains
cleanup/residue and rollback outcomes; residue after forced termination is kept
for operator investigation, never removed through unauthenticated operations.
