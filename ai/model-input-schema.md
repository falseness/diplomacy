# AI Model Input Schema

Training and inference both call `vectoriseGrid()` from
`ai/vectorizeContent.js`. Each board cell is an 82-channel vector indexed by
`CELL_VECTOR_INDEX`. Model creation and checkpoint loading use
`CELL_VECTOR_SIZE` and reject checkpoints with a different channel count.

## Channel Groups

| Channels | Contents |
| --- | --- |
| 0-11 | Building presence and original unit type/combat state |
| 12-20 | Town ownership, health, income, and production |
| 21-31 | Barrack ownership, health, economy, and production |
| 32-38 | Goldmine ownership/income and player gold |
| 39-48 | Farm ownership, health, income, construction, and player income |
| 49-53 | Extended unit health, range, and building damage |
| 54-61 | Completed wall, bastion, and tower type, owner, health, blocking, and range bonus |
| 62-67 | Pending wall, bastion, and tower type, owner, turns, and hitability |
| 68-74 | Suburb cells, relative ownership, income, expansion opportunities, and town suburb totals |
| 75-77 | Current and opposing suburb income plus relative suburb-income advantage |
| 78-79 | Acting-player-relative unit HP and town HP ratio |
| 80 | Acting-player-relative unit distance to the nearest opposing live town |
| 81 | Continuous acting-player town-defense margin: nearest attacker distance minus nearest defender distance, normalized by map size |

Ownership channels are relative to the acting player: `1` friendly, `-1`
enemy, and `0` neutral (an unknown owner counts as neutral, never enemy). Health is normalized by maximum health. Production
turns are divided by the corresponding `*_PRODUCTION_TURNS_VECTOR_SCALE`.

Completed external defenses use separate type channels. Wall marks movement
blocking, all three defenses mark ranged-line blocking, and tower records its
range bonus. Pending construction never sets the corresponding completed type
channel and remains attackable while construction is in progress.

Suburb cells are read from live hexagon ownership and `isSuburb` state.
Expansion opportunities mark owned, non-suburb cells adjacent to a valid
suburb belonging to one of that owner's live towns. Town and global suburb
income channels count only suburbs whose ownership and live state still match
their town, so capture and town loss are reflected without stale list entries.

## Unknown Cells

On a hidden-information board (`board.hiddenInfo`) a cell whose contents the
client does not have has grid colour `null`. Such a cell is encoded without a
new channel, so the 82-channel shape and the trained models are unchanged:
channel 0 (`hasBuilding`, `CELL_UNKNOWN_CHANNEL`) holds `CELL_UNKNOWN_VALUE`
(`-1`), every other local channel is `0`, and the global channels (gold,
income, suburb income, town-defense margin) hold the same values as on every
other cell. Known cells keep `hasBuilding` at `0` or `1`, so full boards
vectorize exactly as before. A public demon portal on an unknown cell is not
encoded either. Seats whose gold is hidden (`null`) contribute `0` gold, and
the distance channels only see known units and towns.
