# Smoke isolation archive review

The independent TASK-225 review of `TASK-223/green-05` is saved at
`artifacts/TASK-225/smoke-155/run-02`. This is an offline inspection of another
candidate from work-order-151, not a new provider or cumulative consumer run.
The selected crosswalk remains `ac6-154/run-03/reviewed-crosswalk.json` with
`evidence_terminal_ac6_gate.js`. The saved 133 prior obligations and eight self
owners are unchanged; no new inventory count is claimed.

`inspect_smoke_archive.py` verifies all 27 archived evidence hashes against a
separately supplied coverage-report digest, then derives 16 assertions from
the raw sentinel Mongo snapshots. Two ordinary and two run-B accounts belong
to their respective games, with distinct identities and consistent namespaces.
The complete games, accounts and unrelated database sentinel are preserved
across cleanup. The checker ignores saved pass flags. Its eight source tests
reject corrupt memberships, namespaces, missing games, altered sentinels,
changed or missing files and escaping symlinks. Empty bound files are accepted.

All 936 provider source hashes were compared with current files: 13 differ,
including client `player.js` and server `server/index.js`. Historical proof
integrity and current-source validity remain separate. The existing terminal
freeze (1,233 provider, 20 acquisition and 54 reviewer entries), the AC6 reader
identities, and the selected crosswalk were independently revalidated.

No complete TASK-223/AC1, AC2 or AC3 row is established. The historical trace
records forged **key names**, not values, and lacks request/event timestamps
and socket identifiers. The raw sentinel snapshots omit run A, whose removal
is represented by count assertions. The expired-turn nonmutation assertion
does not retain its before/after documents. These are missing independently
reviewable observations, not newly demonstrated failures of server isolation.

Before a changed acquisition, finish a whole implementation review binding
authentication, immutable socket state, matchmaking, lookup and cleanup to the
frozen provider code. Capture redacted request values, session identity,
allowlist expiry and event times; preserve run-A and expired-turn documents;
inventory owned collections and their contents before and after cleanup; and
review secret exclusion independently. Bundle these observations in one
changed bounded run. Resolve the literal TASK-223 acquisition location versus
this iteration's TASK-225-only evidence constraint before launching it. Do not
copy the old archive, waive stale hashes, grant partial-row credit or repeat
the unchanged inspector as a way to close a criterion.

The scoped verifier completed in 4,751 ms with actual exits 0 for source tests
and both repository diff checks. Inspector exit 2 is the declared insufficient
proof result and was asserted by a zero-exit parent. The initial path-binding
startup failure is retained in run-01. No service was launched. Full TASK-225
steps 3/4/5/7 remain prerequisite-gated, and the required-artifact audit marks
missing full reports and scoped substitutes as unsatisfied.

Inspector invocation (use a fresh output file):

```
python3 ops/inspect_smoke_archive.py ARCHIVE COVERAGE_REPORT_SHA256 OUTPUT_JSON
python3 ops/test_inspect_smoke_archive.py
```

The inspector always reports insufficient whole-row proof; it is not a
coverage-selection writer. A future whole-row reader must consume newly
sufficient evidence through the real cumulative auditor before changing any
disposition.
