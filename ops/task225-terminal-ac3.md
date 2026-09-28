# Terminal AC3 and lifecycle sufficiency

Run `PYTHONDONTWRITEBYTECODE=1 python3 ops/run_terminal_ac3_inspection.py <fresh-directory>`.
This is a bounded archive inspection, not a provider, coverage consumer or full
TASK-225 gate. Review-130 is the completed inspection; review-129 preserves an
initial inspector containment error caused by comparing a resolved path with
the symlinked archive root. Both sides now use canonical paths. No historical
file or frozen review-127 tool was edited.

The reader independently constructs each first-move state from the recorded
input coordinates and the pre-move board. It checks both participants' ordered
menu inputs, both next-game modes, exact movement cost, and unchanged remaining
projected board fields. Six reader tests include nine rejection mutations for
missing menu input, wrong mode, resumed timer, changed HP/moves/name/location,
extra income and changed callback projection. These are reader controls on
in-memory trace projections, not gameplay/network controls or hash-rebound
whole-criterion corruption experiments.

The whole AC3 is insufficient. In each `terminal-to-{coop,competitive}` case,
`checkpoints.json` entry `.../next/old-callbacks-new-board-unchanged` obtains its
observation through the pinned mutating `OBSERVE`, then `localGameplay` filters
killed units and removes ownership/occupancy metadata, recipient turn, commit,
socket and timer state. There is no passive raw pre/post capture at this
boundary. Also, the source invokes `__oldCallbacks.forEach(...)`, but the archive
has no event-name/count or invocation receipts. This does not prove no callbacks
ran; it means the saved evidence cannot independently exclude an empty list.
Callback invocation remains source-executed coverage even when hosted in a
browser; it is not an authenticated network replay.

The lifecycle inspection verifies the four selected cases, archived command,
child exit/TAP summary, legacy parent receipt, budget arithmetic, both service
cleanup records, browser/server error records, served hashes and stable tested
source lists. All 157 archived evidence hashes match. Twelve tested sources
differ from the current files. This is a partial historical lifecycle review:
it neither reconstructs a richer parent receipt nor closes source validity,
whole-criterion semantics, or the complete independent lifecycle/tier reader.

## Next acquisition work

Do not repeat AC1, AC2 or this sufficiency inspection as a next deliverable.
The first passive capture primitive now exists in `terminal_passive_capture.js`;
`node20 --test ops/test_terminal_passive_capture.js` passes seven source tests
on complete production class definitions, including throwing-getter controls and
descriptor/reference comparisons. Evidence is in `capture-131`. This is not yet
installed in the browser provider and grants no criterion credit.

Keep one `createTerminalCapture()` instance per page so its WeakMap identities
survive pre/post captures. Pass a plain root containing the named game globals,
`oldSocket`/`oldTimer` (explicit null before retention), and `timerStorage` with
one raw `Storage.getItem(gameSlot + 'timer' + index)` string or null per player.
Do not serialize gameplay objects to construct this root. The capture retains
duplicate/killed units and towns, grid occupancy references, ownership, raw
`interaction.moves`, gold/round/result, control storage, commit, socket and timer
identities. Missing optional scalar storage is explicit `{absent:true}`; the
semantic reader must reject absence wherever a clause requires a value. IDs
are observer-local references, not game IDs or cross-reconnect identities.

Complete the schema before browser integration: external registries, town
production/suburb arrays and any remaining clause-specific fields are not yet
captured. This primitive intentionally makes no complete-board claim. It assumes
ordinary production objects, not Proxy objects with descriptor traps. Read timer
storage using the native read-only Storage API separately; the source tests do
not certify that future adapter. Complete the independent AC2/AC3 reader and
callback receipt contract before refreshing. At AC3 boundaries capture raw unit/town
arrays, killed flags, grid identity/ownership, recipient turn, round, gold,
stored result, commit, socket identity and timer storage for both participants.
Do not invoke `isLost`, `isGameEnded`, packing, `toJSON` or pruning to collect
these values. Read UI control state separately with a tested passive route.

Retain callback event names and counts when saving old production listeners;
record each actual invocation after the first legal move, with nonempty expected
event coverage. Record old socket disconnection, replacement identity and old
timer stopped before and after callbacks. Label callback controls source-tier.
Keep both menu workflows and the real authenticated late packet boundary;
preserve naturally advancing clocks and normal input. Reuse the same four
terminal journeys and two participants, rather than adding a browser matrix.

Complete the independent AC2/AC3 semantic and lifecycle/tier reader against this
explicit capture contract before one affected complete terminal refresh. Bind
all new captures and raw persistence records; reject semantic mutations even
when their hashes are rebound. Then run the actual cumulative consumer on
identical proof with/without complete reviews. Preserve AC1, all five historical
sequence criteria and every non-target disposition. Declare <=45 minutes for
that entire invocation, stop unfinished work at 55 and clean up before 60;
retain real detached OS receipts. The 30-minute estimate in the AC2 acquisition
plan must be reassessed once that implementation is concrete.

Review-114 remains the current selection; review-127 remains historical ancestry.
There is no new criterion credit, provider execution, consumer comparison, or
current-source certification. Counts remain 63 prior obligations, 74 current
criteria and eight self owners from the unchanged baseline (not a rerun).
Full TASK-225 steps 3/4/5/7 remain gated and TASK-225 stays pending.
