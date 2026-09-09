TASK-103 exact collector-target diagnostic
=========================================

Use Node 20 with the installed native TensorFlow dependencies. Both output
directories must be new; existing evidence is never overwritten.

```sh
node ai/tests/task103-exact-collector-target.cjs artifacts/TASK-103/target-equality-new
node ai/tests/task103-full-target-gameplay.cjs artifacts/TASK-103/target-gameplay-new artifacts/TASK-103/target-equality-new/result.json
```

The first command reconstructs the two archived validation seeds, 1039200 and
1039201. It instruments a private module copy of the actual collector to capture
public material immediately after each candidate action and state after undo.
An independent material calculation must reproduce every raw and normalized
label. The instrumented and ordinary collectors must reproduce the entire
archived batches. Ordered command records, vector hashes, labels, best sets,
ties, and any undo failures are retained. These reused validation inputs are
reconstruction controls, not independent evaluation data.

Only after equality passes, the second command compares the vector term and
full collector target on generated stage-2 seeds 1039600 and 1039601, both sides.
Both arms use within-batch normalization and the existing benchmark's runtime
classes, candidate selection, movement, purchasing, budgets and outcome logic.
Private source instrumentation captures public candidate after-states at vector
cloning; it returns the same vector without modifying game state. The private
benchmark binds a heuristic predictor instead of checkpoint tensor inference.
These are diagnostic source copies, not production changes or learned models.
Saved generated source makes the instrumentation reviewable. Baseline vectors
without a captured candidate use the current public state. Multi-candidate
records include command identity and order. No future or hidden state is used.

The September 9 results under `artifacts/TASK-103/exact-collector-target` show:

* Exact reconstruction of 619 candidates across eight decisions; no observed
  vector/material undo mismatch, and no observer effect on collector output.
* Two distinct generated layouts, with structural hashes excluding testName,
  different from all ten prior generated training/validation layouts. Prior
  fixed-map experiments do not establish additional generated-layout coverage.
* Both targets win 1/4, with identical candidate records, selections and game
  results in every pair. All eight final games complete without non-results.
  An earlier loader failure before any turn is retained separately, including
  all eight failed attempts; it is not included as completed gameplay.

Close the omitted-material explanation for these cases. Do not fit this
unchanged four-round heuristic target again based on these results. The next
model hypothesis should test whether terminal-outcome supervision over full
runtime turns improves action ranking on a separate development corpus. Such
work needs a predeclared training/validation/development split, frozen initial
and trained weights, matched missing/zero/random controls, and outcomes before
any acceptance promotion. It is a proposal, not an implemented strength fix.
Alternatively, first isolate a specific defect in available candidate actions
or model authority with a bounded causal test. This small negative result does
not imply that no learned model can win.

Combat and open-field failures remain separate obligations. No acceptance
checkpoint was changed, and no failed acceptance command, fit, speed benchmark,
or complete suite was repeated. TASK-103 remains pending until its three
strength prerequisites and final complete configured suite pass.
