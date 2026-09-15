TASK-124 spans the game and sibling server repositories. To retain all changes in
one commit, the companion server implementation and tests are tracked here as
`coop-scaled-matchmaking-server.patch`. Apply it to the sibling checkout with:

    python3 ops/apply_coop_scaled_matchmaking.py

The installer checks the patch before applying and recognizes an already applied
patch. A checkout carrying the previous (version-3, TASK-124) revision is upgraded
by reversing that revision first. It preserves unrelated edits and does not commit
or deploy the server. The patch updates the shared script loader (including
`ai/coop-valley-plan.js` before `ai/generateMap.js`), H2–12 validation, generation
metadata checks and both required server fixtures. Every new co-op request must
supply version-4 (Divided Valley) generation metadata, including the initial human
count and seed, and formula-derived grid dimensions. Missing metadata, unknown
versions and version-1/2/3 downgrades are rejected before persistence.
Saved-user reconnect runs before new-request validation and retains stored boards,
including saves with missing metadata or legacy version-1/2/3 settings. Count/preset/seed/version differences remain matchmaking inputs.

TASK-142 (version 4) leaves the local sibling checkout at the previous revision and
verifies the current revision reversibly with:

    /usr/local/bin/node20 ai/test-coop-valley-server.js --output-dir artifacts/TASK-142

It materializes the sibling HEAD files plus this patch, runs the server matchmaking
suite and a local/server Divided Valley parity, reconnect and checkpoint-resume
program, and restores the original sibling bytes on success or ordinary failure.

Run the server checks with Node 20 from the sibling repository:

    node --test tests/coop/matchmaking.test.js tests/coop/browser-online.test.js

Set COOP_TEST_OUTPUT_DIR to a local artifact directory before running them.
