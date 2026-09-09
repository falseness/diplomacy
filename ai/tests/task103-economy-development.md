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

Measure actual model decisions over complete development games:

```sh
node ai/tests/task103-economy-runtime-coverage.cjs artifacts/TASK-103/economy-development/experiment artifacts/TASK-103/runtime-coverage-new
```

This freezes all three archived checkpoints and four disjoint development seeds
before playing either side through the existing runtime. It saves every native
input/prediction batch in gzip JSONL, each turn's model/heuristic action counters,
and every outcome. Optional benchmark observers receive detached copies; a
mutation control verifies that inputs and returned scores cannot be changed by
the observer. `--controls-only` checks this boundary without gameplay. Default
benchmark calls do not enable observation.

The September 9 capture under `runtime-coverage` completed twelve games: all
three arms lost all four games. Untrained/zero/trained checkpoints encountered
122/80/88 batches with multiple candidates. The model therefore has real attack
choices, although heuristic movement and purchases still control much of play.
Runtime inference also records baseline/final states; singleton batches alone
must not be counted as model decisions. Turn counters distinguish model attacks
from these extra predictions.

Comparing teacher agreement separately on each arm's own trajectory is
confounded by those different states. Cross-evaluating all three frozen models
on the same 215 informative multi-candidate batches gives 98/0/128 teacher-optimal
maximum-score sets and mean normalized regret 0.461179/0.530351/0.366492.
Exact prediction ties use average teacher regret, not an assumed chosen action.
This diagnostic uses only the existing vector teacher, not the collector's
additional material term. The trained checkpoint still improves teacher
agreement on the common full-game sample, yet fails every development game.
Neither absent model authority nor complete ranking collapse explains the losses.

The map itself is fixed: new RNG seeds are disjoint, but do not make new map
layouts or an independent final holdout. Repeated deterministic trajectories
must not be presented as independent strength evidence. No checkpoint was
promoted, no acceptance game was repeated, and no full suite was run while its
prerequisite strength gates remained failed. Further fitting requires a stronger
justification than lowering the same teacher error again; investigate the
teacher's relationship to outcomes and the heuristic phases before training.

Run the vector teacher directly as a development-only scoring control:

```sh
node ai/tests/task103-economy-teacher-gameplay.cjs artifacts/TASK-103/teacher-gameplay-new
```

The script freezes four disjoint development seeds, balanced sides, and both
the teacher and its negation before gameplay. Its tensor adapter receives only
the normal native board/global inputs. Runtime player classes, movement,
purchases, budgets and outcome accounting are unchanged. This is explicitly a
heuristic-only diagnostic, never a checkpoint to bind to acceptance. Controls
check score equality, candidate order, sign reversal and tensor cleanup.

Both arms lost all four September 9 games under `teacher-gameplay`, with no
crashes or non-results. This does not justify another fit against the same
teacher. It also does not prove no trained model can win: this teacher excludes
the collector's material term and uses raw scores instead of normalized labels,
so score magnitudes as well as rankings differ from neural inference. The fixed
map produces repeated trajectories; four RNG seeds are not four independent
map layouts. The remaining question is whether outcome-based supervision and
the runtime's restricted model authority can support the unchanged gates.
No model was trained or selected in this diagnostic, and all three acceptance
failures remain unresolved.
