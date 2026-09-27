# TASK-225: preserve the successful provider and failed enclosing run

review-106/provider has an actual OS exit 0, current source/proof hashes and
complete cleanup. Its enclosing launch session returned 143 after the inner
runner printed its planned zero exit; no supervisor receipt survived. The
cause is unproven. Neither the planned exit nor the scoped budget flag makes
that enclosing invocation successful.

`run_four_coop_consumption.js` freshly derives the identical historical
observations, binds their completed consumer record, reruns all source and
consumer corruption controls, and recomputes the complete current cumulative
inventory against the same immutable provider. It changes no reader,
projection, gameplay or original proof. Provider reuse is explicit; the new
output's provider link points at review-106/provider. This avoids a duplicate
browser/network run while obtaining an independent OS receipt for consumption.

Run `python3 ops/supervise_four_coop_consumption.py <fresh-output>` from the
client repository. The supervisor records received termination signals,
forwards them to its owned child group, and never treats an interrupted or
timed-out run as passing. A launch receipt is not a completion receipt; read
process-exit.json for the OS-observed runner status. Full TASK-225 remains
prerequisite-gated even if this 96-to-87 scoped continuation succeeds.
