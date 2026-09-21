# TASK-175 baseline discovery blocker

The once-only standard acceptance invocation on client `30244a77` and server
`90a1176d`, with the seven existing dirty source files preserved, exited 1 during
suite discovery. No child or browser race started. TASK-175 remains pending;
there is no new connection result or historical root-cause conclusion.

The runner discovered `tests/reliability/join-influence-batch.test.js`, introduced
by server commit `90a1176d`, but the registry does not declare it. The file is a
standalone fixture-driven CLI requiring `--fixtures` and `--output-dir`, not an
ordinary registry suite. The registry's strict discovery check correctly rejects
this mismatch before running the selected join-races suite.

Server commit `22c7f9c7` resolved the helper's discovery contract by renaming it
to `join-influence-batch.js`; its explicit fixture/output arguments remain
required. Its offline contract checker passes all 27 checks, including strict
unknown-suite rejection, public-endpoint guarding and original race-suite
selection. Revalidation matched all eight saved checker/oracle source hashes
and all seven unrelated dirty-file hashes. Both repository diff checks passed.

Discovery is now repaired, but this does not supply browser acceptance evidence.
The latest acceptance still has `children=[]` and runner exit 1; race traces,
slot ledgers, attempt manifest, checkpoints and source identities are absent
from that acceptance run. Historical root evidence cannot fill those gaps.
The task's once-only baseline budget is consumed; a new full acceptance run
requires clarification of that stopping rule before execution.
The consumed baseline invocation must not be repeated unchanged or looped until
it passes. The full 70/70 connection acceptance remains outstanding.

Local evidence is linked from
`artifacts/TASK-175/baseline-20260921T022408Z/handoff.md`; the untouched runner
output is in `artifacts/TASK-175/final-20260921T022408Z/`. All evidence remains
uncommitted. No production or test behavior changed in this iteration.
