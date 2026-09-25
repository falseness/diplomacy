# TASK-225 concurrent archive review

`review_concurrent_archive.py` reviews the accepted TASK-209 `green-14`
archive without executing production code or changing saved evidence:

```sh
python3 ops/review_concurrent_archive.py artifacts/TASK-209/green-14 /tmp/concurrent-review.json
python3 -m unittest discover -s ops -p test_review_concurrent_archive.py -v
```

The report independently reconstructs the authored boards: town geometry,
territory, two weak starting units for player one, one for each other player,
20/100 categorized portals, one enclosed imp, literal income, legal mover
positions, HP/moves, and round/revision counts. It checks both saved checkpoint
fields and raw persisted final round boards. It also checks raw movement
receipts, participant slots, phase order, actual AI calls, response bounds,
TAP/exit receipts, cleanup and evidence hashes. Tests corrupt both expected
and observed checkpoint values and rehash the archive, so equality and hash
checks alone cannot make the controls pass.

This is historical semantic evidence. Current source differences are reported,
not ignored. `criterionClosures` is empty: the script does not alter the consumed
crosswalk or certify browser semantics solely from checkpoints. The original
archive does not worker-bind its final verification log, budget, or child-results
receipt; later review hashes must not be described as original worker hashes.

Review all eight TASK-209 criteria and G09 together before selecting a refresh.
The historical provider proves two concurrent browser games, then ten co-op
protocol identities with the competitive browsers. It does not prove two co-op
matches advancing concurrently alongside a competitive game, or a long busy
demon phase across database awaits. The explicit join-mode coverage also needs
mapping to independent provider evidence. Do not rerun this unchanged suite to
claim those missing observations. The TASK-231 natural-clock/death/terminal
recovery gaps remain separate.

The full TASK-225 gate stays conditional on closing all required prior targets.
These reader reports cannot substitute for the eight full-invocation reports.
