# Original-only observer calibration

Run the frozen plan once in A/B/B/A order, four complete games per fresh process.
A invokes the original predictor once with minimal counters and lifecycle/results.
B invokes it once and adds the iteration32 tensor checks, same-array exact scalar
comparison sham, JSON.stringify(grids)/SHA256, and per-call report construction.
Disjoint timers surround only these four diagnostic blocks. Report serialization,
loading, game runtime and final shutdown remain in full process wall time. Both
arms keep identical per-game result/lifecycle recording and full result equality.
No cache, second model prediction, training, graph/batch/native-pool change occurs.

Limitations: B compares an array with itself; no independently computed scalars or
cache-stat copy exists. Predictor timing fields and cache stats in iteration32's
report are omitted. Diagnostic timers themselves add overhead; their sum excludes
timer bookkeeping, subsequent GC and final report serialization. The sham cannot
recover paired-predictor/cache/GC interference. A/B process differences on a shared
host are observations, not attribution of all differences to instrumentation.

Before execution freeze git source, diagnostic overlay, plan, input hashes and
Node20.20.2/TF4.22.0/6144MiB/CPUs0,1/native defaults. Validate each complete prefix
against saved25 outcomes, ordered seeds/sides, 1936 calls/57547 positions, distinct
boundary hashes, zero final tensors and unchanged source/input hashes. Stop on
any drift; retain failures; no retries. Analyze all four samples once.

Compare diagnostic time and balanced mean process/game differences with the
historical 11.609866206s numerator and 426.730796335s contaminated denominator.
Removing more than310.632134275s would be necessary for that unchanged numerator
to reach10% evaluation-only. Do not transfer timings between hosts or claim a
full-training bound. Calibration never passes TASK-106 or demonstrates cache gain.
A separately supported candidate still needs frozen actual-production-predecessor
four-step >=10%, all required correctness and canonical median-of-three >=10%.
