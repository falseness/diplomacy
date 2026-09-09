# TASK-102 command undo resolution experiment

`task102-command-rebind.cjs` tests one source-supported change: in
`AIPlayer.undoCommandSimulation`, resolve the restored cell and check player-unit
membership once per captured identity, instead of repeating both for every
matching command. Resolution remains lazy, so an identity with no bound commands
performs no lookup. The command scan, ordering, identity eligibility and real
undo are preserved. Production loaders never install this diagnostic.

The audit executes the original method, saves its resulting command identities,
restores only the WeakMap bindings, and replays the candidate binding logic after
the same real undo. It compares presence and object identity for every command.
`node ai/tests/task102-command-rebind.cjs` also injects an omitted assignment into
the candidate and requires a real teacher game to reject that fault.

The fixed A/B/B/A comparison uses identical subclass, source-replacement,
script-hash observation and run forwarding paths in both timed arms. A replaces
with identical bytes. B installs the lazy resolution. The oracle is separate
from timing. The replay preserves the prior six teacher/six component fixtures
and complete outputs, including all teacher examples and model inference data.

At predecessor `7d7e1a11115a36cda7ed65b9cf70c6ad64bd1aaa`, the oracle passed
13,988 undo checks and reduced cell resolutions from 227,474 to 13,988. All five
processes returned byte-identical complete outputs. Bounded mean teacher time
changed 25,027.013396 to 25,671.399262 ms (-2.574761% improvement); component
2,009.945912 to 1,857.891599 ms (+7.565095%). The predeclared >=10% mean screen
for both workloads therefore rejected promotion. These are means of two bounded
runs per arm, not canonical acceptance medians.

Teacher pairs disagree (-20.224981% and +12.314960%); component pairs improve
6.155266% and 8.916529%. A dependency inventory read overlapped the second
process, and ordinary editing/read-only work continued during timing. This is a
measurement limitation, not evidence of an external-only blocker, a reason to
discard that run, or a quantified overhead correction. No replacement run was
made. The replay cannot predict the full canonical training lifetime.

Evidence is under `artifacts/TASK-102/command-rebind/`. Its manifest fixes the
source/checkpoint/Node bytes and schedule. `run.py` records exact commands,
exits and wall times. `task102-audit-command-rebind.cjs <directory>` checks all
raw records, complete output equality, script hashes, execution counts, oracle
counts, source hashes and the screen arithmetic. `summary.json` retains every
pair and within-arm range. The negative control and fresh cache spy passed;
unchanged production regression evidence was checked and reused explicitly.

This experiment is closed without a production change. Keep TASK-102 pending:
the original same-predecessor two-workload >=10% median-of-three acceptance gates
remain unmet together. Do not repeat this unchanged screen or bank historical
canonical +20.206355% against another component baseline. A future implementation
requires a distinct justified improvement and both original final gates.

The final evidence self-audit found inherited, unused tree/status fields in the
input manifest. The original file remains intact. A separate provenance
correction records the actual tree/status and verifies the complete archive and
prospective source hashes against predecessor 7d7e1a1. No execution input was
changed and no result was rerun to repair this metadata defect.
