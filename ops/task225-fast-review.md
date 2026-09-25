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
