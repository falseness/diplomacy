# Lookup × undo ownership diagnostic

This is the finite TASK-102 interaction experiment prescribed in the September 9
`artifacts/TASK-102/diagnosis.md`. Production remains unchanged. The driver archives
one actual HEAD and derives exactly four same-source diagnostic variants:

| Arm | Expansion lookup | Undo capture |
|---|---|---|
| A | Eager (current) | Copy (current) |
| B | Original scan | Copy |
| C | Eager | Detached |
| D | Original scan | Detached |

Only the two existing lookup creation expressions and capture `.slice()` change.
Restoration still copies. Packing, VM isolation, policy, training cadence, seeds,
workers, model routing and naturally retained data remain fixed. Detached arms
are diagnostic, not proposed production changes.

```sh
python3 ai/diagnostics/task102-lookup-ownership.py \
  --output artifacts/TASK-102/lookup-ownership \
  --node-bin /root/.npm/_npx/ebaba8b9e55fd0a9/node_modules/node/bin
python3 ai/diagnostics/task102-audit-lookup-ownership.py artifacts/TASK-102/lookup-ownership
```

The driver refuses an existing destination. Before timing it freezes complete
sources, Node binary, installed dependency bytes and both checkpoint directories.
The original external baseline historical hash gap is retained. Each scheduled arm
in A/B/D/C then C/D/B/A runs a separate identical 50-seed component process and
one complete unchanged canonical 15-game process. Node 20.20.2, tfjs 4.22.0 and
6144-MiB heap are common. Coarse canonical observation is on in every arm; costly
candidate tracing and switch controls run separately after timing. No concurrent
local benchmark, replacement repetition, forced GC or overhead subtraction.

The auditor verifies exact diagnostic source changes, complete component outcomes,
130 canonical outcomes, 50 teacher games, all examples, 32 losses, 16 model
snapshots and full metrics/progress in every process. It reconciles exclusive
phases with wall time and preserves early/late costs, overlapping GC and natural
retention boundaries. Conditional effects B−A and D−C and their interaction,
plus ownership effects C−A and D−B, are reported separately by workload and block.
Negative seconds mean an improvement. These two-per-arm comparisons are never
median-of-three acceptance and cannot overwrite historical acceptance logs.

Advance B only if both whole workloads improve against A in both blocks, semantics
match, and measured magnitude/path evidence plausibly supports both original
10% gates. Mixed phase signs qualify mechanism conclusions; they do not erase
whole-command outcomes. Otherwise reject and close this hypothesis explicitly,
with no unchanged retry. A justified production candidate still needs frozen
actual-predecessor correctness and both median-of-three 10% gates against that
same predecessor; the historical canonical pass cannot be banked.

`tests/task102-lookup-ownership.cjs` observes each real archived arm to require
lookup creation/scan execution and copy/detached identity, independently checks
lookup values against original scans, and composes with the existing complete
movement/combat undo invariants. `task102-interaction-trace.cjs` preserves exact
ordered candidate inputs, scores, snapshot lifetimes and teacher examples on the
same pre-existing six teacher and six component correctness fixtures. Unchanged
cache, tensor and AI regression evidence is reused only after source/hash checks.
