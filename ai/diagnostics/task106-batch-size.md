TASK-106 batch-size hypothesis (iteration30)

The bounded diagnostic compares the current LayersModel.predict default32 with
batchSize64, keeping both outputs and the production vector projection, statistics,
weights and disposal. The saved iteration29 trace contains1936 calls,865 over32
positions: internal batches would fall from2979 to2114. This is an operation-count
opportunity, not a measured speedup. Prior packing, deduplication, native-pool and
value-output experiments are separate consumed hypotheses.

The original predictor alone drives each game. An explicit32 sham checks wrapper
equivalence on every call. Each candidate value must match with Object.is; the
first drift archives its exact input and raw scalars, exits1 and disposes models.
Both saved25 snapshots and all four fixed games are predeclared; unfinished games
are never counted as completed results. Synthetic adapter controls exercise batch
options, full-output disposal, no caching and error cleanup without running games.

Disposition: REJECTED. At seed12494, call index2, position30 of51, the current
checkpoint returns-2.6901142597198486 by default32 and-2.6901140213012695 with64.
Explicit32 is exact; final tensors are zero. One game was attempted, none completed.
The rest were deliberately not launched after drift. No production code changed.
No complete-training cost or canonical medians were measured. TASK-106 stays pending.

Evidence: artifacts/TASK-106/iteration-30 contains the predeclared plan, exact
commands/exit codes, frozen source/input hashes, raw report and mismatch input,
offline failure audit, anti-cheating decision and content audit. The offline
task106-batch-size-audit.py exits1 for this real rejection; integrity PASS does not
mean numeric parity or readiness PASS. Do not rerun this hypothesis unchanged.
Any distinct future candidate retains actual-predecessor/full-work/correctness,
>=10% four-step screening and canonical15-game median-of-three gates. The narrow
six-scenario inherited TASK-063/TASK-156 quality exception remains unchanged.
