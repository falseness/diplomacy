# TASK-225: whole smoke AC5 saved-proof review

This review consumes smoke-158/run-03 only. No new services are launched.
The baseline is smoke-bounds-160/run-01 through evidence_smoke_bounds_gate.js.
AC4 acquisition location and AC8 complete invocation remain separate unresolved rows.

Clause map (all paths relative to artifacts unless absolute):

* Positive exits: TASK-225/smoke-158/run-03/{provider-exit,consumer-exit,process-exit,verification-budget}.json and every command receipt named by that budget; provider/child-results.json, full provider/children/001-reliability_smoke-isolation/{stdout,stderr}.log, provider.log and consumer.log. Validate original run paths, exact selected suite, TAP summary, signals/timeouts, and command receipts; later review receipts do not replace originals.
* Intended negative controls: provider/smoke-observations.json request indices 8,9,10,12,13,15 must return exactly error/SMOKE_ISOLATION_DENIED; namespace-adversarial-cases.json, checkpoints.json and TAP must show the corresponding passing parent assertions. The pinned original suite tests three lookup denials with the same exact error code. These are intentional protocol rejections, not unexpected service errors.
* Complete selection/milestones: provider/verification-plan.json is written before credentials or services, as shown by the pinned smoke-isolation.test.js and opt-in smoke_capture_provider.js. All 14 declared cases plus owned-cleanup occur in checkpoints and TAP. Existing bounds and capture readers independently derive actual sessions, fixture admission, persistence, expiry and cleanup, rather than trusting pass booleans.
* No timeout/errors: all original receipts, provider/verification-budget.json and child results. Full server stdout/stderr are combined by the source-bound services.js; services/server.log and child stderr must be error-free. Mongo E/F records fail; known startup warnings are reported separately. No browser runs or browser claims. Read the entire retained streams, not only the old audit's narrow error regex.
* Current sources: independently rehash the provider before/after manifests, pinned capture source, launch/audit/service code and current reviewer closure. Original manifests do not include all opt-in tools; bind their exact bytes separately.
* Original failures: retain TASK-223/green-01 (fixture TypeError), green-03 (co-op authority assertion), green-04 and verifier-20260925T054115Z (tested/committed mismatch), green-05 and repair audit/patch; smoke-158/run-01 (child passed, outer historical-write path guard failed) and run-02 (provider passed, consumer canonical receipt binding failed). Their logs, receipts, source identities and saved tested tools remain immutable and hash-bound. Never classify these failed parents as a successful invocation.

The policy pins exact original evidence and inspected code. Its hashes enforce provenance,
not semantic success. The executable reader independently evaluates AC5 and delegates
network/state/bounds oracles to the already reviewed readers. Selection adds only AC5;
the actual inventory consumer must demonstrate whole-row covered-current transition,
identical non-target rows/research gaps and eight self owners. Corruption tests distinguish
semantic rejection from immutable-original rejection. Full TASK-225 remains pending.
