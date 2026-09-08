# Undo-vector ownership in the complete training lifecycle

The completed phase experiment points to baseline evaluation (53.359% of wall
 time). This controlled follow-up tests the named 2a4101e regression suspect,
without changing production. It is distinct from the earlier bounded ownership
study and the completed observation calibration.

Run the existing driver with `--ownership-reversal` and a fresh output directory:

```sh
python3 ai/diagnostics/task102-full-phases.py --ownership-reversal \
  --output artifacts/TASK-102/ownership-phases \
  --node-bin /root/.npm/_npx/ebaba8b9e55fd0a9/node_modules/node/bin
python3 ai/diagnostics/task102-audit-full-phases.py artifacts/TASK-102/ownership-phases
```

The actual predecessor for this experiment is 5ab8bf3. The driver archives HEAD
and makes a second complete source copy with exactly one expression changed:
undo capture copies the current vector with `.slice()`. Undo restoration still
copies back; lookup, predictors, policies, natural retention and fresh contexts
are unchanged. Both source manifests, the exact diff, commands, dependencies,
6144-MiB heap and prospective baseline checkpoint hashes are frozen before games.
The original baseline's historical hash gap remains unresolved.

Predeclared order is control/reversal/reversal/control, one complete canonical
15-game training process each. Coarse observation stays on for every arm; no
candidate tracing, forced GC, concurrent benchmarks, replacement repetitions or
overhead subtraction. The unchanged workload contains evolving teacher/ranking
training and all checkpoint evaluations. Every outcome, example, loss history,
metric and checkpoint must match across all four runs. Full exclusive phases
plus residual must reconcile; GC is clipped/unioned overlap, never additive.

Compare adjacent pairs (control 1 vs reversal 2; control 4 vs reversal 3), all
phase costs, baseline evaluation early (steps 1–7) and late (8–15), boundary
retention/heap/RSS, and baseline GC overlap. A reversal with baseline exclusive
time improving in both pairs, without opposite early/late effects, provides a
consistent mechanism result to assess alongside source-based allocation/lifetime
reasoning. GC differences are corroborating measurements, not proof of pause
savings. Mixed results reject promotion from this experiment; do not pick a
favorable pair, re-run it unchanged, or declare an external blocker. A consistent
result permits candidate verification without requiring the final gain in
advance. These two repetitions per arm are never the median-of-three acceptance
gates. A production candidate still requires actual-predecessor correctness and
both original >=10% speed gates. If unsupported, retain pending and document the
remaining scope decision instead of a hash-only follow-up.

The general auditor validates both original observation and ownership captures.
It checks every source file in both arms and requires the only source difference
to be the exact copy expression; it also requires observation on in all ownership
arms. The resulting summary retains complete early/late trajectories and all
scenario outcomes for independent review. A corrupt-source and failed-exit
negative control must be rejected without modifying the original captures.
