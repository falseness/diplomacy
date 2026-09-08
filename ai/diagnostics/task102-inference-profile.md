# Frozen inference attribution

Continue the bounded profile's declared next experiment with the actual current
runtime and the same six canonical scenarios and checkpoint:

```sh
node --max-old-space-size=6144 ai/diagnostics/task102-inference-profile.cjs \
  . artifacts/TASK-102/bounded-profile/canonical.json \
  artifacts/TASK-102/native-intrinsics/checkpoint-fixture \
  artifacts/TASK-102/inference-attribution/capture
python3 ai/diagnostics/task102-audit-inference.py artifacts/TASK-102/inference-attribution
```

Use the same Node 20 binary and dependencies as the preceding experiment. Capture
complete stdout/stderr as `profile.log` in the parent attempt directory with the
exact command and an `EXIT_CODE: 0` line only after successful completion. The
capture directory must not exist. All tracked sources must match the declared
revision; the auditor checks both git blobs and working files.

The driver serializes every candidate batch before prediction, compresses it,
and preserves every expected output and complete game outcome. Capture overhead
is deliberately excluded from timing claims. All inputs are frozen before four
predeclared replay passes (off, on, on, off). File reads, decompression, hashes and
output assertions occur outside each predictor interval. Every output value must
match exactly, including the uninstrumented passes. The same production predictor
is used throughout; only model.predict and prediction.dataSync are timed in the
instrumented passes.

Residual time includes adaptation, flattening, tensor creation, result conversion
and disposal. It is an upper bound on input preparation, not an isolated measurement
of any one operation. On/off differences also include JIT, GC and host variation;
they are not pure hook overhead. Inputs are replayed as host-owned values, so these
timings do not isolate VM realm effects. Memory is sampled after each pass; the
preceding bounded experiment supplies GC evidence, not this narrower replay.

The checkpoint predictor is substituted for the canonical expert predictor in
this diagnostic. Canonical training's createRuntimeModelPredict uses a different
3x3 projection path, while ai/model.js already flattens into typed arrays. No
runtime fix or >=10% canonical gain follows solely from these replay timings.
Fitting and the actual canonical predictors need applicable attribution before
selecting a fix targeting them. Never use this replay as either required speed
gate, change checkpoint selection after seeing results, or discard failing runs.
