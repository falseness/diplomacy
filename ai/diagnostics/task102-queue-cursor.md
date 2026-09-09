# TASK-102 queue cursor experiment

Freeze actual predecessor adf6a53392547f9d57c00d61ccf86909dd27e60f.
Production stays unchanged. This is a distinct algorithmic intervention on
Way.create, not another passability, lookup or allocation-ownership experiment.
Historical bounded samples put Way.create at 11.67–12.13% inclusive teacher time;
the completed full-process study puts simulation/evaluation at 91.44%. Neither
number predicts this intervention's gain. Source inspection finds two FIFO
queues consumed with Array.shift in Way.create. Indexed reads avoid repeated
front removal. Current notUsedHandler implementations only append to these
queues; none inspect their length or consumed entries. Main-queue priority must
remain intact when an enemy-queue visit enqueues new ordinary work. Queues remain
local to the call; all visited coordinates are already retained by search state.
VisionWay and InfluenceFieldWay are outside this intervention.

Before execution, freeze all tracked sources, new diagnostic files, checkpoint
bytes, Node binary and this protocol in queue-cursor/manifest.json. Use explicit
Node 20.20.2 with 6144 MiB heap. Replay the existing six teacher and six component
fixtures in control/candidate/candidate/control order, then an untimed audit arm.
No repetitions may be replaced. Each arm keeps complete returned outcomes and
all teacher examples. Audits compare exact ordered visited coordinates, complete
distance/parent arrays, and ordered border callbacks for every real Way.create
call. Run affected movement/combat invariants with this oracle, plus focused
priority/re-enqueue, empty queue, boundary and deliberately broken controls.

Promotion requires exact equality and at least 10% mean improvement in both
bounded groups, with positive effects in both pairs. This screen is diagnostic,
not either full acceptance gate. A rejected screen ends this intervention; retain
pending status and do not repeat it unchanged. A passing screen needs evolving
early/late checkpoint evidence before production promotion and all original
actual-predecessor correctness and median-of-three acceptance steps.

Same fixtures intentionally overlap between arms; teacher seeds 137088–137093
and component seeds 10200–10205 are disjoint. Checkpoint historical training seeds
are not established. No model-strength/holdout claim or model ablation is needed
for queue mechanics. No policy, ranking, predictor or result accounting changes.
