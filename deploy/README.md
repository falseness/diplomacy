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
