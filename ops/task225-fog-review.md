# TASK-225 fog evidence continuation

`run_fog_review.js <fresh-output>` reviews the selected TASK-212 fog provider,
refreshes only that affected suite, and consumes AC1/2/3 through the actual
`A.inventory` boundary. Use Node 20 with `NODE_PATH=/opt/diplomacy/node_modules`.
Its cumulative stop-work deadline is 55 minutes; the declared estimate is
25 minutes. It is a scoped prerequisite, not the complete TASK-225 audit.

The independent reader uses finite hex-distance relaxation from raw terrain and
recipient-owned units/towns. It imports neither the production visibility code
nor the provider's oracle. It checks both fog settings and modes, exact recipient
snapshots, human-only cooperative sharing, competitive isolation, action/mask
transitions, actual mouse inputs, outgoing commits, durable-round observations,
authentic stale-packet delivery and reconnect/hidden-selection checks. The
negative tests mutate observations after decoding them, so a new hash cannot
turn a semantically wrong mask into a pass.

The original provider is immutable. A separate projection gives the older six
case records exact file proofs; it does not alter the observations, source
identities, selected cases or provider verdict. All original files are enumerated
and hash bound, all projected proof paths go through canonical containment, and
the reader recomputes its report at consumption. Old source mismatches remain
historical. The adapter preserves the complete review-75 selection and consumes
each fog criterion separately, comparing every other disposition and all eight
self-check owners after each transition.

A subsequent complete gate may use this selection with:

```sh
NODE_OPTIONS='--require /root/diplomacy/ops/evidence_fog_gate.js' \
EVIDENCE_AUDIT_REVIEWS=/absolute/reviewed-crosswalk.json \
NODE_PATH=/opt/diplomacy/node_modules /usr/local/bin/node20 \
tests/reliability/run.js --suite evidence-audit --output-dir /absolute/fresh-green
```

Run from `/root/diplomacy_server`, only after zero unresolved required prior
local targets. This does not close TASK-212 AC4/5/6/7/8, G18's whole-match
requirements, G09's predeclared workload/progress requirements, long-phase
coverage, natural-clock/death/result recovery, or the current invocation's eight
self checks. Later tasks remain informational, covered=false. No provider
refresh is authorized by merely seeing an unresolved research label; identify
its exact missing observation and source differences first.

To revalidate already finalized provider proof without another gameplay run:

```sh
NODE_PATH=/opt/diplomacy/node_modules /usr/local/bin/node20 \
ops/verify_fog_selection.js /absolute/reviewed-crosswalk.json /absolute/fresh-review
```

Record this process's OS exit from an external supervisor in `process-exit.json`.
The in-process planned-exit line is not an OS receipt. In particular, review-77's
launch shell returned 143 after its final reports; that launch is retained as a
failed outer invocation, with cause unproven. Its separately measured provider
command exited zero. The revalidator binds that exact command receipt, reruns
independent proof consumption and seven controls, and does not relabel the
failed launch green. No services are started by this revalidation.
