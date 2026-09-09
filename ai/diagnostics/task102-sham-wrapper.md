# TASK-102 finite sham-wrapper calibration

`task102-sham-wrapper.cjs` installs a diagnostic identity intervention only when
explicitly requested. Production imports no diagnostic. `task102-sham-replay.cjs`
keeps the frozen coordinate-dedup six teacher and six checkpoint scenarios,
result lifetime, inference source and per-game timing boundaries.

A has no intervention subclass. S uses the coordinate intervention's subclass,
filename dispatch, unique fragment replacement (with identical bytes) and
`runInContext` forwarding, with no oracle callback. A common constructor Proxy
below the optional subclass records the bytes actually passed to `vm.Script`.
A common prototype observer checks that every executed script was recorded and
counts executions. S additionally counts its replacements and forwards to prove
installation. These observers are instrumentation: measured differences apply
to this observed harness and include the two small S counters, not a precise
unobserved wrapper cost. No observed time is subtracted from another experiment.

The frozen artifact runner performs eight isolated processes in A/S/S/A then
S/A/A/S order. It stops on any process failure, script mismatch or complete-output
mismatch, retaining the failure without a replacement. Hashes bind the actual
predecessor, source, checkpoint, Node binary and installed dependencies. Complete
results, teacher examples, per-game timings, inference counts, script hashes and
execution counts are retained for every process.

Per-game clocks include predictor creation and the synchronous game/teacher
call, including fresh context startup. They exclude result hashing, console
output and inter-game yields. `startupMs` starts just before manifest validation
and ends after module/checkpoint load, before the first game; browser compilation
occurs during the first game. `totalMs` includes startup, game loop, model disposal
and compressed result writing, but excludes the final record write and process
exit. The runner's wall clock brackets process launch through exit. Startup is
therefore not a pure browser-context-startup measurement. Every boundary is
reported separately with oriented adjacent-pair differences, block means and
within-arm range; four pairs cannot establish statistical certainty.

Reproduce with the archived `artifacts/TASK-102/sham-wrapper/run.py` only in a new
evidence directory and only if a later task explicitly authorizes repetition.
Audit existing captures with:

```
python3 ai/diagnostics/task102-audit-sham.py artifacts/TASK-102/sham-wrapper
node tests/task102-sham-wrapper.cjs
```

This calibration never changes policy or establishes learned strength, an
external-only blocker, a production optimization or final speed acceptance.
Final task disposition and measured effects are in the task evidence decision.
The original two >=10% median-of-three gates remain mandatory.
