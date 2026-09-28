# TASK-225 reconnect observation experiment

The one v3-supervised acquisition at
`artifacts/TASK-225/terminal-map-168/run-01` failed with provider and worker
exit 1. The supervisor recorded no received signals, no deadline expiry and no
escalation. Victory and draw completed; co-op failed at its prepared-state
reconnect before any map selection. Competitive was never run. No whole AC7
review, consumer transition or successor is authorized by this failed proof.

The original child error is `p1: input "reconnect slot" had no observed effect
(!menu.visible)`. The input trace timestamps the click at 15:02:38.802Z; the
service activity records the next connection at 15:02:51.452Z and matching
game reconnect at 15:02:51.960Z. The driver's condition wait has an eight-second
timeout. The subsequent diagnostic reports `menuVisible=false`, and its
before-teardown screenshot shows the Player 1 round-zero overlay. That is
evidence of a later effect, not proof that the condition passed within its
deadline. The diagnostic's disconnected state and later connection refusals
do not establish an external outage: the owned server was stopped by cleanup.
The driver discards the original Playwright exception, leaving its cause
unresolved. Do not call this a map defect or claim a controlled regression.

`terminal_reconnect_probe_v1.js` adds only input-trace diagnostics around the
exact pinned driver wait for `reconnect slot` / `!menu.visible`: start, success
or failure, elapsed time, and the original Playwright exception name/message.
It preserves the 8000ms timeout, 50ms polling, predicate, click count and original
thrown error. It adds no screenshot or state mutation and does not observe
password inputs. The screenshot-free map v2 and AC2/AC3 adapters remain intact.
Source tests remove the additions and compare the entire driver byte-for-byte,
then check success, rejection/cause retention, no retry and unrelated controls.
These tests establish source behavior only; this adapter has no browser pass.

The versioned v3 worker changes only tool bindings, the added source tests and
the provider preload. The v3 kernel-signal supervisor retains the 45/55/60-minute
contract. Next iteration, after reviewing the complete unchanged four-case /
five-source-rule clause map in `task225-terminal-map-v2.md`, run exactly once:

```sh
python3 ops/supervise_terminal_reconnect_v1.py /root/diplomacy/artifacts/TASK-225/<fresh>/run-01
```

Read the original wait cause/timing and service timeline before changing any
timeout. Do not silently retry or relax assertions. Only a complete provider
can proceed to a separately bound whole-AC7 reader and actual same-source
cumulative consumer comparison. The reader drafts in terminal-map-168 remain
unexecuted for positive coverage and must be adapted to the new original
invocation, never spliced into the earlier runs. Smoke-exits-162 remains the
active selection; 127 prior obligations/eight owners are saved counts, not
recalculated totals. Full steps 3/4/5/7 remain gated and TASK-225 stays pending.
