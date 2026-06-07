# SimpleAiPlayer Baseline

`SimpleAiPlayer` is the pre-economy combat baseline for AI comparisons.

It is intentionally limited to combat behavior: each unit attacks an available target first, then moves toward the best enemy target when no attack is available. It can be selected in map or test definitions with `playerType: 'simple-ai'` without replacing the learned `AIPlayer` selected by `ai: true` or `playerType: 'AIPlayer'`.

The baseline starts with normal player gold by default and should not rely on unlimited resources. Later economy variants should inherit or wrap the combat behavior instead of changing this baseline.

## Economy Variant Modes

`SimpleAiPlayerWithEconomy` uses an explicit constructor mode. `war` prioritizes units and missing barracks. `economy` keeps at least one unit for defense, then grows farms and suburbs and adds a barrack when infrastructure is missing. The caller decides when to switch modes; spending order inside either mode is deterministic.
