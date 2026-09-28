# Terminal evidence binding version 2

The db8f70f Player change preserves the units array when it has neither killed
members nor adjacent duplicates. Dirty arrays still run the original removal and
adjacent deduplication loops. Salary calculation and command recording are
unchanged. `join-143/reproduction-03.log` records the actual production call chain
through sendInstructions, recordHumanCommand, vectoriseGrid, playerIncome,
armySalary and updateUnits: the original implementation changed clean array
references. The saved join-143 raw movement/callback checks pass after the change.
`test_terminal_command_boundary.js` independently checks movement, membership,
gold, removal, adjacent duplicates, salary and native readiness on current code.

The new entry point is:

```
NODE_PATH=/opt/diplomacy/node_modules python3 ops/run_terminal_binding_review.py artifacts/TASK-225/<fresh>
```

It is an offline scoped comparison, not a full TASK-225 audit or acquisition.
The Python parent declares coverage before execution, uses one 55-minute work
cutoff, reaps owned child groups on timeout, records actual OS receipts and
finishes cleanup before the 60-minute ceiling. Its own exit must additionally be
recorded by the caller. The original provider exit 0 and consumer exit 1 remain
unaltered; the missing old supervisor receipt is not reconstructed.

## Reachable bindings

- Current AC3 gate v2 -> AC2 gate v2 -> historical terminal gate v2 -> unchanged
  sequence/competitive/twelve-client and earlier cumulative gates.
- AC2/AC3 selections v2 bind their review tools separately from acquisition.
  AC3 reader v2 -> AC2 reader v2 -> outcome reader v2. All initial-fixture,
  commit, terminal, raw boundary, OS receipt, served-source, capture-tool and
  native readiness assertions are retained verbatim.
- Outcome reader v2 accepts only the explicitly reviewed current Player SHA-256
  `09095f1b53aad727d3270a1fe2187fc91a6d6599db8b2be370cbb8d9beaa71a1`;
  all other implementation pins are unchanged. Current mode also requires live
  bytes at every pinned path. Unknown implementation hashes are rejected.
- Historical terminal selection v2 pins the complete immutable review-127
  selection file, requires the exact historical terminalSelection object,
  validates every original and projected proof and the original tool identities,
  and recomputes the original outcome assertions. Its explicit historical mode
  checks recorded implementation hashes against the old pins, without requiring
  those old hashes to equal live files. It reproduces the archived report
  exactly. `A.inspectRun` still independently compares all recorded source hashes
  against live files and supplies historical/current disposition to the actual
  consumer. No historical staleness is erased.
- Review-127 -> review-121 baseline SHA remains pinned, and all existing frozen
  ancestry checks remain reachable. No archived report, v1 reader, pin or provider
  tool is changed. The v2 copies make the binding-policy delta reviewable without
  runtime replacement of the frozen reader.

The comparison uses identical immutable join-143 provider bytes and its original
OS receipt. The old path must actually exit 1 at the Player pin. The new path
requires full AC2/AC3 revalidation, historical preflight, nine rejection controls
and actual cumulative consumption. It compares absent/present AC3 arms on the
same source and proof, requires exactly one fewer prior obligation, unchanged
non-target rows and eight unchanged self owners. It records source-driven
changes from join-139 separately instead of restoring obsolete 62/61 counts.

`coverage-audit.json` is deliberately not fabricated: the scoped result and
required-artifact audit state that the full invocation remains prerequisite-
gated. A passing scoped comparison is not readiness for verification.

## Saved comparison result and remaining ancestry work

`binding-145/run-01` is a preserved failing scoped comparison (consumer and
supervisor actual exits 1). Both complete current readers pass, all nine controls
pass, and historical AC1 preflight passes with 13 source differences. The actual
cumulative consumer then fails in unchanged `review_competitive_evidence.js:102`
at `competitive/current-sources`: its archive records the old Player hash.
No AC3 transition or successor selection is claimed.

The static reachable binding map and `remaining-ancestry-checks.json` are in
`artifacts/TASK-225/binding-145/`. Earlier competitive, twelve/ten/four/two-client,
matrix, camera, fog and asset readers also contain live-freshness assertions.
Those need explicit pinned historical validation before the new gate can be used
for cumulative consumption. Preserve the archived freshness assertions as past
observations, continue independently deriving the semantic assertions, and let
live comparisons downgrade dispositions. Replacing comparisons with empty arrays,
changing frozen tools, or refreshing browsers would hide this reader problem.
Do not rerun the unchanged comparison until that ancestry path is implemented.
The full gate and baseline-count claim remain unavailable.
