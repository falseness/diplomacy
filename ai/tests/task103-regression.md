Run the configured AI regression driver with Node 20 on PATH and the frozen
TASK-103 checkpoint captures available. Generate a new manifest file with:

```sh
python3 ai/tests/task103-regression-manifest.py --evidence artifacts/TASK-103 --bindings artifacts/TASK-103/dispatch-integration/bindings.json --output artifacts/TASK-103/regression-manifest.json
python3 ai/tests/task103-dispatch.py artifacts/TASK-103/regression-manifest.json
python3 ai/tests/task103-evidence.py --mode regression --manifest artifacts/TASK-103/regression-manifest.json --artifacts artifacts/TASK-103/configured-regression
```

The manifest includes every registered `test-*` command plus `init-model` and
`train`, in package order. `--commands NAME ...` runs a declared subset and
records that it is not an aggregate pass. Each fresh child clears all three smoke
checkpoint variables, applies only its declared native checkpoint, and records
its environment, prerequisite hashes, command, process budget, output and exit.
The runner checks checkpoint hashes before and after each child. Missing,
modified, seed-overlapping or signature-mismatched inputs fail validation.

The checkpoint captures and generated manifests are evidence, never committed.
Their fit reports, batches, metadata and evaluation seed bindings describe
training integration, not learned playing strength. Additional bindings must
supply the checkpoint path and the unchanged caller's complete evaluation seeds.
The recorded process budgets do not change game limits or win thresholds.

Current prerequisites and results are recorded in the task evidence ledger.
A passing subset or an expected negative control cannot satisfy the all-AI gate.
The canonical speed comparison is separate; for the original optimization use
`--before d03d37a4d6d6d32b0de37e187ff29dece7bde35f --after 94a8d8e691d05a102d4e2af49938839bc4cb9465`.
A test-only follow-up commit does not provide a new performance baseline.

Game-start callers accept `AI_GAMESTART_SMOKE_CHECKPOINT`, forwarded as the
existing `--checkpoint` argument. Additional manifest bindings select it with
`"environment_key": "AI_GAMESTART_SMOKE_CHECKPOINT"`. Bind native dimensions and
all evaluation seeds before running; compatibility does not establish a win.
