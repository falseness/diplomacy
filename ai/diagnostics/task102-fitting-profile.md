# Frozen canonical ranking attribution

Run the diagnostic with Node 20 and the same 6144 MiB heap as prior TASK-102
measurements. The output capture directory must not exist:

```sh
node --max-old-space-size=6144 ai/diagnostics/task102-fitting-profile.cjs \
  artifacts/TASK-102/native-intrinsics/measurements/canonical-training-after-1/checkpoints/task102-canonical/step-00000001 \
  artifacts/TASK-102/fitting-attribution/capture
python3 ai/diagnostics/task102-audit-fitting.py artifacts/TASK-102/fitting-attribution
```

Save the complete first command output as `profile.log` in the parent attempt
directory, with its command, environment, actual exit code and monotonic elapsed
time. Freeze all existing tracked sources against HEAD before executing. The
driver records its own hash separately when newly added. Never replace an earlier
attempt or discard failed passes.

This captures the first six startup teacher scenarios at canonical seed 87087,
using the production expert rollout and expert labels. It preserves all examples,
outcomes and input hashes before any fitting measurement. It then reloads the
same saved canonical step-1 checkpoint for each of four fixed passes: original,
instrumented, instrumented, original. Production ranking uses 20 epochs, batch
size 128 and no shuffling. The hook forwards every fit argument and return value;
every epoch loss and all resulting model weights must match exactly. The auditor
reconstructs pair counts independently and checks the saved weight bytes.

The fit hook measures the asynchronous TensorFlow fit call including scheduling;
the residual includes pair construction, tensor/model construction, compile and
disposal. Memory and overlapping GC observations are recorded per pass. The
on/off comparison includes JIT, GC and host noise, so it is not an isolated hook
overhead measurement and no correction is subtracted. Fresh checkpoint models
reset weights and optimizer state between passes; TF's global engine and JIT
remain shared. Production ranking's auxiliary models are left to their existing
lifetime behavior, so later-pass memory is not an independent leak measurement.

This is a six-game fixed-data diagnostic. Startup actually has twenty games and
different initial weights; later training evolves weights and datasets. It does
not measure synthetic pretraining, curriculum evaluation, or either required
speed gate. The checkpoint came from the first saved candidate canonical run,
step 1, chosen before results; it is not a holdout. Expert rollout uses no learned
inference, as in the unchanged production startup. No strength or model-ablation
claim is made. A fitting-only change would not speed up the separate runGame
component workload. Do not promote these times into canonical cost shares or
rerun unchanged full speed gates based on this diagnostic alone.
