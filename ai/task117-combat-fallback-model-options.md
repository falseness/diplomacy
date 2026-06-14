# TASK-117 Combat Fallback Model Options

This note is for the case where the first AlphaZero-lite combat model cannot pass the required combat gates from `TASK-115` and `TASK-116`. The current accepted evidence is:

- `npm run benchmark-final-symmetrical-combat` wrote `/mnt/storage/diplomacy/benchmarks/task116-final-symmetrical-combat-20260614.json` with 200/200 wins, 100% no-loss rate, and 100% winrate across the SimpleAiPlayer and baseline-AIPlayer gates.
- Independent verification wrote `/mnt/storage/diplomacy/benchmarks/verify-task116-independent-final-20260614.json` with the same 200/200 passing summary.
- The final training summary is `/mnt/storage/diplomacy/task116-combat-training-final-20260614/metrics/task116-combat-training.summary.json`.

If a later rerun fails, choose the fallback from the failure evidence. Do not patch `AIPlayer` with comparison-specific behavior.

## Required Gates

- `npm run test-combat-full-training-verification`
- `npm run test-combat-training-progress`
- `npm run test-combat-old-vs-new`
- `npm run test-final-symmetrical-combat-gate`
- `npm run benchmark-final-symmetrical-combat`
- `npm run test-task107-measured-gate-failure`
- `npm run test-task112-gate-failure`
- `npm run test-alphazero-lite-combat`

The final gate must pass against both unchanged opponents: `SimpleAiPlayer` and the baseline `AIPlayer` using `/mnt/storage/diplomacy/task111-combat-training-20260612131303/final/task111-combat-training/`.

## Non-Negotiable Boundary

`AIPlayer` should remain a thin runtime player: enumerate legal actions, vectorize candidate states, call the model/search boundary, and apply a normal legal game action. Stronger behavior must live in `ai/` model, vectorizer, training, benchmark, or inference-adapter code.

Do not add:

- SimpleAiPlayer-specific branches or concessions.
- Artificial gold, HP, unit, turn-order, map-position, or sudden-death advantages.
- Benchmark-only opponent no-ops or early-win shortcuts.
- Grid-size, map-name, seed, candidate-slot, or gate-specific conditionals in `AIPlayer`.

## Fallback Options

### 1. Larger Residual Policy/Value Tower

Use this when both curriculum and final gates fail broadly, or when loss/old-vs-new metrics plateau before reaching the 80% curriculum threshold.

Move the complexity into the model definition by increasing residual block count, channel width, normalization quality, and regularization. Keep the existing value output available to the current `predict()` path, and record a new architecture version in checkpoint metadata.

Expected evidence before choosing this option:

- `test-combat-old-vs-new` shows new checkpoints do not beat retained old checkpoints.
- `test-combat-training-progress` shows flat or noisy loss/winrate progress.
- Failures occur across several symmetrical combat stages, not only one tactical pattern.

### 2. Richer Legal-Action Policy Head

Use this when the value score chooses plausible positions but repeatedly misses obvious legal tactics, such as immediate kills, safe captures, threat blocking, or retreat timing.

Implement action-category logits and legal-action masks in the model adapter or training code. The adapter can blend policy priors with value scores before returning candidate scores, but `AIPlayer` should still call one simple scoring boundary.

Expected evidence before choosing this option:

- Per-game reports show losses from tactical action ordering rather than impossible map state.
- Value predictions are close for many candidates, but the chosen action category is wrong.
- Curriculum gates pass early maps and fail later maps with more action types.

### 3. Search-Enhanced Policy/Value Inference

Use this when one-ply candidate scoring passes simple maps but fails tactical races that require two or more turns of lookahead.

Add bounded MCTS, beam search, or minimax-style search over legal fast actions in `ai/` inference code. Search should consume policy/value outputs and return the same kind of candidate score or selected legal action through the existing boundary.

Expected evidence before choosing this option:

- The final symmetrical gate loses from delayed consequences such as overextension, undefended town pressure, or bad target sequencing.
- The model wins short tactical exchanges but loses longer forced lines.
- Increasing training games improves metrics slowly while deterministic failure seeds remain stable.

### 4. Stronger Training Targets From Rollouts Or Teachers

Use this when architecture capacity looks sufficient but supervised targets are weak or inconsistent.

Generate improved policy/value targets from self-play rollouts, old-vs-new winners, stronger checkpoint ensembles, or a teacher search policy. Store target provenance in metrics and manifests so benchmark reports can distinguish teacher-improved checkpoints from plain self-play checkpoints.

Expected evidence before choosing this option:

- Larger models overfit or do not improve gate winrate.
- `test-combat-old-vs-new` alternates winners without durable progress.
- Failure seeds show the same wrong action is repeatedly reinforced by current labels.

### 5. Player-Relative Feature Upgrade

Use this when failed games depend on information the model cannot see cleanly from the current vector/global inputs.

Add explicit player-relative combat features through vectorizer and model metadata changes, then retrain. Examples include attack-range pressure maps, town-threat summaries, unit mobility masks, remaining-action budget, and local material balance. This is a schema change, so old checkpoints must either fail clearly or load through an explicit compatibility adapter.

Expected evidence before choosing this option:

- Failure review shows missing state rather than bad action scoring.
- Different maps with the same visible tactical pattern receive inconsistent scores.
- Gate reports identify repeated mistakes around threat range, blocked movement, or ownership-relative danger.

## Selection Order

Start with the smallest fallback that matches the evidence:

1. Broad plateau: larger residual tower.
2. Wrong immediate action category: richer policy head.
3. Multi-turn tactical failures: search-enhanced inference.
4. Weak labels or unstable checkpoint improvement: stronger rollout or teacher targets.
5. Missing observability: player-relative feature upgrade plus retraining.

Every fallback must preserve the no-cheating comparison rule from `ai/task103-alphazero-lite-requirements.md` and must keep comparison strength in model/training code, not in ad-hoc `AIPlayer` shortcuts.
