# TASK-225 terminal acquisition signal provenance

The one fresh screenshot-free v2 acquisition is retained at
`artifacts/TASK-225/terminal-map-167/run-01`. Its 61 source tests and shutdown
regression passed. Victory and draw completed; the co-op journey reached the
return-to-menu boundary. Before any smallest-map selection was recorded, the
supervisor received SIGTERM at 1790606737372 ms. Its recorded forwarding targeted
the owned terminal worker. The worker then reported a closed browser, the
provider exited 1, and the supervisor exited 1 with `timedOut=false`.

All three acquired service pairs and temporary directories were cleaned up;
all twelve recorded descendants are absent. The acquisition's own cleanup
flag correctly remains false because its required four-case gate is incomplete.
These resource observations do not turn an interrupted acquisition into a pass.
The sender is unknown: v2 recorded the signal number and time, not kernel sender
information. No controlled comparison establishes an external outage or a
gameplay/map-selection defect. Do not attribute the signal to a particular
launcher, deadline or person from the closed-page error alone.

`supervise_terminal_map_v3.py` preserves the v2 worker and acquisition contract,
but uses Linux `sigtimedwait` to capture sender PID/UID/code and process identity.
It records supervisor, launcher and child identities before waiting. It never
records process arguments/environment in signal diagnostics, suppresses an
incoming signal, or retries a provider. A received signal is forwarded to the
owned runner group, makes the result fail, and starts a bounded cleanup window.
The child restores the original signal mask before execution. Deadline expiry
is recorded separately from received signals, and actual OS exits are retained.

Local source/process verification:

```sh
python3 ops/test_terminal_map_supervisor_v3.py
python3 ops/test_terminal_map_shutdown_v2.py
```

These four supervisor cases prove success/nonzero-exit receipts, the exact
test-process SIGTERM sender and forwarding, and deadline classification. They
make no browser or map-compliance claim. An initial test-only use of the missing
Python 3.10 `signal.SI_USER` constant failed and is preserved; the test now checks
Linux's independently defined SI_USER value from `asm-generic/siginfo.h`.

Next changed experiment, not executed in this iteration:

```sh
python3 ops/supervise_terminal_map_v3.py /root/diplomacy/artifacts/TASK-225/<fresh>/run-01
```

Predeclare the existing four-case/five-source-rule clause map in
`ops/task225-terminal-map-v2.md`, retain the 45/55/60-minute limits, and bind v3
along with the unchanged worker. Review the original child/provider/supervisor
receipts before any whole-AC7 consumption. If a signal recurs, the new provenance
is the changed measurement; do not claim its cause until supported. If the
acquisition completes, validate menu/page/persisted map selection and the whole
criterion before the actual same-source consumer comparison.

The reviewer drafts under terminal-map-167 remain unexecuted drafts, not source
deliverables or proof. No whole-AC7 review/consumer ran, no successor was
published, and smoke-exits-162 remains the active selection. Full TASK-225
steps 3/4/5/7 remain prerequisite-gated; keep status pending.
