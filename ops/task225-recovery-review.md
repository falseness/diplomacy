# TASK-225 cumulative asset recovery review

Run from `/root/diplomacy` with a fresh local output directory:

```sh
NODE_PATH=/opt/diplomacy/node_modules /usr/local/bin/node20 ops/run_recovery_review.js /root/diplomacy/artifacts/TASK-225/review-<unique>
```

This scoped continuation retains review-64 AC1/AC2 through their original
adapters and adds complete TASK-211/AC3. It uses the canonical hash-bound
review-60 provider without starting services or replaying browser journeys.
The oracle independently computes recovery movement, income, round reset,
competitive versus shared co-op packets and persisted submissions. It checks
network content identities, recipient ownership, actual UI input records and
exact induced versus unexpected errors. Twelve tests include semantic
corruptions with rebound file hashes; four actual-consumer controls reject
missing/tampered proof and wrong target/release identity.

The output catalog, historical annex, cumulative rows, original provider
binding and prepared projection form one selection. Keep all three consumed
criteria in subsequent continuations. Raw `reviewed-crosswalk.json` alone is
not a complete-gate input. Required prior local obligations, eight invocation
self checks, G09 workload/duration/progress, historical long-phase and
natural-clock/death/result obligations remain; later current task numbers are
informational only. A successful scoped review does not authorize `to-verify`.
