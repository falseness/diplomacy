Release preparation
===================

`prepare_release.py` packages verified client and server working files in the
sibling layout required by `server/loadGameCode.js`. It checks every packaged
file against the final local test source manifest, verifies browser/server script
dependencies, reads the archive back, and records Git revisions, working patches,
file checksums and external browser script URLs. Test certificates, private keys,
dependencies, Git metadata and artifacts are excluded. Run the prerequisite
evidence audit before invoking it; a source manifest alone is not proof of tests.

Example for TASK-065 (output must be an uncommitted artifacts directory):

```sh
python3 ops/prepare_release.py \
  --client /root/diplomacy \
  --server /root/diplomacy_server \
  --verified-sources /root/diplomacy/artifacts/TASK-064/source-manifest.json \
  --output /root/diplomacy/artifacts/TASK-065
```

TASK-065 discovered `diplomacy-server.service` on `bakharevns@89.169.157.173`.
Its original working directory is `/home/bakharevns/diplomacy_server/server`,
with `/usr/bin/node .` (Node 18.20.6). Nginx serves `/var/www/html`; shared game
code comes from `/home/bakharevns/diplomacy`. MongoDB uses `gameDB` on local
port 27017, and production TLS files remain under
`/etc/letsencrypt/live/playdiplomacy.online`. Preparation does not touch these.

The staged release is
`/home/bakharevns/diplomacy_releases/TASK-065-20260913`.
Its `candidate/` contains sibling client/server directories, a copy of the tested
Node 20.20.2 distribution, and dependencies installed from the server lockfile
on the target host. The host loads the staged game scripts without opening a
listener or accessing the production database. `rollback/prior.tar.gz` preserves
the original client, server (including dependencies), independent web tree,
systemd unit and nginx configuration; its manifest identifies every prior file.
The original runtime directories also remain in place. No database migration or
database rollback is part of this release.

`switch_release.sh` is the host-specific procedure for the subsequent deployment
task. It checks the original process identity, prior files and staged checksums,
then stops the service, retains the old web directory, links the candidate web
tree, and installs a systemd override for the candidate working directory and
bundled Node executable. Startup/handshake failures invoke rollback and return
nonzero. Rollback restores the retained web directory and original systemd unit.
The original directories must remain available; the archive provides disaster
recovery rather than an automated overwrite of live files. Drift in the prior
release or process blocks activation and requires renewed inspection.

Do not execute a switch during preparation. The local TASK-065 release manifest,
deployment and rollback wrapper scripts, checksums, prerequisite audit, staging
logs and final audit are the handoff. Successful activation still needs the real
protocol gameplay checks assigned to subsequent tasks.

Co-op repair verification (TASK-086)
==================================

From the repository root, run `python3 ops/verify_coop_repairs.py`. This executes
all five required Node suites sequentially and writes their complete output,
literal commands, runtime version, elapsed seconds and actual process exit
statuses to `artifacts/TASK-086/verification.log` and individual suite logs.
Use `--node`, `--output-dir` or `--timeout` to override the defaults.

Each suite has a 1200-second deadline: the starts suite can exceed 60 seconds
on this machine. A timeout is recorded as an unavailable process exit and a
separate watchdog status, and makes the runner fail. Every suite is attempted
even if an earlier one fails. Deliberate corruption children must fail as asserted
by their parent suites; the five parent processes must each exit zero.
Previous suite logs and matrices are moved to a timestamped local directory
before the run; verifier logs remain in place. Audit the new matrices, source
identities and final PASS markers before handoff. Never commit evidence files.

TASK-226 packaging hardening
============================

The packager now requires a fresh output directory, snapshots verified file
bytes, and writes deterministic gzip/tar headers. Working patches contain only
release paths; artifacts, private-key paths and unrelated edits are excluded.
Untracked release files require source hashes and are listed in the manifest.
Symlink source files are rejected. Run `python3 ops/test_prepare_release.py` for
the isolated packaging regression tests.

These checks establish byte packaging only. They do not establish passing game
verification, dependency/runtime installation, current production rollback
identity, or public smoke readiness. The TASK-065 switch script remains specific
to that historical deployment and must not be used for TASK-226. TASK-226 still
requires its registered release-preparation suite and complete TASK-225 audit
before a release can be marked ready.
