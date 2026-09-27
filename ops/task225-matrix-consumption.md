# TASK-225 matrix current-proof consumption

The four journeys in `artifacts/TASK-225/review-96/provider` passed with an
OS-observed provider exit of zero and complete cleanup. The enclosing review
failed on a strict numeric lower bound: Firefox recorded
`0.3571428571428571`, one ULP below `5/14`. Production `screen.js` clamps a ratio
then multiplies the old scale, so exact rational equality is inappropriate.
The launch shell separately returned 143 without a supervisor receipt; its cause
is unproven. Neither result is a successful outer review.

`review_matrix_evidence_v2.js` declares a 1e-12 absolute lower-bound tolerance;
strict scale decrease and all other assertions remain. The v1 reader and
provider bytes remain frozen. New v2 modules preserve all recorded source hashes
while binding the independent reader's own exact hash. No source mismatch is
waived. Tests compare both readers on identical proof, and reject a 1e-8
undershoot, no movement in scale, wrong purchase operands and a new page error
after rebinding the mutated proofs.

Run the complete current consumption with no browser refresh:

```sh
python3 ops/supervise_matrix_consumption.py /root/diplomacy/artifacts/TASK-225/<fresh>
```

The runner rechecks the 196 historical assertions against the bound completed
historical consumer phase, retains its failed enclosing receipt, runs all source
tests and eight actual-consumer rejection controls, then recomputes the complete
current inventory chain and every TASK-214 criterion. All previous dispositions,
24 earlier current criteria, eight self owners and research obligations remain.
Use the resulting crosswalk through `evidence_matrix_gate_v2.js` for later
consumption; older preloads omit this extension. Do not replay the completed
provider refresh as a resume command.

`python3 ops/audit_matrix_handoff_v2.py <fresh>` audits the final scoped receipt,
source/proof hashes, numerical samples, transitions and full-report limitations.
A scoped pass is not full TASK-225 completion. The full gate still requires zero
unresolved prior local targets and all eight finalized invocation self checks.
All evidence remains local and unstaged.
