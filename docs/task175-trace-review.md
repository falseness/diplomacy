# TASK-175: review of the seven post-discovery failures

TASK-175 remains pending. Read-only review of the immutable
`final-after-discovery-20260921T024003Z` run confirms a failed runtime gate:
63/70 repetitions passed; runner and child exited 1. This review ran no browser,
service, discovery checker or acceptance experiment and changed no production code.

## First failure: coop-10-02

The p9 wire trace has engine-open packets at page-local sequence numbers 4 and 9
(both polling). Join packets at sequences 6 and 10 have the same payload SHA-256,
`1ca995e4d7a98292982a88426bab3c2859feee70769922af7062c7f0f7745727`.
Only sequence 16 contains its opening board, `waitYouTurn`. The record agrees:
two engine opens, two joins, one board, and no browser error for this repetition.
The second connection's trace includes probe/probe-response/upgrade packets at
sequences 12–14; the earlier connection has probe traffic but no recorded upgrade
packet before the second open.

The server records p5,p10,p8,p7,p6,p4,p3,p2,p9,p1,p2,p9. Both p9 requests resolve
to player index 9 in the same game; the intentional p2 duplicate resolves to
index 8. The server creates the game once. A disconnect/connect appears before
the last join, but those generic log lines lack socket/page identifiers and
cannot independently identify which connection closed or why.

Wire sequence numbers are per page. Wire timestamps describe observation, not
server processing or browser callback execution. The record's firstJoinSentMs
comes from the join barrier's release/bypass observation, whereas wire rows are
recorded separately. Their differing timestamps do not prove transport delay,
a missed heartbeat, or a timeout. Sanitized engine session IDs are `*`, so distinct
session identity cannot be reconstructed from those packet bodies alone.

## Twelve-player failures

Counts below come from each archived record; all listed pages received one board.
All seven failed repetitions still passed allocation and opening-board assertions.

| Repetition | Pages with extra engine opens (total opens) | Extra join observations | Server joins | Browser errors |
| --- | --- | --- | --- | --- |
| coop-12-05 | p7 (3), p11 (3) | none | 13 | four CLOSING/CLOSED errors |
| coop-12-06 | p3, p4, p5, p6, p8, p11 (2 each) | p5 sends 2 | 13 | one CLOSING/CLOSED error, p4 |
| coop-12-07 | p2-dup, p3, p7 (2 each) | none | 13 | none |
| coop-12-08 | p2, p2-dup (2 each) | none | 13 | none |
| coop-12-09 | p1, p2, p2-dup (2 each) | none | 13 | none |
| coop-12-10 | p1, p3 (2 each) | p3 sends 2 | 14 | none |

In coop-12-06 the client records two p5 join packets while the server order
contains p5 once. A recorded client send is therefore insufficient proof of two
server handler invocations. The evidence does not explain why the second send lacks a corresponding
server-order entry. Extra engine opens are also insufficient proof of duplicate game allocation
or duplicate joins: several affected pages sent just one join.

## Evidence and next scope

Local review evidence is in `artifacts/TASK-175/trace-review-20260921/`:
`seven-failures.json`, `p9-wire.jsonl`, `proof-inventory.json`, dirty hashes and
`verification-v2.log`. The first review script failed while treating a checkpoint
container as an array; its log is retained. The corrected reader uses the saved
failed-checkpoint array. Neither reader executes the program under test.
The follow-up audit records the corrected negative-control grep separately.
All 482 archived raw proof hashes match; eight saved discovery hashes and seven
unrelated dirty hashes match. Current measured source bytes have no delta.
The historical 49-capture visual review remains evidence from the acceptance
handoff; this text review makes no new visual claim. NUL-padded activity logs and
the unobserved browser CDN response remain the disclosed capture limitations.

The cause of the extra connections is unobserved. No host/CDN attribution or
production fix follows from these records. The concrete next scope to authorize
is a lifecycle-correlation diagnostic design: specify per-page socket/engine
identifiers, connection/close/error reasons, join emit versus server receipt,
and clock/observer semantics needed to distinguish reconnect from duplicate
observation and explain the coop-12-06 discrepancy. Review that design against
existing instrumentation before selecting a bounded experiment. The current
scope does not authorize executing it, another full gate, or altered limits.
Keep batching, final isolation, forwarding fix and every original assertion.
Do not repeat this completed trace review as the next iteration's work.
