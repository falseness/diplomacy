# Terminal AC7 sufficiency inspection

Run `python3 ops/inspect_terminal_bounds.py <fresh-output-directory>` from
`/root/diplomacy`. This is a read-only inspection of the consumed
`smoke-exits-162/run-01/reviewed-crosswalk.json` selection. It validates retained
source/evidence bindings, original provider files and receipt, immutable baseline
pins, the prior consumer/supervisor exits, required checkpoints, declared initial
fixtures and raw participant/map observations. It never awards criterion credit,
launches services or creates a successor selection. Exit zero means the inspection
completed, not that AC7 or TASK-225 passed.

The current terminal provider is `join-143/run-01/provider`. Its four initial
fixtures are tiny, seed 1, with two humans. However, the competitive next-game
boundary has **21×21** grids in both participants' passive `first-move-before`
records. The shipped `options/gamestart.js` includes a smaller **20×10**
`tiny deathmatch` map. This defeats the whole-journey smallest-supported-map
requirement even though the initial fixture was 14×14. Persisted new-game state
also records the 21×21 grid. The co-op next game is 14×14 with seed 1 in its
persisted generation settings.

The launch path explains why initial fixture declarations are insufficient:
`terminal-flow-next-game.js` toggles the mode and starts the next game without
explicitly selecting the competitive map. Its mode switch restores competitive
sliders (`menu/menu.js`); `terminal_ac3_provider.js` adds passive observation and
retained-callback controls, not a map selection. The original four-case manifest,
fixture files, checkpoints, receipt and raw traces remain immutable.

TASK-225 test step 2 explicitly requires stopping this closure when any clause
lacks proof. Accordingly, AC7 remains unresolved, the active smoke-exits gate and
selection stay unchanged, and full-invocation steps remain prerequisite-gated.
Do not replay the unchanged provider or implement a reviewer granting partial-row
credit. A future changed acquisition design must select the smallest supported
competitive map through shipped controls, declare that choice before execution,
and capture the actual new-game dimensions and legal move. Preserve every
existing outcome/reconnect/isolation assertion and the four-journey bound. That
future acquisition would need its own source/receipt/freshness review and actual
consumer transition; this inspection does not authorize or establish closure.
