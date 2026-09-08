# TASK-102 temporary array allocation

Suburb vectorization builds an adjacency lookup once for each full vectorization
or fast-action apply. It is discarded after that pass. Ownership changes, suburb
painting, production and undo therefore never reuse a lookup from an earlier
state. Individual cell vectorization still supports the original scan.

Checkpoint prediction writes the same nearest-cell resized, truncated or padded
values directly into Float32 tensor storage. TensorFlow previously performed the
same float conversion after nested board adaptation and Array.flat. Each batch
owns its buffer. Candidate snapshots, batch order, scores and training examples
retain their existing ownership and policy.

Run `node ai/tests/task102-buffer-allocation.cjs CHECKPOINT` to compare exact
input tensor bytes and real checkpoint scores across matching and adapted shapes.
Run real vector invariants with
`node -r ./ai/tests/task102-suburb-lookup-preload.cjs ai/test-fast-unit-actions.js`
(and the ownership/production/building/suburb suites) to compare every optimized
lookup against the original scan through apply and undo.

Evidence lives in ignored `artifacts/TASK-102/buffer-allocation`. The bounded
comparison uses the existing production teacher and component fixtures in actual
baseline/candidate/candidate/baseline order, plus full input, score, command and
snapshot traces. It reuses the completed attribution and allocation sampling.
Only the unchanged explicit-revision full measurement wrapper can establish the
two required median-of-three speed gates. Bounded means never satisfy them.
