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
