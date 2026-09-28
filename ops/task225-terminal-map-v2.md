# TASK-225 terminal map acquisition v2

This opt-in experiment composes `terminal_ac3_provider.instrument` and AC2
capture unchanged, adding one call after mode selection and before identity/play.
It leaves archived helper pins, production policy and the active smoke-exits-162
selection unchanged. `Slider.realValue` is the displayed string, `value` is its
index; competitive player index zero displays two humans. Selection uses only
`tapControl` on shipped arrow buttons. Both participants record the full map
catalog, before/after selection without a screenshot (the canvas also displays the temporary password). Competitive expectations are
independently obtained by executing shipped map definitions: tiny deathmatch,
20 columns by 10 rows. Co-op selects Tiny, seed 1, two humans explicitly.

Whole TASK-221/AC7 clause map, declared before acquisition:

| Clause | Required proof |
| --- | --- |
| Distinct outcomes/boundaries retained | All existing provider checkpoints; victory, draw, terminal-to-coop, terminal-to-competitive; both reconnects, real replay, menu/socket/timer isolation, retained production callbacks and first legal move unchanged |
| Broad source rules | Five existing rules: victory, defeat, draw, competitive-draw, competitive-survivor; initial/final independently expected ownership and live registry checks |
| At most four browser journeys, two humans | Exact four-case plan and coverage; unique connected page contexts and lobby occupancy per case |
| Smallest maps and seed 1 | Four declared tiny seed-1 initial fixtures; both next-game menu selections; both passive first-move-before page grids and Mongo generation/initial state, co-op Tiny seed 1 and competitive 20x10 |
| Fog/join distribution | victory/draw/coop sequential and fog false; competitive simultaneous and fog true; actual traces and initial fixture fog must agree |
| Valid initial fixtures | Original declared-fixture files, generated metadata and unchanged builder hashes; no runtime board changes |
| Exclusions | No Cartesian browser products, long natural game repetition or high-count stress; optional diagnostics excluded |
| Exact assertions retained | Byte-exact previous adapter composition after removal of the single added call; every required provider checkpoint passes, complete streams, first-move expected/observed states and callbacks on both participants |

Acquire once with the existing server reliability runner and this preload.
Preserve original child receipts in provider/children.json, the actual provider
OS exit in provider-exit.json, and actual outer OS exit in process-exit.json.
The original join-143 competitive grids remain the negative baseline, separately
bound. No old/new source or evidence manifest is spliced together. Source
freshness is checked before acquisition; new tools are explicitly hash-bound.
Provider source-identities record both repositories before/after; raw trace,
persistence, screenshots, command/cwd/runtime, full stdout/stderr and cleanup
are retained under the fresh TASK-225 run. No silent retry.

Target 45 minutes; stop at 55 and cleanup before 60 with one acquisition deadline.
A provider success is not whole AC7 consumption. Only after independent whole
review and corruption controls can an absent/present same-input cumulative
consumer comparison publish a successor. Full TASK-225 steps 3/4/5/7 remain
gated, and its status must remain pending while any required proofs remain.


The first changed run is preserved at `artifacts/TASK-225/terminal-map-166/run-01`.
Its 60 source tests passed and three journeys completed. A visual audit found
that v1's additional full-menu screenshot exposed an ephemeral local test
password. The run was intentionally stopped before competitive map selection;
provider exit was SIGTERM and outer exit 1. No AC7 review or consumer ran, no
successor was published, and TASK-225 remains pending. The original tested v1
bytes and unexecuted reviewer drafts are retained under `tested-and-draft-tools`
with hashes; they are not current proof. Original receipts are not repaired.

Version 2 removes menu image capture entirely; selection traces whitelist only
mode/map/index/humans/size/fog/catalog. Source tests exercise the selector using
the shipped slider and map definitions with a password sentinel, proving that
only allowed fields are emitted and no screenshot is attempted. These are
source tests, not a second browser acquisition. Its runner forwards stop to the
owned suite worker before its detached parent, allowing normal finalization.
This shutdown correction is not browser-tested yet. Next run exactly one fresh
v2 acquisition under the same four-case contract, then independent whole review
and same-input consumption only if every clause has proof. Do not re-inspect
join-143, claim the stopped v1 establishes competitive map compliance, or use
an unexecuted draft reader as validated coverage.
