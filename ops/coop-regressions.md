Focused revised co-op regression checks
=====================================

Use Node 20 and an installed Playwright Chromium runtime. Set `NODE_PATH` if
Playwright is installed outside the repository. Keep output under a new local
artifacts directory; never stage artifacts.

Run from the client repository:

```
node ai/test-coop-solo.js
node ai/test-coop-local-round.js
node ai/test-coop-demon-tile-ownership.js
node ai/test-coop-serialization.js
node ai/test-coop-undo-actions.js
node ai/test-coop-local-menu.js --output-dir artifacts/TASK-089/local-menu
python3 ops/run_coop_reconnect.py --output-dir artifacts/TASK-089/reconnect
node ai/test-coop-early-melee.js
node ai/test-coop-heavy-melee.js
node ai/test-coop-early-ranged.js
node ai/test-coop-late-demons.js
node ai/test-coop-selection-info.js --output-dir artifacts/TASK-089
```

The reconnect runner executes `node --test tests/coop/phase-idempotence.test.js
 tests/coop/browser-reconnect.test.js` in the sibling server repository. Its
legacy reconnect fixture creates an Imp on neutral land, relying on obsolete
special demon constructors, and writes to TASK-056. The runner temporarily
sets that tile's owner to the demon controller before creating the ordinary
unit and adds `COOP_TEST_OUTPUT_DIR` support. It retains the exact adapted test
source in the output directory and restores the original server file in a
`finally` block. It refuses unfamiliar fixture declarations or concurrent
fixture edits. Do not run another test or edit that fixture concurrently.
No server production code changes are applied. This keeps the coordinated
regression change in one client commit. A future server fixture update should
remove this compatibility adapter after moving these two changes upstream.

The solo and menu tests use independent terrain, hex-distance, connectivity,
roster and balance checks for current generated maps. Recorded generated
coordinates seed runtime entity ledgers only after that audit; they are not
presented as independent expected generator coordinates. The old sparse-map
fixture remains available for its seeded roster expectations, preserving the
unchanged generation matrix tests.

Before reusing a generation matrix, compare its archived source manifest with
current source, explain every drift by dependency, verify all 384 preset/count/
seed rows and passing exit statuses, and retain evidence hashes. Re-run affected
checks if generator/runtime/auditor dependencies changed. Browser checkpoints
must have equal expected/observed state, matching screenshot hashes, and no
console errors. Deliberately failing corruption children are passes only when
the parent checks the expected failure and exits zero. This workflow tests local
servers and does not deploy anything.
