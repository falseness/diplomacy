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
fields and raw persisted final round boards. It also checks both original
ten-player intermediate movement documents: revisions 1/11, submitted slots,
all components, whole submitted boards and all ten prepared player states.
It also checks raw movement
receipts, participant slots, phase order, actual AI calls, response bounds,
TAP/exit receipts, cleanup and evidence hashes. Tests corrupt both expected
and observed checkpoint values and rehash the archive, so equality and hash
checks alone cannot make the controls pass.

This is historical semantic evidence. Current source differences are reported,
not ignored. `criterionClosures` is empty: the script does not alter the consumed
crosswalk or certify browser semantics solely from checkpoints. The original
archive does not worker-bind its final verification log, budget, or child-results
receipt; later review hashes must not be described as original worker hashes.

Review each whole TASK-209 criterion independently; G09 is not a prerequisite
for consuming an otherwise complete AC2 review.
The historical provider proves two concurrent browser games, then ten co-op
protocol identities with the competitive browsers. It does not prove two co-op
matches advancing concurrently alongside a competitive game, or a long busy
demon phase across database awaits. The explicit join-mode coverage also needs
mapping to independent provider evidence. Do not rerun this unchanged suite to
claim those missing observations. The TASK-231 natural-clock/death/terminal
recovery gaps remain separate.

The original `green-14` archive has 211 ten-player projected event records,
but **zero ten-player inbound packets**, full event boards or independent
recipient bindings. `wire.jsonl` contains only the browser connections.
The protocol trace's `slot` comes from `v.whooseTurn`, so comparing it with
that same payload cannot detect delivery to the wrong socket. Review-36's
two-human captures cannot establish the original ten-player boundary.
AC2 therefore remains incomplete even when the intermediate-document checks
pass. The report binds `wire.jsonl` and reports these exact counts separately.

The minimal next producer change belongs in `concurrent-games.test.js`'s
`attach`: record each sanitized complete `onAny` body with a stable peer
identity allocated before connection, retained across reconnect, and mapped
to the persisted roster independently of the received `whooseTurn`. Record
the mapping after admission without exposing passwords or user hashes.
Assert every received identity/revision/board against independently authored
state, including all ten recipients after each movement. Keep these new
captures in a fresh bounded provider run; never insert them into green-14.
Freeze the producer and consumer before that dependency-justified refresh.
The original two intermediate documents are present and need no invented
replacement. A complete without/with-clause consumer comparison is gated on
the missing recipient proof; no complete review exists to select yet.

The full TASK-225 gate stays conditional on closing all required prior targets.
These reader reports cannot substitute for the eight full-invocation reports.

The capture-justified refresh is launched with
`python3 ops/run_concurrent_capture.py artifacts/TASK-225/<fresh-name>`.
The observation preload delegates the existing concurrent provider unchanged,
records complete sanitized inbound bodies, and binds stable peers to MongoDB
roster membership using the outbound credential. Reconnection retains the peer
while allocating a new connection identity. All sources must be frozen before
launching; use the `/root/diplomacy` output spelling so the existing historical
evidence guard recognizes the task directory across the workspace symlink.

`review_concurrent_recipients.py` requires every revision 0..20 at every one
of ten roster-bound recipients, independently reconstructs every board, checks
the reconnect binding and both intermediate submitted documents.
`review_concurrent_browser.py` independently checks all received browser boards
and exact move/submission/reconnect input and delivery counts. Copied raw-proof
controls exercise wrong recipient, roster, game, HP, moves, income, missing
revision, missing file, reconnect and browser input defects.

`prepare_concurrent_review.py` combines those readers with the original archive
oracle in a later byte-identical provider selection. Its complete AC2 review is
consumed by `consume_concurrent_review.js` on identical measured sources and
proofs without/with only that review. Missing/tampered copies must be rejected.
Neither capture nor AC2 consumption closes G09, AC3 or the overall TASK-225 gate.
Do not interpret a passed child or a partial report as a passed parent invocation.
