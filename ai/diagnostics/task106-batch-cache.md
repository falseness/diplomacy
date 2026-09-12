TASK-106 complete-batch cache diagnostic (iteration32)

The diagnostic memoizes full ordered Float32 input batches at the unchanged
LayersModel.predict default32 boundaries, retaining both outputs. It preserves
shape, ordering, batch tails, projection and logical inference counts. Full byte
keys avoid hash-only equality assumptions. A16MiB accounted storage limit uses
LRU eviction; model owners must clear after weight changes and close before disposal.
The saved-boundary screen instead creates fresh caches per fixed-weight game.
This is distinct from rejected individual-position deduplication and batchSize64.

Original predictions drive all four predeclared games while candidate values must
match exactly. All1936 calls/57547 positions and full saved results matched; all
four non-results remain non-results. Final model tensors and cache bytes were zero.
Standalone controls exercise boundary sizes, both outputs, resets, errors and bounds.
The offline auditor checks complete evidence and six deliberately corrupted copies.

Disposition: REJECTED at the predeclared conservative opportunity prerequisite.
1141 hits/1838 misses reduced measured predictor time22.86766979800175%, but the
instrumented evaluation estimate was2.720653467177091%, below10%. The estimate
includes comparison/input-hash overhead and is not an upper bound, exact phase timer
or complete-training measurement. No cold source screen or canonical timing followed.
No production code changed; TASK-106 remains pending. Do not rerun unchanged.

Evidence: artifacts/TASK-106/iteration-32, including exact commands, source/input
hashes, paired report, failed auditor exit1, controls, decision and content audit.
Future work retains actual-predecessor/full-work/correctness/>=10% gates. The existing
six-scenario quality exception remains narrow; TASK-156 owns the inherited strength
failures. These diagnostic games are reused development inputs, not unseen holdouts.
