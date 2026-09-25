# Rollback retention operation

`prepare_rollback.py` supplies the local retention operation for TASK-226. It
does not replace the historical TASK-065 switch script or authorize any switch.
The production release adapter remains unimplemented; TASK-225 readiness must
pass before any real release staging or production rollback preparation.

Call `retain(roots, observation_file, observation_sha256, observe, out, stop_at)`
with an authenticated current-host observation and a read-only collector from
the gate. The receipt hash must be bound to that gate's evidence. Roots must
contain exactly `client`, `server`, `web`, `runtime`, and `config`: disjoint,
concrete installation directories, including installed server dependencies.
The adapter must select these directories from the observed live process and
service/web configuration. Database storage, credentials and unrelated games
must never be selected. This generic local library cannot authenticate host
observations or determine whether caller-selected directories represent a live
installation. The config root should contain only required nonsecret service
and web configuration; external TLS/secret paths stay on the host.

The observation includes nonempty `host`, `boot_id`, `service`, `process_start`,
`observed_at`, a positive integer `pid`, exact absolute `roots`, and the concrete
`cwd` and `executable` beneath server and runtime roots. `observe()` must return
a fresh observation before and after capture; all fields except `observed_at`
must match. The adapter owns observation freshness, acquisition deadlines and
remote authentication. Synthetic collectors prove only local validation.

Output must be a nonexistent directory outside every input, with no symlink
parents. Resolve the repository's local artifacts alias before supplying an
output path. Pass the parent's cumulative Unix deadline, never a fresh budget.
The operation preserves bytes, modes and safe relative links, reads back the
deterministic archive, then resnapshots the installation to reject drift. The
archive is data only and is never extracted or executed. Failures retain partial
output without a successful receipt; retry into a new directory.

`prior-installation.tar.gz` and `retained-installation.json` are intermediate
outputs, with `releaseReady: false`. A future guarded activation must revalidate
the current host, source and evidence hashes immediately before switching. This
capture is not the final `rollback-manifest.json`, a restoration script, a
database backup, or a claim that a prior live release has been authenticated.

Run `python3 ops/test_prepare_rollback.py` for eleven temporary-fixture controls.
They compare independently listed archive members and literal bytes, check
process restarts and installation drift, reject tampered observations and unsafe
paths, enforce no-overwrite/deadline behavior, and preserve unrelated game data.
No production service, public identity, browser or database is used.
