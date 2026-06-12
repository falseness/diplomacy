# TASK-103 AlphaZero-Lite Combat Model Requirements

## Current Interface

- Runtime `AIPlayer` and `AIPlayerWithEconomy` score legal candidate grids through `predict(ai_model, vectorisedGrids)` and consume one scalar score per candidate in `getWinningChances`.
- The browser/runtime value model in `ai/model.js` accepts `[board, global_variables]`, where board cells use the current `CELL_VECTOR_SIZE`, and returns a single value output.
- `ai/alphazero-lite-combat.js` already defines a combat-only policy/value model shape with `combat_policy` and `combat_value`, but the next implementation must preserve the existing AIPlayer inference boundary.

## First Implementation Requirements

- Implement a residual policy/value-style combat model behind the existing AIPlayer prediction interface.
- Use a deeper residual trunk than the older runtime value-only helper, with named metadata for architecture version, board shape, global feature shape, action space, and output names.
- Keep a value output that can be used directly by AIPlayer candidate scoring as the scalar candidate score. If a policy head is present, use it inside the model/training adapter or inference wrapper without forcing AIPlayer to own policy-selection complexity.
- Keep AIPlayer methods simple: they should enumerate legal runtime commands, build candidate vector grids, call the inference boundary, and apply the selected normal game action. Model architecture, action priors, value blending, masking, and checkpoint compatibility decisions belong in `ai/` model or benchmark helpers.
- Do not add ad-hoc AIPlayer branches for `grid.arr.length`, `grid.arr[0].length`, specific gamestart map names, SimpleAiPlayer comparisons, candidate slots, or benchmark gates.

## Compatibility Expectations

- Existing value-only checkpoints must either load through an explicit compatibility adapter with recorded metadata or fail with a clear model-version/shape error.
- New checkpoints must record enough metadata to validate board dimensions, channel count, global features, action-space size, output names, and architecture version before benchmark or browser use.
- Runtime feature-vector compatibility must be checked against the current vectorizer instead of silently truncating or padding channels for final gates.
- Training artifacts produced before the policy/value implementation are not assumed to be comparable gate evidence unless their adapter path and limitations are recorded in the benchmark report.

## No-Cheating Comparison Rule

Later AIPlayer-vs-SimpleAiPlayer gates must compare unchanged runtime player classes under equal setup rules:

- No artificial gold, unit, HP, turn-order, sudden-death, or map-position advantage for the learned player.
- No benchmark-only concessions, forced no-op opponents, or early-win shortcuts.
- No SimpleAiPlayer-specific branches in AIPlayer or benchmark inference code.
- No map-size or map-name special cases in AIPlayer decision methods.
- Gate reports must identify the exact player classes, checkpoint path, inference adapter, map set, seeds, win/loss/non-result counts, and whether every win completed before sudden death.

## Stronger Options If Gates Fail

- Increase the residual tower depth and width while keeping the same inference boundary.
- Add a richer policy head with legal-action masking, action-category priors, and policy/value blending in the model adapter.
- Expand combat replay targets from one-hot chosen actions to improved policy targets from rollouts or stronger teachers.
- Add MCTS-style search over legal fast actions using model policy/value outputs, implemented outside AIPlayer methods so AIPlayer still calls a simple inference/search boundary.
- Add richer player-relative global features only through vectorizer/model metadata changes and retraining, not through comparison-specific AIPlayer logic.

## TASK-104 Build Notes

- `TASK-104` should implement the architecture behind the existing AIPlayer inference interface, record new checkpoint metadata, and add signature-loading smoke coverage.
- It should inspect AIPlayer changes and fail verification if model strength is implemented through map-size, benchmark, or SimpleAiPlayer-specific branches instead of model output.
