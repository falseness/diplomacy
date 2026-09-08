# TASK-102 detached undo vectors

Fast-action application replaces every affected cell vector before refreshing
global channels. Its undo record can own the displaced array directly: that array
is no longer part of the mutable grid. Undo still copies the retained array into
the grid, so later actions cannot mutate a retained token. Prediction snapshots
continue to make independent deep copies, including snapshots retained for
training examples and batch prediction.

`task102-undo-ownership-prototype.cjs` is an explicit diagnostic preload for the
unchanged predecessor, af2fd0b. It asserts the original capture expression before
substitution and is never imported by production. Do not load it against a source
that already contains the ownership change.

`node ai/tests/task102-undo-ownership.cjs` runs the real generated movement and
combat invariants, checking that undo vectors remain detached and unchanged until
restoration and that restoration retains independent token storage.

Ignored evidence belongs under `artifacts/TASK-102/undo-ownership`. The declared
bounded comparison preserves the six production teacher and six checkpoint
component fixtures, baseline/prototype/prototype/baseline order, complete results,
and exact prediction/command/snapshot traces. These bounded measurements do not
establish either required median-of-three speed gate. Full acceptance requires
the unchanged explicit-revision wrapper and both original ten-percent thresholds.
