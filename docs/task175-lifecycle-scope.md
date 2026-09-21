# TASK-175: proposed lifecycle-correlation scope

Design only. TASK-175 remains pending at 63/70. This scope addresses the p9
duplicate payload and coop-12-06 p5 send/receipt discrepancy documented in
`task175-trace-review.md`. It authorizes no execution, instrumentation change,
production fix or acceptance retry. The completed callback batch and trace review
must not be repeated. A revised task contract must select and authorize a bounded
experiment after reviewing this proposal.

## Source review and required changes

The existing `ai/diagnostics/task175/hooks.js` brackets Engine close, heartbeat,
Manager reconnect and server join receipt/queued callbacks. It has no application
client-emit occurrence record. `recorder.js` labels Engine and transport objects
but does not label the Socket.IO socket or namespace. It stores selected close
reasons only; missing detail cannot distinguish absent reason from discarded
reason. Manager-close currently passes no reason. Its `complete:true` means a
flush occurred, not that every required callback was captured. These are specific
schema gaps to resolve before reusing the old diagnostic machinery.

In the server repository, `tests/reliability/helpers/browser-driver.js` observes
polling sends at `requestfinished` and WebSocket sends at `framesent`. Neither is
an application emit or proof of server receipt. Its raw sink drops request/socket
identity. `server/index.js` logs `@@startGameOrConnect` inside the matchmaking
queue, after handler entry. A missing log is therefore not proof of missing
handler entry. The revised record must distinguish all three boundaries.

## Required record contract

Each row must contain run, repetition, page (including duplicate-page identity),
process/clock domain, local monotonic time and local sequence. Keep separate
labels for Manager, Socket.IO socket/namespace, Engine object, Engine session,
transport instance and connection epoch. Session labels must correlate client,
network and server through a run-secret keyed digest; raw identifiers and the
secret must never be saved. Missing bindings remain explicitly unknown. Never
assign a late polling response to the latest open session.

Capture these boundaries with entry/exit or occurrence labels as appropriate:

- Application join emit, connected/buffered state, packet encoding and transport
  write; request/frame object and packet index at the existing network observer.
- Server packet decode, Socket.IO handler entry, queue entry/execution, assignment
  and opening emission; link receipt and queue work by a local occurrence token.
- Engine open/close/error, transport close/error, heartbeat expiry, upgrade
  acceptance and Manager reconnect attempt/result, bound to their exact objects.

An emit occurrence token stays local: do not add fields to the gameplay payload.
Record an allowlisted event and keyed payload digest, then match occurrences by
session, ordered packet index and protocol boundaries. Identical payload digests
alone cannot identify an occurrence. Ambiguous matches must remain ambiguous.
Store normalized reason/error categories, plus explicit absent, redacted and
unknown flags. Do not serialize arbitrary error objects, URLs or credentials.

Use separate browser, runner and server clock domains. Wall time may index logs
but cannot establish cross-process latency or ordering. Causal edges require
object/packet membership or explicit callback relationships. Record callback
entry and exit separately; an asynchronous handler's return is not completion of
its awaited queue work. Preserve barrier observation time as its own measurement.

## Observer effects and validation before execution

This is an opt-in diagnostic treatment. Callback bracketing, keyed hashing,
buffering and source transformation add work and can alter timing. The prior ON
mechanism fulfills transformed CDN content; it cannot claim the standard browser
CDN bytes or observers-off equivalence. Record original and transformed hashes,
hook manifests and delivered-source provenance separately. Keep the standard
runner and all original assertions unchanged, including batching, final isolation
and the e199e45 forwarding fix. No limit, hold, concurrency or retry tuning.

Before any live proposal, source review must map every required boundary to an
exact pinned hook and explain unsupported ones. Isolated recorder checks must
cover duplicate payloads, reconnects with distinct sessions, delayed old-session
responses, emit without receipt, receipt awaiting queue, unknown reasons,
redaction, overflow, observer failure and incomplete flush. These are schema
checks only. An independently expected hook inventory, final sequence/count,
flush state and observer error counters must establish capture completeness;
`complete:true` alone is insufficient. Missing evidence invalidates classification.

## Experiment decision and stopping boundary

The next task revision must explicitly name immutable source/dependency hashes,
the allowed instrumentation, exact scenario and finite wave budget, control and
treatment ordering, commands, output paths and stopping rule. No wave count or
command is authorized by this document. Do not reuse the consumed OFF/ON/ON/OFF
batch or full acceptance authorization. Preserve original fixtures, real HTTPS,
MongoDB, Socket.IO, UI barrier actions and every lifecycle/error assertion.

With complete records, distinguish a second emit from one buffered emit written
later, a second session from duplicate observation of one session, and handler
receipt from queued execution. A recorded close reason identifies that lifecycle
event only; it does not establish host/CDN causality. If no failure reproduces,
report inconclusive and stop. If bindings or boundaries are missing, report
capture-incomplete and stop. Neither outcome permits retrying until green or
promoting TASK-175. Only separately authorized sampled 70/70 acceptance with
actual zero exits could meet its existing acceptance requirement.
