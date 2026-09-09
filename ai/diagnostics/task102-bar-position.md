# TASK-102 bar-position allocation experiment

The isolated `task102-bar-position.cjs` transform replaces Bar's temporary
coordinate object and `Rect.pos` call with the same two scalar assignments.
The real Rect setter only copies x and y. This applies to construction and later
repositioning without skipping rectangles, rendering, or simulation work.
Production does not import this module.

Run `node ai/tests/task102-bar-position.cjs` to compare real Bar/Rect state and
actual drawing callbacks, including NaN/signed zero, live radius changes,
independent rectangle objects and a wrong-coordinate negative control.
The fixtures remove 1,620 temporary-object setter calls. This is a local
mechanism count, not a measured allocation count for a whole game.

One fixed A/B/B/A screen at actual predecessor
84a7c239840b62cabbe5c339d3e65e1a177b5df9 used complete frozen source trees,
identical dependencies/checkpoint and six teacher plus six component scenarios
per process. No transformation or observation wrapper ran in the timed games.
All 48 complete results match corresponding slots, including 13,511 teacher
examples per process and inference metrics. Bounded mean teacher time improved
0.015290%; component time regressed 11.908130%. Both fail the predeclared >=10%
bounded-mean screen. All four processes exited 0; no repeat was replaced.

The prototype was rejected and production restored. Exact commands, source
archives, prospective hashes, outcomes, timings, tests and audits are retained
in artifacts/TASK-102/bar-position (uncommitted). This screen excludes full
canonical training/evaluation lifetime; it is not median-of-three acceptance,
statistical certainty, or evidence of an external-only blocker. TASK-102 remains
pending. This experiment is closed; do not rerun it unchanged or bank results
against another baseline. A distinct justified production improvement still
requires both original full acceptance gates.
