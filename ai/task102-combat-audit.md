# TASK-102 Combat Model And Gate Audit

## Current Model Signatures

- `ai/alphazero-lite-combat.js` defines the current AlphaZero-lite combat-only architecture metadata as `alphazero-lite-combat-v1`.
- Its default board input is `[3, 3, 21]`, global input is `[1]`, and action space size is `128`.
- It has a shared convolutional trunk with 32 filters by default, two residual blocks by default, a policy head named `combat_policy` with softmax output over the legal-combat-action index space, and a value head named `combat_value` with one tanh scalar.
- `ai/cloud-train-runner.js` still records the cloud combat checkpoint signature as value-only: inputs `board [null, 3, 3, 21]` and `global_variables [null, 1]`, output `value_output [null, 1]`.
- `ai/model.js` remains the browser/runtime value model helper: dynamic `[null, null, CELL_VECTOR_SIZE]` board input, global max pooling, dense layers, and one sigmoid output. Runtime players consume `predict(ai_model, vectorisedGrids)` as a list of scalar scores.

## Current Gates And Commands

- Historical TASK-102 audit note: `./train.sh` used to default `--curriculum-simple-winrate-threshold` to `0.6`; TASK-106 raises the active curriculum SimpleAiPlayer gate to `0.8` and passes it through to `ai/cloud-train-runner.js`.
- `ai/cloud-train-runner.js` advances curriculum only when plateau evidence exists, a lower learning-rate attempt is recorded without improvement, and measured or supplied SimpleAiPlayer winrate is strictly greater than the configured threshold.
- `npm run benchmark-combat-model` maps to `node ai/benchmark-combat-model.js`; its weak model gate default is `--weak-threshold 0.8`, with generated combat-only maps, `AIPlayer` versus `SimpleAiPlayer`, and 80-turn games.
- `npm run benchmark-trained` maps to `node ai/benchmark-trained-model.js`; its final big-map gate default is `--min-win-rate 0.8`, `--games 100`, `--map big-open-field`, `AIPlayerWithEconomy` versus `SimpleAiPlayer`, and clean pre-sudden-death wins only.
- `npm run benchmark-gamestart-trained` maps to `node ai/benchmark-gamestart-trained-model.js`; its default gate is `--min-win-rate 1` across 1v1 gamestart maps, one seed per side, `AIPlayerWithEconomy` versus `SimpleAiPlayerWithEconomy`.
- `npm run benchmark-gamestart-all-slots` maps to `node ai/benchmark-gamestart-all-slots.js`; it enforces the symmetrical all-slot gate only when `--require-100` is supplied, over every non-neutral candidate slot with `AIPlayerWithEconomy` against `SimpleAiPlayerWithEconomy`.

## Comparison Path And Bias Risks

- `AIPlayer` and `AIPlayerWithEconomy` choose among legal runtime commands by scoring vectorized candidate grids through `predict(ai_model, ...)`; selected actions still apply through normal game logic.
- `SimpleAiPlayer` attacks available targets first, otherwise moves toward enemy targets. `SimpleAiPlayerWithEconomy` inherits that combat behavior and adds deterministic economy production.
- `ai/benchmarkHarness.js` injects a synthetic smoke `predict` function when no real predictor is supplied. This is acceptable for harness smoke tests but must not be used for final model gates.
- `ai/benchmark-trained-model.js`, `ai/benchmark-gamestart-trained-model.js`, and `ai/benchmark-gamestart-all-slots.js` bind checkpoint inference into VM browser contexts and adapt runtime vector grids to the checkpoint input shape. The resize/channel-truncation adapter is a comparison risk because it can hide mismatch between runtime feature vectors and the checkpoint signature.
- `ai/cloud-train-runner.js` accepts `--curriculum-simple-winrate`; when non-negative, the SimpleAiPlayer gate records `source: mock-or-tiny-evaluation` instead of running the measured benchmark. Later architecture gates should require measured evidence, not this override.
- `ai/benchmark-gamestart-trained-model.js` can append follow-up tasks on failures unless `--no-followups` is supplied. That is useful operationally but should be disabled for pure verification reruns when task metadata must remain unchanged.

## Where To Wire Later Gates

- Wire the 80 percent final big-map gate in `ai/benchmark-trained-model.js` at the `minWinRate` default and failure check, and keep the report fields `candidateWinRate`, `cleanPreSuddenDeathCandidateWins`, `nonWins`, and `runtimeGamesExecuted` as the gate evidence.
- Wire the 100 percent 1v1 gamestart symmetrical gate in `ai/benchmark-gamestart-trained-model.js` by keeping `DEFAULT_MIN_WIN_RATE = 1` and requiring zero `nonWins`, with `--no-followups` for verification-only runs.
- Wire the 100 percent all-gamestart all-slot symmetrical-map gate in `ai/benchmark-gamestart-all-slots.js` behind `--require-100`, with exact class assignment and zero timeout or sudden-death failures.
- Wire the curriculum SimpleAiPlayer stage gate in `ai/cloud-train-runner.js` at `curriculumGateDecision`; TASK-106 changes the active default threshold in `train.sh` to 80 percent.
