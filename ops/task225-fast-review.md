TASK-231 execution evidence for TASK-225
=====================================

`review_fast_archive.py ARCHIVE --output REPORT` checks the literal bounded
30-case selection, nine child results, raw TAP, discovery, source identities,
shared deadline, and process cleanup. `--historical` permits source differences
but reports them explicitly. It does not establish gameplay semantics from TAP.

`prepare_fast_review.py ARCHIVE REVIEWS NEW_OUTPUT` requires current sources and
prepares only TASK-231/AC1 execution review. Original archive files and
indexes remain unchanged. The actual evidence-reviews inventory must consume the
result before claiming that criterion covered-current. AC2, AC3, AC4 and AC5 need
separate review; final budget/log receipts are read and hashed by the reader but
are absent from the original worker index, so this preparation does not close
AC3 or AC5. Do not manufacture a historical final receipt binding.

Run `python3 -m unittest discover -s ops -p test_review_fast_archive.py -v` for
copied-real-archive controls. The copies explicitly rebase paths and rehash
mutations; they are synthetic corruption workspaces, not gameplay invocations.

Final receipt selection
-----------------------

`prepare_fast_receipts.py ARCHIVE REVIEWS NEW_OUTPUT` addresses AC3/AC5 using
an explicitly later selection of a completed, current-source TASK-231 run. It
preserves every original file and keeps the original coverage and worker index
under `original-*` names. Only coverage proof paths become relative paths so the
existing consumer can enforce containment in the selected directory. It indexes
the completed log/budget now; it does not claim the worker originally bound them,
rewrite timestamps, or execute gameplay again.

`validate_selection()` recomputes the original execution review, checks every
original/copy hash, requires the exact coverage projection, and recomputes the
later index. Tests include rehashed receipt/review/case/tier changes, wrong runs,
missing files and path escapes. Run:

    python3 -m unittest discover -s ops -p test_prepare_fast_receipts.py -v

The environment variables `TASK231_RECEIPT_ARCHIVE` and `TASK231_RECEIPT_REVIEWS`
select explicit real inputs. Defaults identify the retained review-27 provider
and crosswalk. Selection is prerequisite review evidence, not a complete
TASK-225 invocation. Actual inventory consumption is required to measure closure;
AC2/AC4 gameplay and reproduction semantics still need separate review.

Original failure linkage
------------------------

`review_fast_regressions.py HISTORY ARCHIVE SELECTED REPAIR_PATCH OUTPUT`
reviews the retained TASK-231 `repro-*` logs alongside original `green-05`
and the unchanged current parent. `SELECTED` is the later receipt selection;
`REPAIR_PATCH` is the output of `git show 3fc3c7481fb26392245f127a5e17bf8ab6b2cbee`
in the server repository. It classifies all 29 original focused failure records,
retains their historical source identities, and links exact passing TAP lines
from both positive runs. It independently checks two-peer version-4 metadata,
14x14 grids, reconnect state and salary arithmetic from raw evidence.

This reader deliberately emits `criterionCovered: false`. The saved readiness
failure used 15000ms while the repair changes the default to 60000ms; neither
TAP nor the retained checkpoints measures that individual readiness wait.
The intermediate `expectedMap` call in repro-05 is also absent from the repair
commit diff. The report records the focused observation/provenance work needed
before AC2 can close. AC4 retains paused timers, runtime board mutation and
45x11 fixture limitations. Nothing here promotes memory persistence to MongoDB
or controlled fixtures to natural browser coverage.

Run `python3 -m unittest discover -s ops -p test_review_fast_regressions.py -v`
against the retained local archives (or set `TASK231_REGRESSION_REPORT` to an
explicit report). Controls delete/substitute original and regression proof,
omit cases, and reject false coverage promotion. A negative TAP line must never
satisfy a positive marker. `validate()` rechecks report bindings; `build()`
recomputes the independent observations. Neither replaces actual consumer review.

Resolving the two AC2 subclauses
-------------------------------

`review_fast_map_repair.py HISTORY RETAINED_RECORDS CURRENT_SOURCE OUTPUT`
reconstructs the transient browser-online edit from the saved baseline. Both
reconstructed files must match the original repro-05/repro-06 source hashes.
The retained edit records are checked against the original session records,
without executing their contents. The repair replaced the temporary
`expectedMap(...)` call with literal dimensions; it did not restore an export.

`task225-readiness-preload.js` instruments only the menu/assets readiness wait
in the unchanged browser-reconnect suite, forcing the original 15000ms bound
and recording monotonic elapsed time. Set `TASK225_READINESS_LOG` to a fresh
JSONL path and run the suite with Node's `--require` under the existing owned
process supervisor. This remains a controlled browser fixture with memory
persistence. It does not resolve AC4 or TASK-225 AC6.

`prepare_fast_regressions.py BASELINE PROBE OUTPUT` validates the original
linkage review, map repair provenance, eight readiness waits, eleven unchanged
gameplay checkpoints, literal successful command, raw log and owned cleanup.
It adds later proof to a fresh copy of the selected archive and prepares AC2
for actual consumer review. Original archives and source files stay unchanged;
the separate readiness run is explicitly not part of the original parent run.
The TASK-230 clause retains its independently consumed remote proof.

Run `python3 -m unittest discover -s ops -p test_fast_regression_supplements.py -v`
for the retained real-proof controls. The review-30 artifact inputs are required.
