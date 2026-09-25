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
