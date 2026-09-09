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

The trainer now supports the explicit `stage-1-native` map source. It uses the
real stage-1 generator and existing legal post-action data collector, retains
boards in runtime `[x, y, channel]` order, and creates a 7x5x82 model. Default town
training still adapts to 9x9. Native training rejects incompatible initial models
instead of resizing boards. No gameplay or inference policy changes are involved.

Run the bounded integration before any longer training:

```sh
node ai/tests/stage1-native-training.cjs artifacts/TASK-103/native-fit-new
AI_STAGE1_SMOKE_CHECKPOINT="$PWD/artifacts/TASK-103/native-fit-new/checkpoint" npm run test-economy-stage-1-map-generation
```

The output directory must not exist. The integration freezes seed 103701, one
batch and one epoch before collecting data. It writes the complete batch and
plan, verifies native axes and default model dimensions, then records finite
loss, changed weight hashes and exact save/reload equality. Untrained and zeroed
output controls establish a numerical training effect. Targets come from the
existing heuristic teacher, normalized within each legal-action decision; they
are not terminal outcomes. The saved checkpoint uses direct model output without
heuristic feature fusion. Initial weights are randomly initialized and their
actual hash is recorded; identical retraining weights are not promised.

The September 9 native integration collected 253 examples and the unchanged
smoke passed with six inference calls over thirteen positions. Its four-turn
cutoff produced a timeout/non-result, not a win. This is a positive checkpoint
integration only. No validation-based checkpoint selection or learned-strength
claim is made; the fixed training seed excludes 11842 and 11800–11819. Missing
and 9x9 mismatch controls remain failures as required. Complete evidence is under
`artifacts/TASK-103/native-integration/`.

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
