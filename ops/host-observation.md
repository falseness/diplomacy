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

`acquire_release_host.py` now transports the collector through OpenSSH with an
explicit known-hosts pin and client identity. It disables ambient configuration,
agent authentication/forwarding, connection sharing, proxies and password prompts.
It sends the four hash-pinned collector modules over encrypted stdin and loads
them in memory using isolated Python; it neither installs remote files nor stages
a release. The remote collector verifies real service/process state on the host.
Remote filesystem paths are never interpreted as local workstation paths.

Invoke it with `python3 ops/acquire_release_host.py --config PRIVATE_CONFIG.json
--stop-at-ms ABSOLUTE_UNIX_MILLISECONDS`. The config contains `host`, `port`,
`user`, `identity` (absolute private-key path, owned by the caller, mode 0600),
`known_hosts` (absolute file path), `known_hosts_sha256`, `expected_host`,
`service`, `roots`, and `collector_hashes`. The latter maps each of
`prepare_release`, `prepare_runtime_bundle`, `prepare_rollback`, and
`observe_release_host` to the SHA-256 of its reviewed Python source bytes.
Supply the host key through an independently authenticated operator source;
automatically accepting `ssh-keyscan` output does not establish trust.
The known-hosts file must contain the selected host/port key. Remote authentication
must permit root observation, as required by the collector. Stdout contains only
the observation and public transport provenance, with `releaseReady:false`.
SSH failures expose only the exit code; captured remote stderr is not published.
The remote clock must agree with the caller's absolute deadline. The caller owns
the enclosing cumulative deadline and must not claim remote process cleanup from
local SSH termination alone. A receipt is acquisition evidence, not a signature
that a later untrusted JSON consumer can treat as authenticated issuance.

`python3 ops/test_acquire_release_host.py` uses a fresh loopback-only sshd, generated
host/client keys and real SSH authentication. It checks the pinned server and
client keys, changed source/pin refusal, remote failure, deadline and injection
guards, exact remote process/executable observations, and owned-process cleanup.
Only systemd attribution is fixture data. No production endpoint is contacted.

Production gate wiring, real production acquisition, executable service
switch rehearsal and smoke issuance remain required. TASK-225
must supply finalized current proof before staging. This collector performs no
staging, service mutation, activation, database operation, or ready-manifest write.
