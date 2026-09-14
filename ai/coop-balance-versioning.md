# Fixed demon balance versions

New `GameMap.start` co-op games record `gameSettings.coop.balanceVersion: 2` before constructing units. Version 2 retains the ten TASK-107 combat stat rows in `TUNED_DEMON_TYPES` and original weights, with the explicit unlock schedule below. TASK-129 replaces the former delay formula directly for both new and loaded version-2 games, without a new balance version or save migration. No runtime wealth, survivor count, or online/local distinction enters selection.

| Type | Completed round eligible |
|---|---:|
| imp | 1 |
| clawling | 3 |
| hound | 6 |
| spitter | 6 |
| brute | 10 |
| emberArcher | 15 |
| bulwark | 20 |
| hexcaster | 24 |
| ravager | 30 |
| demonLord | 35 |

Round 0 has no eligible types. Unlocking grants eligibility in the existing seeded weighted selection, with one spawn per available portal; it never guarantees a Demon Lord or ends the game at round 40. Combat stats, weights, portal availability rules and termination behavior are unchanged. `coop-balance-selected.json` and historical tuning reports retain the original `scale-0.5-delay-32` proposal as historical optimization evidence, not the current unlock schedule.

A missing balance version or explicit version 1 selects the original stats and unlocks. Loading preserves the missing field; it does not migrate seeds, regenerate maps, reset phase markers, or upgrade existing units. Unknown versions fail during unpacking before unit construction. `waveGeneration.version: 1` remains the seeded selection algorithm version, independently of the combat balance version. Existing pure offline configuration APIs default to version 1 so historical valuation/projection tools still reproduce their original baseline; runtime callers explicitly select the saved balance version.

Browser constructors and the authoritative server use the same stat getters and wave files. The server's existing `loadGameCode` already loads these files verbatim. Ordinary unit classes are unchanged.

`node ai/test-coop-progression-v2.js` checks independent literal boundary sets, stats and weights. `node ai/test-coop-demon-config.js` includes legacy table checks and the versioned local/server comparison with literal unlock schedules; `coop-balance-selected.json` supplies only the unchanged historical combat stats and weights. The latter constructs every demon class, checks every unlock boundary across H1–4 and all presets, compares complete server/local spawned states, and checks exact save/load plus occupied/unblocked portals.

For the sibling server regressions, run `node ai/test-coop-balance-server-adapter.js`. This invokes the required `node --test tests/coop/authority.test.js tests/coop/phase-idempotence.test.js` from the server directory. The reversible adapter makes old injured-Imp fixtures explicitly unversioned and updates the wave/restart fixture to version 2. It archives both exact fixture versions under `COOP_EVIDENCE_DIR` (default `artifacts/TASK-108`) and restores original bytes in `finally`. Production server files are unchanged. The existing adapter fixtures predate this schedule; TASK-131 updates and verifies their authoritative progression and reconnect coverage.
