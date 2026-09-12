# TASK-106 evaluator placement control

## Completed experiment: rejected

The prescribed control completed in iteration 27 at diagnostic commit
`1fdf29acddd3de6fa2788ba8cd68feb58bfae793`, against frozen production
`47edf0406fc5f3a016ee948ba3b729646682a86c`. All four cold samples passed
39-game, 10-fit, weight, curriculum, lifecycle and 15-thread parity. Shared
placement averaged 706.2386326827109 seconds; disjoint placement averaged
733.2174904383719 seconds: reduction -3.820076742783016%, below the 10% gate.
These are screening means, not canonical medians. The automatic-thread
iteration-26 control was invalid because it changed numeric work; it is not
an alternative successful configuration.

Do not execute the command below as the next task step: it documents the
completed experiment. Retained results and limitations are in
`artifacts/TASK-106/iteration-27/decision.md`, with raw samples, `audit.log`,
`diagnostic-controls.log` and `commit-binding.log` beside it. Pinning with
these fixed thread settings is rejected as a supported speed improvement;
this does not isolate every scheduling or memory explanation.

TASK-106 remains pending. Full regression and canonical timing gates were
not reached. A distinct candidate needs measured support and a new complete
screen against its actual predecessor; neither historical savings nor this
documentation correction establishes acceptance. Do not repeat the control,
create another audit-only experiment, change thresholds, or skip to TASK-159.

## Historical invocation and control design

`task106-affinity.py <new-evidence-directory> --fixed-native-threads=2` freezes production revision
47edf0406fc5f3a016ee948ba3b729646682a86c and the iteration-25 inputs, then runs
four cold four-step CLI samples: shared, disjoint, reversed disjoint, shared.
It refuses an existing plan or production changes since that revision; diagnostic-only changes are allowed. This is the bounded
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
last subsecond activity can be missed. Parent/teacher native settings are unchanged. Both evaluator arms explicitly
use TF_NUM_INTRAOP_THREADS=2, TF_NUM_INTEROP_THREADS=2 and --v8-pool-size=4,
set before Node/TF initialization. A startup matrix verifies 15 initialized
threads under each CPU mask; the real-run auditor requires the same count
and checks the settings and every observed mask. This repairs iteration26's
invalid 15-versus-13 automatic thread control, without assuming numerical
equality: any drift from the complete iteration25 reference still stops runs. Two balanced pairs do not isolate shared-host variation,
native implementation choices or memory effects. Keep every outcome and sample,
and do not sum overlapping phases or claim many-core scaling from this control.
