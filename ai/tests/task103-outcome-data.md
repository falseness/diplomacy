`economy-outcome-data.js` collects actual candidate end-of-turn positions through
the normal game-start runtime. It assigns a terminal win/loss return to visited
states only. Speculative candidates receive no labels. Crashes, timeouts, sudden
death and invalid class assignments remain recorded and yield no training
examples. These are behavior-policy state values, not optimal action values.

The optional benchmark `position` observer receives detached JSON after a
candidate turn. `factoryOptions` lets a standalone generated map receive its
declared seed; existing map entries pass undefined and keep their normal defaults.
Neither option changes player selection, resources, action limits or accounting.

The data correctness check needs a fresh directory containing the plan from
`artifacts/TASK-103/outcome-supervision/plan.json` and the archived checkpoint:

```sh
node ai/tests/task103-economy-outcome-data.cjs PATH_TO_FRESH_PLAN_DIRECTORY
```

The final frozen check captured 100 states from four scenarios, with one win and
three losses. Results matched unobserved games. Two additional full-game controls
matched fresh post-turn vectors to final inference inputs and mutated observer
data without changing gameplay. Two truncated games and a missing-factory crash
were retained with no labels. This proves collection semantics, not strength.

The outcome pilot collected 412 training and 100 validation positions, then fit
twelve fixed epochs from the archived initial weights. Initial/outcome/zero
checkpoints won 1/3/0 of four development games respectively. **The independence
claim failed the evidence audit:** hashes included generator seed metadata.
After removing metadata, the twelve seed entries describe only six physical
maps, and every validation/development map duplicates a training map. The
apparent improvement and validation MSE cannot establish unseen-map strength.
All data, weights, outcomes and the executed source are retained as contaminated
evidence under `artifacts/TASK-103/outcome-supervision/pilot` and `pilot-source`.
No checkpoint was promoted to acceptance.

`outcomeLayoutHash` now hashes GameMap startup fields, preserves entity array
order, and ignores diagnostic metadata. `assertDisjointOutcomeLayouts` rejects
duplicate physical inputs before gameplay or fitting. The same historical pilot
plan now deliberately fails preflight:

```sh
node ai/tests/task103-outcome-layouts.cjs artifacts/TASK-103/outcome-supervision/pilot
node ai/tests/task103-outcome-fit.cjs PATH_TO_NEW_REJECTED_PILOT_DIRECTORY
```

The first command passes the overlap/metadata/key-order controls. The second must
exit 1 with `physical layout overlap` before `OUTCOME_COLLECTION` or
`OUTCOME_EPOCH`; it is a negative control, not a fit to repeat. Do not select
replacement seeds after these outcomes. Future outcome training needs a richer
generated distribution and physical split validation, including prior data,
before any collection. The earlier exact-target layout auditor also excluded
only testName, so its physical-disjointness claim needs correction; its label
reconstruction remains a separate result.

TASK-103 remains pending. Open-field, tiny-economy and full-combat strength gates
are unresolved. None of this data, the contaminated fit, or passing focused
checks substitutes for the complete configured suite required by AC4.
