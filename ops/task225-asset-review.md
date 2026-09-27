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
