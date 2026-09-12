# TASK-106 evaluator placement control

`task106-affinity.py <new-evidence-directory>` freezes production revision
47edf0406fc5f3a016ee948ba3b729646682a86c and the iteration-25 inputs, then runs
four cold four-step CLI samples: shared, disjoint, reversed disjoint, shared.
It refuses an existing plan or a different revision. This is the bounded
placement experiment prescribed by TASK-106, not a general training option.
Do not rerun a rejected unchanged experiment.

Both arms use two workers, reusable evaluation, the same Python exec wrapper,
and the same observers. Only the two evaluator CPU masks vary. The wrapper
calls sched_setaffinity before exec of Node, so subsequently created Node and
TensorFlow threads inherit the mask. Parent and teacher masks remain CPUs 0–1.
No game, fit, model, seed, outcome, or IPC payload is modified. The independent
waiter measures complete subprocess wall time through exit; resource sampling
continues on the harness thread and is outside the measured process tree.

`task106-affinity-audit.py <evidence-directory>` checks every predeclared sample
against the saved complete iteration-25 semantic results, fit calls, epochs,
weights and curriculum, then validates refresh/shutdown and observed thread
placement. It checks each completed prefix before launching another run, writes audit.json,
and exits 1 for invalid evidence or a mean
complete-run reduction below 10%. Linux CPU ranges and comma lists are compared
as sets. Initialized thread counts must also match. The --prefix option checks
completed work without claiming timing acceptance; --limit=N replays a saved
prefix to exercise this guard without rerunning training. A valid diagnostic screen is not canonical performance acceptance.

resources.jsonl retains one-second per-process and per-thread /proc snapshots:
CPU ticks, context switches, minor/major faults, RSS and actual allowed CPUs.
These are sampled counters, not exact lifetime totals; short-lived threads and
last subsecond activity can be missed. Native thread environment is unchanged,
but any automatic native behavior in response to affinity is part of the
observed treatment. Two balanced pairs do not isolate shared-host variation,
native implementation choices or memory effects. Keep every outcome and sample,
and do not sum overlapping phases or claim many-core scaling from this control.
