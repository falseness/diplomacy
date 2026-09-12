TASK-106 inter-op control (iteration31)

The launcher tests evaluator inter-op2 versus1 with intra-op2, V8 pool4 and
shared CPUs0,1 fixed before native initialization. It uses both saved iteration25
snapshots and the existing two-game boundary harness. Parent/teacher settings,
models, batches, seeds, outputs and results remain unchanged. The auditor checks
source/input bindings, complete outcomes, native settings and model lifecycle.
Launcher and negative evidence controls run without substituting gameplay outputs.

Disposition: REJECTED. Both arms pass four-game parity and clean shutdown.
Four complete cold training runs in2/1/1/2 order preserve39 games,10 fits,
weights/curriculum/configuration and both refreshed hashes. Means508.189332746s
versus469.282995503s save7.655874442%, below10%. Every sample is retained.
Initialized child threads15/15 versus14/14 are the intentional treatment.

Evidence and exact commands are under artifacts/TASK-106/iteration-31, including
frozen plans/source/checkpoint hashes, raw logs and resource observations,
conditional cold launcher/auditor scripts, negative controls and content audit.
The diagnostic comparison is not an actual-production or canonical timing pass.
No production change is justified; TASK-106 remains pending. Conditional full
regressions and canonical median-of-three runs were not reached. Preserve the
six-scenario inherited TASK-063/TASK-156 quality failures and TASK-156 ownership.
Do not rerun this hypothesis unchanged or bank its near miss. Future work retains
the actual-production-predecessor, complete-work, correctness and >=10% gates.
