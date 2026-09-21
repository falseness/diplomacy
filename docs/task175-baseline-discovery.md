# TASK-175 post-discovery acceptance result

The authorized standard-runner measurement on client `58597d4a` and server
`22c7f9c7`, including seven preserved dirty source files, executed all 70
repetitions exactly once on September 21, 2026, from 02:40:24 to 04:41:48 UTC.
It passed 63/70 repetitions and 2314/2335 checkpoints. Both runner and child
exited 1. TASK-175 remains pending; no second run or production repair was made.

Competitive two/four-player and co-op two/four-player groups each passed 10/10.
Co-op ten-player passed 9/10, twelve-player passed 4/10, and incompatible settings
passed 10/10. The first failure was `coop-10-02`: p9 opened two engine
connections and sent two joins, receiving one opening board. Server join order
was p5, p10, p8, p7, p6, p4, p3, p2, p9, p1, p2, p9. The other failures were
`coop-12-05` through `coop-12-10`; every one failed the single-engine-connection
and handshake checks. Some also failed single-join/server-request counts or
browser-error checks. Five console errors say
`WebSocket is already in CLOSING or CLOSED state.`

All allocation, shared-game, distinct-slot/color, opening-board, concurrency,
milestone, timing, server-error and run-coverage checkpoints passed. There were
no skipped repetitions, scenario exceptions, runner timeouts, stale-source
failures or historical-evidence guard violations. This is a runtime reliability
failure after successful discovery/setup. The passing negative-control
parent checked 123 repetition mutations, three run-level controls, stale sources
and secret detection. Its success does not make the connection gate pass.

The eight saved discovery hashes matched without rerunning the discovery
checker. The earlier live inventory matched 633/634 paths, with the missing
fixture CLI accounted for by its rename. The new run's 711 runner source hashes,
635 child source hashes, 146 served local identities, 936 dependency hashes and
seven dirty-file hashes were checked. All 49 required captures exist, match their
recorded hashes, and were visually reviewed. Independent CDN preflight bytes
are retained separately: they do not establish the browser's CDN response
identity. The standard runner used diagnostic=null and direct CDN loading;
callback OFF had used pinned fulfillment.

Local evidence is under
`artifacts/TASK-175/final-after-discovery-20260921T024003Z/`: complete
`verification.log`, immutable `runner-output.log`, child stdout/stderr and exits,
traces, ledgers, attempts, checkpoints, browser errors, negative controls,
screenshots, source identities, setup identities and `audit/`. The child's
`children/001-reliability_join-races/evidence/source-identities.json` contains
served local hashes; the root source file belongs to the standard runner.
All 70 service activity.jsonl files contain NUL padding before their final
cleanup entry; they are not directly parseable as strict JSONL. This ancillary
capture limitation is inventoried without altering the raw files. Main record,
wire, server and child-output files have no NUL padding. Historical evidence was
not used to fill this run's proofs. Artifacts are local and uncommitted.

The one post-repair experiment is complete and must not be repeated automatically.
The next action is a read-only handoff review of this run's first failing
`repetitions/coop-10-02/{record.json,wire.jsonl,services/server.log}` and the six
failed twelve-player records, identifying what these actual traces establish
about extra engine connections and what remains unobserved. Do not infer host
starvation, CDN failure or a causal repair from these results. Any new executable
experiment needs a concrete revised task scope; do not repeat discovery checks,
completed diagnostic branches, unchanged acceptance, or status-only budget audits.
