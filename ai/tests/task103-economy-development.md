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

Inspect within-decision ranking of the archived validation examples without
fitting or running games:

```sh
node ai/tests/task103-economy-ranking.cjs artifacts/TASK-103/economy-development/experiment artifacts/TASK-103/ranking-analysis-new
```

The output directory must be new. All three checkpoint arms must match their
archived hashes. The diagnostic groups candidates by player and turn, records
every label and prediction, and reports teacher-optimal selections, normalized
regret and pairwise ordering. Controls exercise reversed scores, constant scores
and teacher ties. This reuses validation data, so it is exploratory analysis,
not an independent holdout or checkpoint selection procedure.

The archived trained model selected teacher-optimal actions in 5/8 decisions
versus 0/8 for both initial and zero models. Mean normalized regret was 0.069064
versus 0.745248 and 0.596630. Ranking improved on these opening-state examples;
the earlier gameplay losses therefore cannot simply be attributed to complete
failure to learn their ranking. This does not establish that the teacher or its
four-round data distribution supports strong full-game decisions.

TASK-103 remains pending: retained open-field acceptance is 3/4, tiny economy
0/2, and full combat has five rather than six advances. The old combat replay's
stale-vector behavior must not be restored. Resolve these boundaries before the
complete configured suite; the original speed evidence remains historical.
