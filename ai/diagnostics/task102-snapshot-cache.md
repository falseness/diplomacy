# TASK-102 immutable snapshot cache diagnostic

Actual predecessor: 43bba281d018353ef61fc02739d4c6593a87d08b.
The earlier allocation study explicitly left this hypothesis untested. It may
reduce snapshot allocation; the full per-channel comparison and frozen-element
access may instead outweigh that benefit. It is distinct from zero-template
construction, lookup, undo ownership, global propagation and search experiments.

No production code installs this cache. WeakMap keys and copied values live in
one fresh VM. Every reuse compares all channels with Object.is, including globals
mutated in place. Changed values get a new frozen independent copy. Old snapshots
must remain intact through subsequent actions and undo. Rows and outer arrays
remain independently owned. Shared cells intentionally reject caller writes;
this API limitation must be resolved explicitly before any production adoption.

Freeze sources, tool bytes, Node, dependencies and checkpoint before running.
Reuse the six existing teacher seeds 137088–137093 and six checkpoint component
seeds 10200–10205 with their unchanged fixtures and Node 20.20.2/tfjs 4.22.0/
6144-MiB heap. Execute control/candidate/candidate/control, then an untimed oracle
arm, saving all complete outcomes and teacher examples, input/score/command and
snapshot lifetime traces. Reuse the existing bounded replay/audit tooling through
explicit generated copies with only intervention/import/marker names changed;
archive those copies and diffs. Do not compare timings across older experiments.

Advance only if exact semantics hold, both bounded means improve at least 10%,
both pairs improve, and the API limitation is resolved. Otherwise reject and
close this hypothesis without full acceptance retries. The bounded screen is
not either required median-of-three gate. Any future production candidate still
requires both original speed gates against this one actual predecessor, all
20-seed determinism and prescribed regression/isolation checks. No historical
canonical pass can be banked. Do not change policy, models, seeds or thresholds.

This is representation equivalence, not a learned-strength claim. Training seeds
of the component checkpoint are not known; no unseen holdout claim is made.
