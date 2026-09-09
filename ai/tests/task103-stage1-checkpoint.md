# TASK-103 stage-1 regression prerequisite

The stage-1 map smoke accepts `AI_STAGE1_SMOKE_CHECKPOINT`, pointing to a
checkpoint directory containing model.json, its weights, and metadata.json.
It uses the existing checkpoint loader and strict-shape predictor. The checkpoint
must accept `[batch, 7, 5, 82]` boards and `[batch, 1]` globals. No padding,
resizing, synthetic fallback, or runtime class replacement is performed.

```sh
AI_STAGE1_SMOKE_CHECKPOINT=/absolute/path/to/checkpoint npm run test-economy-stage-1-map-generation
```

Record the checkpoint's training provenance and weight hashes alongside the
printed model/metadata report. Fix its selection before running the smoke.
The fixed map seed is 11842; structural generation seeds remain 11800–11819.
A passing short smoke establishes runtime integration only, not learned strength;
model causality/holdout controls remain necessary for strength claims.

Without the variable, the existing required-predictor guard still fails. An
incompatible checkpoint also fails. Do not substitute a different map to obtain
a pass. The TASK-103 September 9 guard-isolation capture establishes that the
unchanged smoke passed diagnostically at TASK-048 parent 015279ee and failed at
43c6f2d before inference. That old synthetic pass is not gameplay acceptance.

A compatible trained checkpoint is still required. The inspected saved artifacts
and /mnt/storage/diplomacy models contain no 7x5x82 checkpoint. The available
9x9x82 economy checkpoint was rejected with the exact shape error. Other map
callers and the cadence, worker, game-start and unfinished regression groups
remain dependencies; this migration alone does not establish the all-AI gate.
