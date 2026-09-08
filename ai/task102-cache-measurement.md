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

Returned benchmark results and economy batches are copied into the host realm
using V8 serialization. This preserves the data (including non-finite numbers)
while removing VM prototypes that otherwise retain complete game contexts when
training stores results. The economy driver is also compiled once per process.
`node --expose-gc ai/tests/test-browser-result-lifetime.js` retains real results
from both loaders and checks that all four game contexts can be collected.

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

For the canonical TASK-087/TASK-101 command on the actual revisions, run:

```sh
NODE_PATH=/usr/share/nodejs NODE_OPTIONS=--max-old-space-size=6144 \
  python3 ai/task102-measure-cache.py \
  --before <actual-preceding-revision> --after <frozen-candidate-revision-or-tree> \
  --node-bin /path/to/node20/bin --artifacts artifacts/TASK-102
```

Use a new evidence directory for each attempt. The wrapper refuses to overwrite
source archives, runs every pair sequentially, and returns nonzero if either
median speed gate or pre-change determinism fails. It does not skip training
measurements when the component speed gate fails.

The wrapper archives the complete actual revisions specified by `--before` and
`--after` (the defaults retain the earlier `8d2e35e` / `6b71478` experiment).
For the result-lifetime correction, the immediately preceding revision is
`d2b930d`; freeze the candidate as a git tree before testing and confirm the final
commit has that exact tree. No files are substituted from historical sources
or the working tree. Full source manifests, exact revision IDs, and their complete
diff bind all measurements to this pair. Earlier reconstructed historical results
are diagnostic controls and do not satisfy the immediately preceding-state gate.

The component measurement uses 50 tiny-duel games, seeds 10200–10249, one round,
three actions and 60 commands. Both variants load the same real checkpoint;
`--checkpoint PATH` overrides the persisted TASK-036 fixture. Checkpoint loading
time is included in both measurements. Existing `NODE_OPTIONS` are preserved
when the observational preload is added; both variants need sufficient heap
for the full canonical workload. The separate pre-change equivalence run uses 20
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
