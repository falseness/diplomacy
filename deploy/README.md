# Source preparation entrypoint

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

This increment **always fails with `activation not implemented`** after successful
source preparation. It never packages, changes releases, restarts services,
updates the web link, or accesses the database. Untracked files are preserved;
later packaging must use tracked Git objects, never copy the working directory.

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
and stops at the activation boundary. The private continuation environment is
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

`backup.js` is independent support, **not called by source preparation**. Only
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

`activate.py` is deliberately separate from `deploy.sh`; orchestration is later
work. It targets `diplomacy-server.service`, its one owned
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
