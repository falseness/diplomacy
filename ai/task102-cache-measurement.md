# TASK-102 cache measurement

`browserScriptCache.js` retains individual compiled `vm.Script` objects in index
order. Benchmark and economy self-play create a new context for each game; only
immutable scripts are shared. Individual scripts retain their original filename
and script-boundary semantics. The explicit no-cache option and
`DIPLOMACY_DISABLE_BROWSER_SCRIPT_CACHE=1` provide a comparator.

On Node versions exposing `vm.constants.DONT_CONTEXTIFY`, fresh contexts use
direct VM globals to avoid the contextified global proxy during script execution.
Older versions retain contextified globals. Neither mode reuses mutable game
contexts. `node ai/tests/test-browser-context.js` checks global and lexical
isolation, browser aliases, and native constants in the selected mode.

With Node 20 on PATH, run the current correctness test with a real checkpoint:

```sh
NODE_PATH=/usr/share/nodejs npm run test-browser-script-cache
```

`TASK102_CHECKPOINT` can specify a compatible checkpoint; the default is the same
persisted fixture used by the gamestart regression. The test records checkpoint
hashes, spies independently on disk reads and `vm.Script`, checks fresh context
identity, and prints every cached/no-cache result pair. The spy includes the
initial player-class validation load; it does not clear counters after imports. Seeds are fixed in source
before running. These are equivalence tests, not checkpoint-strength estimates.

For the original TASK-087/TASK-101 training workload, run:

```sh
NODE_PATH=/usr/share/nodejs python3 ai/task102-measure-cache.py \
  --node-bin /path/to/node20/bin --artifacts artifacts/TASK-102
```

Use a new evidence directory for each attempt. The wrapper refuses to overwrite
source archives, runs every pair sequentially, and returns nonzero if either
median speed gate or historical determinism fails. It does not skip training
measurements when the component speed gate fails.

The workload source is `bf9b752`, the immediate parent of the first TASK-102
commit. Both variants use the browser loaders from `ecd5880` and route player
class validation through the cache. The before variant uses the preceding cache
from `8d2e35e`; the after variant adds the direct-global context factory to both
loaders and copies the current cache module. A source manifest asserts this
three-file boundary. This comparison excludes the later
TASK-102 curriculum deferral, warmed-context reuse, and subsequent model changes.
It measures the context optimization over the preceding cache in the original
workload; it is not a comparison of
the entire modern repository against that historical revision.

The component measurement uses 50 tiny-duel games, seeds 10200–10249, one round,
three actions and 60 commands. The separate historical equivalence run uses 20
seeds, 10400–10419, with 30 rounds. Each training run uses:

```sh
./train.sh --storage-dir <fresh-artifact-directory> --run-id task102-canonical \
  --games 15 --epochs 1 --seed 87087 --old-vs-new-games 2 \
  --plateau-window 2 --plateau-min-delta 2 --curriculum-lr-reduction-attempted
```

Both variants run three times, alternating pair order. Every command records its
exit code, elapsed wall time, full output and source provenance. An identical
observational preload records every exported `runGame` start, original result or
exception during training without modifying arguments, players or outcomes.
Sources are rehashed after all runs. Training checkpoints remain in the evidence
directory and receive SHA-256 hashes. No outcome is relabeled as a win.

A failed speed gate must remain a failure even if correctness passes. Keep
TASK-102 pending and use the existing TASK-158 tuning follow-up; workload deferral
cannot establish a script-caching speedup.

The earlier 2026-09-07 cache-only measurement failed both speed gates: the 50-call median changed
from 31.671003s to 44.289850s, and the full training median changed from
1684.785104s to 1765.029645s. All six training runs completed all 15 steps with
identical paired game workloads. A separate ten-call profile attributed 2.46%
of sampled code time to file reads and Script construction and 95.03% to game
execution. Those results do not establish a speedup. The direct-global attempt
must satisfy both gates with fresh evidence before the task can be handed off.
