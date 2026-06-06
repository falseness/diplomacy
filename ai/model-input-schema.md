# AI Model Input Schema

Training and inference both call `vectoriseGrid()` from
`ai/vectorizeContent.js`. Each board cell is a 68-channel vector indexed by
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

Ownership channels are relative to the acting player: `1` friendly, `-1`
enemy, and `0` neutral. Health is normalized by maximum health. Production
turns are divided by the corresponding `*_PRODUCTION_TURNS_VECTOR_SCALE`.

Completed external defenses use separate type channels. Wall marks movement
blocking, all three defenses mark ranged-line blocking, and tower records its
range bonus. Pending construction never sets the corresponding completed type
channel and remains attackable while construction is in progress.
