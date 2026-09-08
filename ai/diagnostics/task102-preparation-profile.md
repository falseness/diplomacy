# Frozen preparation attribution

Run with the prior Node 20.20.2 binary and 6144-MiB heap:

```sh
node --max-old-space-size=6144 ai/diagnostics/task102-preparation-profile.cjs \
  artifacts/TASK-102/inference-attribution/capture \
  artifacts/TASK-102/native-intrinsics/checkpoint-fixture \
  artifacts/TASK-102/preparation-attribution/retry/capture
python3 ai/diagnostics/task102-audit-preparation.py \
  artifacts/TASK-102/preparation-attribution/retry \
  artifacts/TASK-102/inference-attribution/capture
```

The output capture directory must not exist. Record the exact command, complete
stdout/stderr and real exit code in the attempt's `profile.log`. The auditor
requires the successful completion marker, every input/output comparison and
source/checkpoint hashes. It does not accept an absent log or incomplete pass.

This diagnostic uses every previously frozen input from six declared scenarios.
It first checks the original capture's tracked sources and checkpoint hashes.
It instruments only an in-memory copy of the production checkpoint predictor,
using unique source anchors that fail if the source changes. The transformed
source is saved for review; no production file or installed module is modified.
Original/instrumented/instrumented/original passes compare every score against
the captured outputs. No repetitions or inputs are selected based on timings.

Timed phases are adaptation, flattening, tensor creation, backend prediction,
read/conversion and disposal. The nested flatten interval is subtracted from
board tensor time to avoid double counting. Remaining bookkeeping appears as
residual. Source loading, input IO, decompression and assertions are excluded.
The four passes expose calibration variation; they do not isolate instrumentation
overhead from JIT, GC and host variation.

After each prediction, the diagnostic also calls the actual canonical runtime
projection function and flattens its output on the same frozen inputs. This is
a preparation-only contrast: no canonical model, fitting or evolving training
is executed. Its array representation comes from deserialization, not a live VM.
Neither path measures either TASK-102 acceptance workload, and large checkpoint
flattening costs do not establish the same opportunity in canonical training.
Keep the task pending until one justified candidate passes both original gates.
