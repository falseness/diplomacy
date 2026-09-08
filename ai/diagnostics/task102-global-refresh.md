# TASK-102 unchanged global-channel experiment

`task102-global-refresh-prototype.cjs` is an explicit diagnostic preload for the
actual predecessor `2a4101ee355e0634984d42bd0cda1a1709d6b2fa`. Production never
imports it. It tests skipping full-board global-channel propagation when the
action's previous and current global values are identical. Changed local vectors
already contain current values; undo restores independent previous vectors.
Comparing the first cell after replacement would be incorrect, so this prototype
compares the action's captured channel arrays instead.

Use the existing simulation driver and the six production teacher/six checkpoint
component fixtures with baseline/prototype/prototype/baseline order. Use the
allocation trace driver separately to compare complete inputs, scores, command
order, retained snapshots and all training examples. Timing with trace hooks is
diagnostic and does not establish production speed.

The frozen declaration and complete evidence belong under ignored
`artifacts/TASK-102/global-refresh`. The predeclared local promotion decision
requires positive means in both fixtures and more than five percent improvement
in the teacher fixture. This only decides whether to try a production candidate;
acceptance still requires all original correctness checks and both ten-percent
median-of-three full speed gates. Reject a mismatch or failed local decision;
retain all observations and do not repeat unchanged timings.

The bounded experiment rejected this prototype: the component fixture regressed
while the teacher fixture improved. It was not promoted to production and does
not justify another full speed run. The complete evolving-training cost remains
outside these fixed startup fixtures; their timings cannot establish its gain.
