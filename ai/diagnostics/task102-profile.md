# TASK-102 bounded attribution replay

Run this diagnostic before selecting another TASK-102 runtime optimization. It
archives complete actual d1af585 and 6f280fc trees and refuses to reuse an output
directory. It never invokes the full training measurement wrapper.

```sh
python3 ai/diagnostics/task102-profile.py \
  --artifacts artifacts/TASK-102/bounded-profile \
  --checkpoint artifacts/TASK-102/native-intrinsics/checkpoint-fixture \
  --node /root/.npm/_npx/ebaba8b9e55fd0a9/node_modules/node/bin/node
python3 ai/diagnostics/task102-audit-profile.py artifacts/TASK-102/bounded-profile
```

The fixture is declared and hashed before execution: the first six starts from
`native-intrinsics/measurements/canonical-training-before-1-outcomes.jsonl`, plus
six separately labelled component seeds 10200–10205 with the measurement driver's
unchanged map/classes/limits. The saved canonical starts used an expert predictor.
Replay explicitly replaces that predictor with one frozen real checkpoint on both
revisions, retaining every other scenario parameter. This is neither evolving-model
training nor evidence of either acceptance speed gate or learned strength.

Each fixture runs before/after retaining batches, then after/before discarding
batches. Two additional after-revision batches disable timing hooks to calibrate
instrumentation. Each batch is a fresh Node process with the same dependencies,
checkpoint, and 6144 MiB heap. There are no discarded or selected repetitions.
Instrumentation wraps exported context creation, browser loading and detachment
before the harness imports them, and wraps the checkpoint predictor. It does not
change action selection, limits, results, or cache behavior.

`gameMs` sums monotonic runGame intervals; logging, outcome encoding, and memory
sampling occur outside those intervals. Browser loading includes the first
read/compile cost. Residual time includes simulation, harness setup and model
injection. GC time overlaps phase times and must not be added to them. Memory
samples are taken before/after games, not continuous peak measurements. GC
performance entries are delivered between games. Retaining mode keeps the original
complete result objects through the batch; both modes preserve host-owned JSON
copies for outcome accounting. This keeps audit storage comparable while testing
original result retention.

On/off calibration is a single ordered pair per fixture/mode, so its difference
includes host, JIT and GC variation as well as hook overhead. Do not subtract it
from timings or interpret it as an isolated overhead estimate. Phase costs provide
bounds for this replay only. Fitting requires a separate frozen-data experiment
if a proposed change targets training time.

The auditor verifies git blobs, checkpoint/fixture/driver hashes, full outcome
hashes, all 72 results across the 12 processes, positive canonical rounds and
inference, retention
counts, phase arithmetic, complete log markers and successful exits. Its PASS means
complete diagnostic evidence. It does not mark TASK-102 ready for verification.
The unchanged one-round component reports roundCount=0 and nonResult=true, while
still executing checkpoint inference. Those non-results remain in the accounting;
they are not substitutes for the positive-round canonical replay.
