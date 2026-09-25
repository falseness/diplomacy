# Current installation observation

`observe_release_host.py` supplies a read-only observation for
`prepare_rollback.retain`. Execute it **on the installation host**, as root, via
an operator-authenticated channel. The collector does not establish SSH trust or
assert remote authentication. Do not treat a locally supplied JSON observation
as authenticated production proof.

The collector verifies the expected hostname, canonical disjoint installation
roots, active systemd service, PID membership in the service's control group,
process start ticks, executable and working directory. It hashes `/proc/PID/exe`
and compares that running inode with the installed executable bytes. It repeats
process, service and boot observations to reject drift. It reads no process
arguments or environment and prints only the observation JSON. Systemctl uses a
fixed executable and read-only `show` arguments, with the remaining deadline.
Errors propagate as a nonzero exit; no usable observation is printed on failure.

Example shape, with paths and host chosen from authenticated installation data:

```sh
python3 ops/observe_release_host.py \
  --expected-host diplomacy --service diplomacy-server.service \
  --roots-json /private/installation-roots.json --stop-at-ms ABSOLUTE_UNIX_MILLISECONDS
```

The roots JSON has exactly `client`, `server`, `web`, `runtime`, and `config`.
Each is a real directory, with no symlink ancestors or overlapping roots. The
working directory must lie beneath `server`; the executable must lie beneath
`runtime`. Use canonical host paths, not workstation mount aliases. The config
root is the retained installation configuration, never the production database.
The collector converts the supervisor's absolute deadline from milliseconds to
seconds. It does not reset the budget.

After obtaining the initial observation, bind its exact bytes with SHA-256 and
use the same collector command as the retention helper's `observe` callback.
Retention compares all fields except `observed_at` before and after archiving.
Run acquisition and retention on the same host: process paths in an observation
are not portable to a workstation mirror. A later restart requires a new capture.

Run the focused controls with `python3 ops/test_observe_release_host.py`.
They use real local Linux processes and `/proc`, plus fixture systemd responses.
The positive case feeds the observed process into the real archive retention
helper; negative cases cover host privilege/identity, roots, service identity,
process drift, deleted/replaced executables and command failures. Owned processes
are reaped and an unrelated game sentinel is checked after every case.
These tests do not prove systemd or SSH behavior on production, runtime ABI,
HTTPS health, smoke identity issuance, or release readiness.

Production gate wiring, authenticated transport/acquisition, executable service
switch rehearsal, smoke issuance and final manifests remain required. TASK-225
must supply finalized current proof before staging. This collector performs no
staging, service mutation, activation, database operation, or ready-manifest write.
