# TASK-225 retained asset prerequisite review

Run the read-only checker against the preserved TASK-211 green-07 archive:

```sh
python3 ops/review_asset_archive.py artifacts/TASK-211/green-07 5580af417e65f71de3811ecb46e569a528431e1f241017a326a1af7bcc349f98 artifacts/TASK-225/<fresh-review>/asset-observations.json
python3 ops/test_review_asset_archive.py
```

The fixed manifest hash binds the original proof selection; proof hashes alone
must not be trusted after edits. The checker compares served HTML and local
response hashes to the frozen source identities, cold/warm dependency hashes,
cache instrumentation, delay observation, failure/recovery ordering, receipt
prefixes and unexpected browser errors. Receipt files precede the later identity
reconnect: they must equal the aggregate trace prefix; the checker also examines
subsequent response hashes. Copied corruption controls rebind their changed
files to exercise semantic checks beyond manifest integrity.

The result records every current-source mismatch without confusing staleness
with failed historical gameplay. It does not review versions, screenshots,
completed turns or persistence, and it does not consume a whole criterion.
`assetObservationsPass` is deliberately distinct from `currentSourceValid`,
`wholeCriterionClosure`, and `fullAuditReady`. The latter two remain false.
The original provider uses CDP continueRequest after delay and route abort for
failure; this reader does not replace dependencies or launch services.

Continue from review-50's validated catalog selection. Freeze dependencies before
any justified bounded assets-versions refresh; review remaining clause ownership
and integrate complete proof through the validated adapter. G09 and all other
unresolved obligations remain. Never use this partial report as the full gate.

The complementary retained compatibility reader reviews both legacy rejection
sequences, protocol upgrade/round milestones, and the post-rejection MongoDB
snapshot. It reconstructs the unsubmitted components from the declared fixture,
including exactly-once income, instead of trusting prior expected/pass fields.
It also binds the actual TASK-065 archive and release manifest and compares the
archived and candidate served-source maps. No archive is extracted or executed.

```sh
python3 ops/review_version_archive.py artifacts/TASK-211/green-07 5580af417e65f71de3811ecb46e569a528431e1f241017a326a1af7bcc349f98 artifacts/TASK-225/<fresh-review>/version-observations.json
python3 ops/test_review_version_archive.py
```

Twenty tests include the retained asset checks and new corrupted-message,
missing-rejection, premature-board, wrong-recipient, missing-upgrade,
changed-pairing, altered served-source, double-income and fabricated-commit
controls. Corruption copies deliberately rebind proof hashes to exercise semantic
rejection. The unchanged real archive is the positive control.

This reader does not establish full gameplay correctness after upgrade or on the
old server. Pairing labels still require runtime identity review; screenshots
and complete persisted-turn checks remain explicit follow-ups. An observed
post-rejection snapshot is independently checked against the fixture, but the
original before/after equality alone is not used as its oracle. Historical
source differences remain reported, and whole-criterion/full-audit flags remain
false. Do not transfer this proof to current TASK-230/231 definitions or change
the review-50 catalog selection on the strength of this partial report.
