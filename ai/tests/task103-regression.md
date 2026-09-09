Run the configured AI regression driver with Node 20 on PATH and the frozen
TASK-103 checkpoint captures available. Generate a new manifest file with:

```sh
python3 ai/tests/task103-regression-manifest.py --evidence artifacts/TASK-103 --bindings artifacts/TASK-103/fixed-checkpoint-replay/bindings.json --output artifacts/TASK-103/regression-manifest.json
python3 ai/tests/task103-dispatch.py artifacts/TASK-103/regression-manifest.json
```

The game-start bindings include the existing native tiny-economy checkpoint as
well as the remaining map callers. The earlier dispatch-integration bindings
omit that game-start input. The fixed-checkpoint bindings also supply the archived
TASK-047 native open-field checkpoint. Its first unchanged four-case evaluation
completed with three wins and one loss, so the open-field win gate remains unmet.

Run the aggregate below only after the prerequisite ledger is resolved, as
TASK-103 requires. The retained durable-reports ledger still records failed
tiny-economy and open-field gates and a failed full-combat advancement gate;
generating a manifest does not resolve those failures.

```sh
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

Archived checkpoints may use an `archive` binding with `repository_state`,
`provenance`, `original_checkpoint`, and the complete documented `known_seeds`.
Copy the original model, weights and metadata unchanged into task evidence first.
The runner checks their hashes against the archived repository-state record,
binds that record and the provenance document by hash, and rejects overlap with
training, validation or known development seeds. Review the provenance document
before declaring `known_seeds`; the validator does not infer ranges from prose.
This path preserves legacy training metadata and does not fabricate a fit report
or a before-training weight hash. Check it without gameplay using
`python3 ai/tests/task103-archived-checkpoint.py PATH_TO_MANIFEST`.

The runner assigns a fresh `AI_REGRESSION_REPORT_DIR` to each command, clearing
any inherited value. Game-start wrappers write their complete reports and failure
snapshots there and forward child output even when the benchmark exits zero but
the wrapper's win assertion fails. Each run records a SHA-256 inventory of its
report files, including on failure or outer timeout. Empty inventories mean no
report files were produced; they do not establish a successful gameplay result.
