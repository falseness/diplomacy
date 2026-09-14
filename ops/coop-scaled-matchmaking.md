TASK-124 spans the game and sibling server repositories. To retain all changes in
one commit, the companion server implementation and tests are tracked here as
`coop-scaled-matchmaking-server.patch`. Apply it to the sibling checkout with:

    python3 ops/apply_coop_scaled_matchmaking.py

The installer checks the patch before applying and recognizes an already applied
patch. It preserves unrelated edits and does not commit or deploy the server.
The local sibling checkout has this patch applied. It updates the shared script
loader, H2–12 validation, generation metadata checks and both required server
fixtures. Every new co-op request must supply version-3 generation metadata,
including the initial human count and seed, and formula-derived grid dimensions.
Missing metadata and version-1/2 downgrades are rejected before persistence.
Saved-user reconnect runs before new-request validation and retains stored boards,
including saves with missing metadata or legacy version-1/2 settings. Count/preset/seed/version differences remain matchmaking inputs.

Run the server checks with Node 20 from the sibling repository:

    node --test tests/coop/matchmaking.test.js tests/coop/browser-online.test.js

Set COOP_TEST_OUTPUT_DIR to a local artifact directory before running them.
