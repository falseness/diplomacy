Run the bounded native economy development experiment with Node 20:

```sh
node ai/tests/task103-economy-development.cjs artifacts/TASK-103/economy-development-new
```

The directory must not exist. The script records its fixed plan before collecting
eight generated stage-2 training maps and two validation maps. It retains every
batch, fits the existing 9×7×82 architecture for twelve epochs, and freezes the
initial, final, and zeroed checkpoints before gameplay. It uses the existing
collector and heuristic targets without changing gameplay or inference policy.
Initialization is random; archived weight hashes identify the actual experiment.

Each checkpoint plays the same four development cases, two per candidate side,
using the unchanged game-start benchmark, classes and gameplay limits. These
development seeds are disjoint from training, validation, and fixed acceptance
seeds. Reports retain losses, crashes and non-results. Process exit zero means
the experiment completed, not that a strength gate passed. No checkpoint is
selected using gameplay outcomes, and no acceptance binding is changed.

The September 9 experiment at `7cafdc8` plus this script collected 2,465 training
examples and 619 validation examples. Validation MSE fell from 0.4104989171 to
0.0083836960, but initial, zeroed and trained models each lost all four development
games. All twelve games completed with exact classes and native inference.
This experiment does not support promoting the trained checkpoint to acceptance.

The collector covers only four rounds and applies one teacher-selected command
per candidate turn; the opponent uses its normal `nextTurn`. Its labels are
normalized within each decision and are not terminal outcomes. Lower validation
error on that distribution does not establish long-game playing strength.
Future work should investigate training coverage and ranking on separate
development data before proposing further fitting. Do not repeat this fixed fit
or evaluate the known acceptance seeds merely to search for a favorable result.

TASK-103 remains pending: retained open-field acceptance is 3/4, tiny economy
0/2, and full combat has five rather than six advances. The old combat replay's
stale-vector behavior must not be restored. Resolve these boundaries before the
complete configured suite; the original speed evidence remains historical.
