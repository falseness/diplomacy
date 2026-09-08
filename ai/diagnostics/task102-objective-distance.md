# TASK-102 objective-distance allocation experiment

`task102-objective-distance-prototype.cjs` is an explicit diagnostic preload,
never imported by production. Against actual predecessor
`fe140689b1337df685273f8dffd6925cb556e785`, it replaces temporary enemy coordinate
arrays with running minimum distances. It preserves live-unit priority over
towns, ownership/neutral/killed exclusions, signed normalization and no-target
behavior. It does extra town-distance arithmetic when live units exist; avoiding
allocations does not guarantee faster execution.

Use the existing simulation and allocation trace drivers with the frozen
manifests under ignored `artifacts/TASK-102/objective-distance`. The experiment
uses six original production teacher games and six fixed checkpoint component
games, baseline/prototype/prototype/baseline, with separate full input, score,
command, snapshot lifetime and outcome traces. No generic attribution experiment
is repeated. The standalone edge test is
`node ai/diagnostics/tests/task102-objective-distance.cjs`.

The predeclared decision requires positive bounded mean improvements in both
fixtures and more than five percent in the teacher fixture before promotion.
Observed teacher improvement was 2.640291%; component regression was 11.988809%.
This prototype is rejected and must not be promoted or retried unchanged.
These bounded means are not the original median-of-three speed acceptance.
TASK-102 remains pending, with no new full speed cycle justified. The fixed
startup fixtures still do not quantify later evolving-checkpoint self-play or
retained training-example costs in the full canonical command.
