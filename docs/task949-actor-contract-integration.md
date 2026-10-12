# TASK-949 integration contract conflict

Main TASK-949 remains pending. Its authoritative description requires automatic
demon-phase committed scenarios. Lane P completed six human-seat capture/destroy
scenarios under a separately amended lane contract. Those receipts cannot certify
the main contract as written.

The inspected lane server commits, in order, are:

- `86b64e36439fe32f81a53ca68026ef7d23360c1b`: bounded human diagnostic.
- `8bf41af8f7bffbb467428dc10a5db5215152e977`: human co-op town-raze worker,
  validator, routing, registration and six-row actor override.

The lane client has no scoped task commit. Both server commits were fetched from
`/root/ralph-runs/undo-parallel-20261010T172819Z/P/diplomacy_server` for inspection;
neither was cherry-picked. Existing unrelated work remains untouched.

A read-only comparison of main inventory against the physical lane selection
found exactly the six assigned IDs. Each differs only in its row's `actor`:
`automatic-demon-phase` on main versus `human-seat` in the lane. Additionally,
the lane commit changes these rows' resolved `none` interruption from the generic
same-turn undo text to acknowledged human capture/destruction followed by
committed-boundary undo refusal. This requires an explicit main contract decision.

The policy history supports the lane's diagnosis: client TASK-409 commit
`a39d80be63d0e1604114e9c8d1d2780f61041c3d` intentionally changed demons to capture
towns instead of razing them. Server TASK-419 commit
`f05062f8c14876d89dcca6ed9e6f25c500030e60` aligned the regressions. Current
`tests/coop/town-razing.test.js` still documents capture rather than raze.
Restoring obsolete product behavior is not an integration fix.

Evidence is under `artifacts/TASK-949` (physically `/root/task-evidence/TASK-949`):
`contract-conflict.json`, `contract-check.log`, both scoped commit patches,
`main-selection.json`, `registration.log`, and `audit.log`. The conflict report
records original lane proof paths and hashes; original lane files were not altered.
Main registration passed. No positive family execution, receipt certification,
or matching-input integration claim was made. The audit explicitly lists missing
acceptance artifacts as failures. All six main scenarios remain unresolved.

Next step: resolve whether main adopts the lane's precisely six-row human actor
and committed interruption contract. If adopted, integrate the two scoped server
commits in order, merge registry changes additively, compare relevant inputs,
refresh invalidated proofs with serial bounded main shards, and finish the full
acceptance audit. Do not rerun the diagnostic or reinterpret human receipts as
automatic demon coverage. Do not skip to another task while this task is pending.
