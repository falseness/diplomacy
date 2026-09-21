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

The next implementation should resolve the helper's discovery/registration
contract and its callers, preserving strict discovery and the original race
oracle. Simply registering it without supplying its required CLI inputs is
insufficient. Validate that repair before deciding on a new acceptance run.
The consumed baseline invocation must not be repeated unchanged or looped until
it passes. The full 70/70 connection acceptance remains outstanding.

Local evidence is linked from
`artifacts/TASK-175/baseline-20260921T022408Z/handoff.md`; the untouched runner
output is in `artifacts/TASK-175/final-20260921T022408Z/`. All evidence remains
uncommitted. No production or test behavior changed in this iteration.
