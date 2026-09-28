# TASK-225 native-frame diagnostic

`python3 ops/diagnose_sequence_phase.py <fresh-directory>` declares two native
scheduling phases before any browser execution. Both use the unchanged seed-1,
fog-on, two-human `coop-actions-1` case and original requested 51 ms pan. The
phases wait for a real production callback exit, then wait zero or 50 ms before
the original pan driver. Normal CPU settings, gameplay, assertions and input
hold duration remain unchanged. There are at most two journeys/four pans, no
retries, an 840-second work stop and a 900-second cumulative diagnostic limit.

`sequence_native_frame_probe.js` separates callback observation from the frozen
rate-4 diagnostic wrapper. It forwards native callbacks exactly once, retaining
receiver, timestamp, return and exceptions. Alignment uses actual callback exit;
it does not replace or reschedule game frames. `sequence_phase_observer.js`
adds phase selection and retains passive input observations. IPC, rendering and
the passive observer's setup can delay the actual keydown after alignment.
Phase labels therefore do not establish the achieved input/frame relationship.

`audit_sequence_phase.py` independently classifies trusted event ordering,
production callback entry/exit, incoming held keys/speed, exact capped-frame
movement and bounds. It rehashes measured sources/tools, reads actual browser
child OS receipts and independently confirms owned service/directory cleanup.
The runner compares host post-reconnect observations across the two phases on
identical source hashes. Peer pans are supplementary, not interchangeable host
controls. A valid comparison requires one measured zero-update host hold and
one host hold crossing an update. Missing either condition means INCONCLUSIVE;
no further identical replay or speculative repair is authorized by that result.

The retained diagnosis-124 experiment is INCONCLUSIVE: host holds were 75.9 and
88.1 ms, each crossing one production update and moving within bounds. Peer
holds also crossed one update. Both journeys completed 12 actions and 183
independent assertions, with browser-child exits zero and complete cleanup.
The outer detached Python supervisor printed its final result, but its OS exit
was not captured: the subsequent `/proc` observer missed process reaping. Do
not manufacture that receipt or describe this as a complete provider invocation.
Future detached invocations must have an enclosing parent wait and persist its
OS receipt from launch, as the existing sequence-review launcher does.

No runtime repair, fresh current criterion credit or complete TASK-225 audit is
claimed. Keep review-114 active, 63 required prior obligations, 74 current
criteria and all eight self owners. This completed experiment must not become
another generic diagnostic retry. The task remains pending; all prior failures
and the rate-4 experiment remain immutable.
