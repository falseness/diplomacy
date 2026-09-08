# TASK-102 allocation-owner experiment

Run `task102-allocation-profile.cjs MANIFEST teacher|component off|on PREFIX`
with Node 20.20.2 and a 6144 MiB heap. The manifest freezes actual predecessor
sources, the driver and hook hashes, checkpoint hashes, exact prior simulation
fixtures, off/on/on/off order and the decision table before measurement. Never
reuse an output prefix. Archive the command, complete output and exit status.

The original simulation driver supplies real production expert teacher games and
separate real-checkpoint component games. This driver adds HeapProfiler sampling
with both collected-minor-GC and collected-major-GC object inclusion enabled.
Raw allocation trees and samples remain available. Sizes are sampling estimates,
not exact object sizes or live heap measurements. Memory observations and GC
records are independent; GC durations overlap wall time and must not be added.

Forwarding wrappers on snapshot creation, prediction and candidate scoring run
identically in all four passes. They hash the complete serialized values and
record ordered call records, snapshot IDs, cell/channel counts and scores. No
input, command, score or returned reference is replaced. Snapshot hashes must
still match at prediction consumption, after intervening fast and normal undo.
The full final outcomes and every teacher example are saved separately. Hashes
account for all input bytes without retaining the large input arrays in the host.

Snapshot IDs and the host metadata map are reset between games. WeakMap keys
never extend snapshot lifetimes. Snapshots originally remain live through batch
prediction; selected grids and teacher consumers can outlive that batch. Reusing
a mutable cell buffer before all consumers finish is therefore invalid. The
normal snapshot path copies each cell array; fast-action undo separately saves
changed vectors and recreates them on restore. Movement `Way.initialization`
allocates used/distance/parent matrices, followed by queues and sorted neighbors.
These original producer frames, including nested allocation sites, are separated
in the auditor. Remaining sites and trace overhead are reported explicitly.

Run `python3 ai/diagnostics/task102-audit-allocation.py DIRECTORY` after all eight
passes. It verifies actual git blobs and working source/checkpoint hashes, all
48 complete results against archived source-matched reference results, and every
input/score/command/snapshot trace across off/on/on/off. It also requires complete
pass and exit markers, so a partial or missing log cannot pass.

Sampling calibration uses the declared off/on/on/off order. Trace hooks themselves
perform serialization, hashing and validation, so their allocation and GC overhead
must not be attributed to production. Hook calibration requires a trace-free
same-fixture control before any runtime speed claim; previous untraced archived
wall times alone do not establish current overhead. No correction is subtracted
from times, and no full evolving-training shares follow from these fixed games.

If original snapshot allocation supports a prototype, test one immutable cell
snapshot cache preserving complete cell values, ordering and consumer lifetimes
against the unchanged fixture. If BFS/undo instead dominates, assess that named
mechanism. Preserve failed comparisons. Diagnostic completion never satisfies
the two original >=10% median-of-three gates; keep pending until both pass.

The selected temporary-allocation prototype is task102-neighbours-prototype.cjs.
It replaces repeated reads of the pure Sprite.neighbours getter with one local
array per live suburb scan. No cache survives the scan, so movement, ownership
and undo cannot leave stale neighbor coordinates. The unselected snapshot draft
is archived only under artifacts; it was never run or installed.

Both auditors accept an optional second argument naming the frozen baseline
source directory. After a production change, pass its complete actual predecessor
archive there; the auditor still compares each file against that revision's git
blob. Instrumentation/prototype tooling hashes are checked separately against the
working tooling. This keeps old diagnostic evidence verifiable without requiring
the current runtime to equal the predecessor.
