# TASK-175: session correlation design review

Status: design only, not an executable experiment or a transport repair. The
156/156 paired recovery replay rejects permanent liveness failure in its synthetic
model. It does not identify the cause of the saved failed browser wave. Do not
repeat it. Final acceptance remains pending.

## What the current capture can establish

Paths below are relative to the independent `/root/diplomacy_server` repository.

| Capture path | Available evidence | Missing evidence |
| --- | --- | --- |
| `tests/reliability/helpers/browser-driver.js`, `BrowserPlayer.open` | Existing Playwright WebSocket frames and polling response bodies | `raw` forwards only player, transport, direction and text, not request or connection identity. Polling observation occurs after awaited response/body reads, not inside renderer callbacks. |
| `tests/reliability/helpers/observations.js`, `sanitizePacket` | Sanitized Engine control and application packet summaries | Engine open SID is replaced by `*`. This is irreversible in saved summaries. |
| `tests/reliability/helpers/join-races-game.js`, `wireSink` | Per-page sequence, observation time, event and payload digest | Sequence orders observer delivery, not Engine execution. `events` is a no-op sink; WebSocket lifecycle notes do not become durable evidence here. |
| `server/index.js`, `startGameOrConnect` | Identity, game, slot, queued join processing and opening emission source | Existing application log lines do not identify `socket.conn.id`; queued processing is not receipt time. |
| `tests/reliability/helpers/join-timing.js` | Optional hashed SID and CDP events | Disabled with observers off. Includes periodic metrics, renderer sampling and wrappers. Does not capture pollComplete/drain callback execution. |
| `tests/reliability/helpers/join-timing-preload.js` | Optional server upgrade/close/deadline observations | Replaces emit/upgrade/timer functions and adds periodic sampling; incompatible with empty NODE_OPTIONS and the specified observers-off run. |

Consequently, neither sorting saved packet timestamps nor assigning the most
recent open to subsequent packets establishes session membership. An old polling
response can finish being read after a new session opens. A sent WebSocket upgrade
packet does not establish server acceptance. A network close does not establish
the Engine close callback or its reason. Missing callback records mean unknown,
not “callback did not run.”

## Proposed passive network correlation, before any execution

The smallest useful network design extends the existing capture callbacks only:

1. Allocate a per-run random secret in runner memory. Derive a shared HMAC-SHA256
   session label from each Engine SID; never persist the secret, raw SID, URL query,
   cookie, password or bearer token. Distinguish Engine SID from Socket.IO SID and
   application identity. Include run and page labels in each row.
2. Bind a monotonically assigned request label to the existing Playwright request
   object and a connection label to the existing WebSocket object. Preserve that
   binding through asynchronous response reads. Extract the SID from that exact
   request URL, or the initial Engine open body for a SID-less handshake. Do not
   use “latest session.” A new open creates a new session even for the same player.
3. Pass these labels through the existing `raw`/`wireSink` path. Persist only
   allowlisted metadata and the existing sanitized packet. Keep asynchronous
   observer order explicitly separate from protocol order. No polling loop,
   additional route, request hold, timer, page evaluation, retry or deadline change.
4. Correlate joins and opening packets by session and application identity, using
   packet payload hashes only as supporting matches: duplicate payloads are not
   unique occurrence identifiers. Unknown or conflicting membership stays unknown.

This is a proposal, not an implemented or approved live treatment. It adds work
inside existing observer callbacks; “no new timers” does not prove zero timing
impact. Pure sanitizer/schema checks and explicit source review must precede any
execution. It must not silently redefine observers off or change the gate oracle.

## Why that design does not satisfy the active requirement

Passive network metadata can distinguish packets from different sessions, but
cannot directly observe renderer pollComplete/drain/probe-close/heartbeat callback
execution, server upgrade acceptance, or application-handler execution. Retrospective
state inspection also cannot reconstruct those past events. CDP breakpoints,
profiling, emit wrappers, added listeners, timer wrappers and an in-memory event
buffer all introduce observation; flushing after a wave does not remove the work
done while recording it. No currently inspected path supplies the required
callback provenance under the unchanged constraints. This is an instrumentation
design limitation, not evidence of an external service or host blocker, and not
a proof that every possible capture mechanism is impossible.

If a compliant source of callback records is found, require this evidence contract:

- Per-process sequence and session label; callback entry/exit distinguished from
  event emission and network observation; transport instance and lifecycle epoch.
- Actual polling completion and write-drain callback records, probe close, client
  heartbeat expiry/Engine close, Manager reconnect and the new Engine open.
- Server upgrade acceptance and close records carrying the same Engine session
  label; application join receipt, queued execution and opening emission linked
  to that connection and game/slot. Never infer receipt from queued execution.
- Explicit missing, overflow, observer error and incomplete-flush indicators.
  Any such condition invalidates a causal conclusion; no dropping errors.
- Separate clock domains. Use session/packet relationships and local sequence
  for causal edges; wall-clock proximity alone is insufficient.

Classify old-session timeout/new-session join only with a recorded timeout close
on session A, a distinct session B and the actual join/opening records on B.
Classify delayed same-session delivery only when request/frame and application
records remain on A. Either classification without callback provenance remains
network correlation, not an explanation of callback delay. Preserve ambiguous
cases and the original failure order.

## Next action and promotion boundary

Before implementing the passive proposal or executing a wave, resolve the missing
callback provenance against the observers-off requirement by source review. An
explicitly revised diagnostic observation contract would be a different experiment
and cannot be assumed authorized by this document. If no compliant record source
is found, report that narrow unresolved design issue; do not run a knowingly
insufficient capture and call it the required experiment.

No production candidate, live comparison or full gate is supported by this review.
Keep batching, the final isolation load and e199e45 forwarding intact. A future
bounded repair still needs independent proof and explicitly pinned baseline blobs,
then a once-only comparison in both orderings with multiple failing controls and
zero candidate lifecycle failures. Preserve all 34 H12 checks, thirteen contexts,
one UI wave, A routing/1000ms hold, observers off, empty NODE_OPTIONS, native
priority, flags, deadlines, fixtures and entitlement. Only then may the immutable
70/70 gate run. The old HEAD-based batch comparison is not reusable as a baseline.
