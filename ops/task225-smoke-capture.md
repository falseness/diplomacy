# Supplemental smoke proof

`python3 ops/supervise_smoke_capture.py artifacts/TASK-225/<fresh-run>` owns one
cumulative 55-minute work deadline and 60-minute cleanup limit. This scope does
not authorize the prerequisite-gated full TASK-225 audit.

The provider is the existing `smoke-isolation` runner with an explicit
`SMOKE_CAPTURE=1` / `NODE_OPTIONS` preload. `smoke_capture_provider.js` accepts
only the pinned original test bytes, preserves original assertions and real
service calls, and adds observations at request/response, expiry and cleanup
boundaries. It does not patch production handlers. The declared initial cleanup
fixtures are an orphan run-A account and an unrelated turn sentinel. The actual
game/turn requests remain the original suite's requests. Complete collection
inventories are retained even when a collection has no run-owned records.

The observer retains hashed identity-to-run/expiry mapping (not credentials),
actual forged values, socket and Engine.IO session identifiers, real event
timestamps, expired game documents, all game/user/turn inventories and the
unrelated database sentinel. Its final scan compares saved text against the
actual generated credentials and private-key markers. The original suite also
sanitizes service logs. No browser behavior is claimed.

`review_smoke_capture.js` derives expected run membership, game separation,
immutable session use, forbidden requests, expiry timing, state preservation,
and exact cleanup from these raw records. `smoke_capture_policy.json` binds the
completed policy review and current production paths. The reader requires
actual provider/child exits, the opt-in installation hash, current tested
sources, complete original cases and cleanup. Original provider files are not
rewritten; a new independent report and its manifest are added after capture.

`evidence_smoke_gate.js` first recomputes the retained AC6 selection, then
`evidence_smoke_selection.js` passes absent/present whole AC1, AC2 and AC3 rows
through the existing cumulative consumer. Each arm uses the same source and
provider inputs. Every non-target disposition, research gap and all eight self
owners must remain equal. Historical freshness changes are reported separately
from new criterion closures. The wrapper records actual OS receipts and retains
all failed runs. It never treats a provider or source-only pass as consumption.

AC4 stays unresolved: supplemental acquisition under TASK-225 does not satisfy
its literal TASK-223 acquisition path. Other terminal location, board-size and
original-invocation gaps also remain independent. The active crosswalk must not
advance unless the consumer and outer runner both exit zero and the final
source/evidence audit passes.

Run-01 exposed an outer-runner path bug: Python `Path.resolve()` canonicalized
the provider path outside the legacy runner's lexical evidence-root comparison.
The real child passed, but the parent correctly exited nonzero under its
historical-write guard. `Path.absolute()` now preserves the same lexical root
used by existing acquisition runners. The failed receipts and tested tool bytes
remain under `artifacts/TASK-225/smoke-158/run-01`; no historical waiver was added.
