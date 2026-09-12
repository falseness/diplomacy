# TASK-106 evaluator intra-op control

The prescribed one-factor experiment was rejected in iteration 28. With both
children sharing CPUs 0–1, inter-op 2 and V8 pool 4, intra-op 2 reproduced both
saved iteration-25 boundaries (four games). Intra-op 1 changed seed 12494's
inference positions from 17,280 to 17,270 at the first boundary. It stopped there,
with two completed games; the second boundary and all CLI timing were not run.
Both arms preserved the four attempted first-boundary non-results across the
repeat, and the reference arm also preserved its two second-boundary non-results.
No non-result is counted as a win. Both children in each arm released all owned
model tensors and were reaped. Initialized thread counts were 15 versus 14;
this difference was the intended treatment, while numeric work had to match.

Do not rerun this rejected control or treat its saved-checkpoint elapsed times
as a speed comparison. Evidence, complete commands/exits, raw events, snapshot
hashes, resource samples and the audit are under
`artifacts/TASK-106/iteration-28`. TASK-106 remains pending. No production change,
canonical medians, complete four-step screen or achieved speedup is claimed.
The next implementation needs a distinct supported hypothesis and all original
production-predecessor, correctness and >=10% performance gates.

Historical invocation: `python3 ai/diagnostics/task106-native-pool.py NEW_DIRECTORY`.
The launcher refuses an existing directory, verifies the frozen runtime and
iteration-25 inputs, and records both snapshots, complete expected results and
source hashes before execution. It loads saved steps 3 and 4 through TensorFlow,
checks snapshot identity and calls the unchanged reusable evaluator. Only the
evaluator subprocess environment changes, before Node/TensorFlow initialization;
parent settings, IPC payloads and game arguments are preserved. It captures raw
reports before assertions and closes the pool in `finally`, stopping at the first
failed boundary without retries. A passing prerequisite would still require
an effective-setting audit before any balanced cold CLI screen; this launcher
does not automatically run training.

`python3 ai/diagnostics/task106-native-pool-audit.py EVIDENCE_DIRECTORY` checks
source/input hashes, complete results and inference counts, raw event accounting,
actual native settings and observed thread masks, retained tensors and shutdown.
It exits 1 on this real semantic failure. Missing evidence is also a failure.
Its offline source was added after the measured launch; it is not injected into
the measured runtime. Source review and the final commit binding distinguish it
from the frozen measured scripts.

Resource observations are one-second receipt samples of CPU ticks, context
switches, faults, RSS and thread masks. They can miss short-lived threads and
final counters; launcher elapsed includes polling delay and is diagnostic only.
No shared-host causal attribution, exact phase timing or many-core claim follows.
