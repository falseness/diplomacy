# Production simulation sampling

This diagnostic narrows the simulation bucket left by the TASK-102 fitting and
checkpoint preparation experiments. It makes no runtime changes. Use Node 20.20.2,
the common 6144 MiB heap and the repository's installed TensorFlow dependencies.
Keep complete command logs, exits and failures in a new TASK-102 directory.

Before running, write `predeclared.json` with the actual `revision`, absolute
repository `root`, SHA-256 `sources` for every tracked file (checked against that
revision's git blobs), `driverHash`, absolute `checkpoint`, and `checkpointHashes`
for its model.json and weights.bin. Copy `component` from the already declared
`artifacts/TASK-102/bounded-profile/component.json`. Set `teacher` to
`{"seed":137087,"stage":0,"games":[1,2,3,4,5,6]}`, `order` to
`["off","on","on","off"]`, and `samplingIntervalUs` to 1000. Record the
environment and worktree status. Never overwrite previous evidence.

For each fixture (`teacher`, then `component`), run four **fresh processes** in
that fixed order, substituting its fixture, mode and unique output prefix:

```sh
node --max-old-space-size=6144 ai/diagnostics/task102-simulation-profile.cjs \
  artifacts/TASK-102/simulation-attribution/predeclared.json teacher off \
  artifacts/TASK-102/simulation-attribution/teacher-1-off
```

The output prefix must be unused. Save each command in `<prefix>.log` with its
complete output and actual `EXIT_CODE: 0` on success. Record commands, exits and
elapsed seconds in the attempt's `checks.json` entries using the prefix basename
as `label`. Audit with:

```sh
python3 ai/diagnostics/task102-audit-simulation.py artifacts/TASK-102/simulation-attribution
```

Teacher runs use the unchanged production expert rollout and labels, not a
checkpoint substituted for its expert. They retain all six results and all 13,511
examples. Component runs use the frozen real checkpoint and predictor, preserving
the six original one-round non-results. All four passes must equal the previously
saved full teacher/component results. Those historical fixtures are independent
correctness references, never a performance baseline. No fitting occurs here.

Inspector samples only the batch. The auditor limits attribution to monotonic
production-call intervals, excluding logging, result hashing and asynchronous
gaps; gzip encoding happens after profiling stops. Raw profiles remain available
for independent analysis. Self time is exclusive; inclusive stack entries overlap
and must not be summed. GC samples do not identify which allocation caused GC.
PerformanceObserver GC durations overlap game time and are reported separately.
Sampling can attribute native work to a JS caller and cannot prove a causal gain.
On/off timing includes host/JIT/GC variation; do not subtract a measured overhead
or select repetitions. Memory observations are before/after samples, not peaks.

This is not evolving canonical training or either median-of-three acceptance
workload. A teacher hot path may be absent from later checkpoint rollouts or
component games. A proposed optimization still needs a justified common cost
contribution, frozen actual predecessor, unchanged policy, complete correctness
checks and both original speed gates. Keep TASK-102 pending if those gates remain
unmet. Do not repeat unchanged full timings on the strength of sampled stacks.
