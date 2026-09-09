# TASK-102 coordinate deduplication diagnostic

Actual predecessor: 2dde898b308bdde38626684c93aa530e3d78341e.
The fast-action changed-cell collector calls addFastActionCoord repeatedly for
action cells, neighbours, undo entities, live units and town summaries. Its
deduplication allocates an x:y string on every attempted insertion. Test replacing
that single dictionary with per-column row dictionaries, preserving insertion
order and independently copied coordinate objects. Dictionaries exist only for
one collection. This is distinct from the closed suburb-expansion lookup study;
suburb lookup, undo ownership, vectors, snapshots and production remain unchanged.
Extra column objects may cost more than the avoided strings. No gain is assumed.

Freeze all tracked source bytes against the actual predecessor, diagnostic tools,
Node 20.20.2, tfjs 4.22.0, dependencies and checkpoint bytes before execution.
Use NODE_OPTIONS=--max-old-space-size=6144 and NODE_PATH=/usr/share/nodejs.
Run the existing six teacher fixtures (137088–137093) and six component fixtures
(10200–10205) in control/candidate/candidate/control order, then an untimed oracle
arm. Save all complete outcomes, teacher examples and inference counts. Compare
the exact ordered coordinate list against the original collector on every fast
action in the oracle arm; also compare complete input/score/command/snapshot
lifetime traces. Test rectangular maps, duplicate coordinates, edges, independent
copies, malformed source and a deliberately incorrect row key. Run movement and
combat invariants with the collector oracle enabled. Reuse source-matched prior
regressions and completed prerequisite evidence for unchanged diagnostic work.

Advance only with exact semantics, >=10% mean improvement in both bounded groups
and positive improvement in both pairs. Otherwise close this hypothesis and leave
pending. These diagnostic means exclude canonical training lifecycle effects and
are not either acceptance median. A passing screen requires a frozen production
candidate, all actual-predecessor correctness checks and both original >=10%
median-of-three speed gates against that same predecessor. Preserve all failures;
never bank historical canonical +20.206355% against a new component baseline.

Teacher and component seed sets are disjoint; arms deliberately reuse the same
fixtures. Checkpoint training seeds are unknown, so no unseen-holdout or learned
strength claim is made. Production expert and checkpoint routing remain unchanged.
