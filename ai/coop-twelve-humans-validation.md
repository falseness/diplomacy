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
skip turns through the ordinary local dispatcher. Rounds and units are never
assigned or fast-forwarded. Real demon AI executes without an action cap.
Only rendering, persistence, timers and model-training side effects are stubbed.
Each measured VM phase has a 60-second watchdog. The report records machine,
Node executable/version, timings, process memory, rounds, units and AI calls.
Three checkpoints compare shared visibility for all twelve human slots.
Successful completion requires an actual nonterminal round 30 and saves it.
A timeout is a failure, not a passing performance measurement.

The server adapter temporarily installs the committed fixture as
`/root/diplomacy_server/tests/coop/twelve-humans.test.js`, runs the exact Node test
command there, and restores the original file bytes (or original absence) in a
finally block. It uses actual server handlers and Socket.IO connections with
in-memory persistence. Two diagnostic peers compare stored state after a human
completion and a persisted restart. These are local integration checks, not
production deployment or a twelve-network-client load test.

TASK-127's initial workload exceeded the watchdog while completing round 8
with 148 demons at the last complete checkpoint. No round-30 result is claimed.
The local evidence index documents the failure, archived browser screenshots,
source identities and scope limits. The task must remain pending until its
required workload can complete; do not weaken the deadline to obtain a pass.
