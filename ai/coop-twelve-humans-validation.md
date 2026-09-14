# Twelve-human scaled-map validation

Run with Node 20 from the game repository:

```
node ai/test-coop-scaled-generation.js
node ai/benchmark-coop-twelve-humans.js --output-dir artifacts/TASK-127
node ai/test-coop-twelve-humans-server-adapter.js
```

The matrix auditor requires the local TASK-126 archive. It verifies generation
source hashes, compares all 1,152 native and browser map snapshots, and checks
independently specified terrain, graph-distance, route, exit and starting-balance
conditions in the retained graph audits. Byte-normalizing the palette-only
change proves that generation geometry is unchanged since those audits.
It does not regenerate the unchanged matrix or rerun balance tuning.

The workload generates Big seed 0 with twelve humans and 36 portals. Humans
skip turns through the ordinary local dispatcher for 20 completed rounds.
The benchmark saves that genuine state, changes only the setup clock to 29,
and executes the full next dispatcher round to 30. This disclosed fast-forward
is necessary because uninterrupted idle humans lose at round 22. Units, towns,
resources, phase markers and wave seeds are preserved at setup; no waves or AI
execution are claimed for the skipped rounds. Real demon AI executes without
an action cap for every measured round (21 AI phases in total).
Only rendering, persistence, timers and model-training side effects are stubbed.
The benchmark opts into the shared harness's `nativeIntrinsics` mode, using
`DONT_CONTEXTIFY` and realm-native JavaScript constructors as a browser does.
Node must support that VM mode. Other harness callers keep their existing mode;
no production source, AI action limit or gameplay decision changes.
The headless workload also omits `border.createLine` / `attackBorder.createLine`
drawing output: the stubbed UI otherwise retains millions of unused BFS edges.
`node ai/test-coop-workload-context.js` checks identical actual command traces
and serialized states across the default, native, and native-without-lines modes.
Pathfinding, command collectors and combat remain unmodified.
Each measured VM phase has a 60-second watchdog. The report records machine,
Node executable/version, timings, process memory, rounds, units and AI calls.
Three checkpoints compare shared visibility for all twelve human slots.
Successful completion requires an actual nonterminal round-30 transition and
saves both the preparation state at 20 and the result at 30. This demonstrates
a prepared late phase with accumulated units, not uninterrupted survival.
A timeout is a failure, not a passing performance measurement.

The server adapter temporarily installs the committed fixture as
`/root/diplomacy_server/tests/coop/twelve-humans.test.js`, runs the exact Node test
command there, and restores the original file bytes (or original absence) in a
finally block. It uses actual server handlers and Socket.IO connections with
in-memory persistence. Two diagnostic peers compare stored state after a human
completion and a persisted restart. These are local integration checks, not
production deployment or a twelve-network-client load test.

TASK-127's original workload exceeded the watchdog at round 8. Its evidence
is retained separately. Native intrinsics alone also accumulated unnecessary
border drawing output; that diagnostic run was interrupted after round 9.
The corrected uninterrupted workload completed its phases under the watchdog,
but ended in combat defeat at round 22 and is retained as a failed development
run. None of those development runs is reported as the successful benchmark. See the local
verification index for the final measured run, source identities and limits.
