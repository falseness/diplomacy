# TASK-061 Retraining Decision

Decision: retraining was required and performed. TASK-061's retraining work is
complete; the still-failing tiny 1v1 win-rate requirement remains routed to
TASK-062 rather than being misreported as a passing benchmark.

Evidence reviewed:
- The TASK-059 real-checkpoint smoke passed for 1v1, 3-player, and 4-player maps.
  It used unchanged `AIPlayerWithEconomy` candidates and
  `SimpleAiPlayerWithEconomy` opponents and passed missing-checkpoint, zero-weight,
  and deterministic randomized-weight controls.
- The fresh TASK-062 run selected `tiny deathmatch #1` and seeds 62000 and 62001
  before execution, covered both candidate sides, and counted every completed game.
- The legacy checkpoint won 0/2 games in the fresh TASK-062 gate, so retraining was
  required by the ticket.

Generated-map retraining performed:
- `task061-generated-retrain-20260906` trained from scratch on seeds 61000-61005,
  cycling through 2-, 3-, and 4-player generated town maps.
- `task061-generated-retrain-final-20260906` and
  `task061-generated-retrain-broad-20260906` warm-started the repository's existing
  all-slot checkpoint and trained on new generated town maps.
- Every run used `--map-source town`. Persisted provenance records
  `generateTownTrainingMap`, `generated: true`, and `fixedGamestartMap: false`.
  No `options/gamestart.js` map was training data.
- Each run saved checkpoints, metrics, a manifest, a final model, and a benchmark
  snapshot under `/mnt/storage/diplomacy`.

Checkpoint result:
- The trainer selected its lowest-loss checkpoint for later benchmark reruns:
  `/mnt/storage/diplomacy/checkpoints/task061-generated-retrain-broad-20260906/step-00000009`.
- A fresh TASK-059 multiplayer inference/model-control smoke passed against this
  checkpoint for 1v1, 3-player, and 4-player maps.
- A fresh post-training TASK-062 run still won 0/2 completed games with exact class
  assignments, no crash, no timeout, and no sudden-death non-result. This honest
  failure does not undo completion of the conditional retraining step; it keeps
  TASK-062 pending and must not be described as a passing release gate.

Conclusion: TASK-061 performed the retraining required by the observed benchmark
failure, used generated random maps only, persisted every required training output,
and documents the trainer-selected checkpoint. Complete run logs, reports, hashes,
provenance, controls, and the unresolved TASK-062 failure are retained in
`artifacts/TASK-061`.
