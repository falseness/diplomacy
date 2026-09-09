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

The current `economy-training.js` CLI cannot generate this prerequisite from
scratch: `ECONOMY_MODEL_WIDTH` and `ECONOMY_MODEL_HEIGHT` are both 9, `run()`
uses those dimensions for a new model, and `createTrainingBatch()` adapts every
board to those dimensions. Its supported map sources are town, final symmetrical
economy, advanced 9x9 economy and advanced 20x20 economy; there is no stage-1
source or board-dimension CLI option. `--initial-checkpoint` accepts an existing
model shape but does not supply the missing checkpoint or its provenance.
Running the default trainer again therefore does not address the missing 7x5
prerequisite. A training integration must supply documented real training data,
seed provenance and a frozen compatible checkpoint before this smoke can serve
as positive integration evidence. Do not resize a saved checkpoint or relabel
random initialization as trained to satisfy the loader.

Resume the global regression only after the recorded independent prerequisites
are resolved: TASK-118's checkpoint caller migration, TASK-104's cadence source
contract, TASK-106's required baseline argument, and the game-start gate failures
associated with TASK-156 and archived TASK-063. The saved timeouts are unfinished
tests with unestablished causes. Fixing this one smoke would not resolve those
groups. Preserve their failed evidence and task statuses; TASK-103 does not
authorize silently weakening their assertions or declaring a partial suite green.

The cadence source-contract failure can be isolated without launching training:

```sh
node ai/tests/task103-cadence-contract.cjs
```

This executes the current test's actual `assertSourceUsesInMemoryMetrics`
function against runner sources at TASK-078 parent `e92c6f55`, change `1a70d887`,
and the working tree, recording source hashes. The parent satisfies the contract;
the change and working tree fail its required `cadenceSpeedMode(options) ? 1 : 8`
expression. TASK-078 replaced the minimum synthetic epoch calculation with
`smokeSizedRun ? 1 : state.epochs`. This is separate from TASK-103's batch-size
change and the TASK-048 missing-predictor guard. The diagnostic does not execute
training or establish cadence output equivalence, throughput, or global readiness.
Do not simply update the assertion to match the new expression: resolving the
TASK-104 contract requires deciding and validating the intended training behavior.
