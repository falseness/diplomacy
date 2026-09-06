# TASK-061 Retraining Decision

Decision: retraining was required and performed, but TASK-061 remains blocked by the
required tiny 1v1 gate.

Evidence reviewed:
- The TASK-059 real-checkpoint smoke passed for 1v1, 3-player, and 4-player maps.
  It used unchanged `AIPlayerWithEconomy` candidates and
  `SimpleAiPlayerWithEconomy` opponents and passed missing-checkpoint, zero-weight,
  and deterministic randomized-weight controls.
- The fresh TASK-062 run selected `tiny deathmatch #1` and seeds 62000 and 62001
  before execution, covered both candidate sides, and counted every completed game.
- The legacy checkpoint lost 0/2 games, so retraining was required by the ticket.

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
- The predeclared final broad checkpoint was
  `/mnt/storage/diplomacy/checkpoints/task061-generated-retrain-broad-20260906/step-00000012`.
- It passed the TASK-059 multiplayer inference/model-control smoke, but the final
  tiny gate still lost 0/2 completed games with exact class assignments, no crash,
  no timeout, and no sudden-death non-result.
- Therefore no checkpoint is selected as passing for later benchmark reruns.
  Step 12 above is retained as the latest evaluated checkpoint, not as a passing
  release candidate.

Conclusion: TASK-061 must remain pending. Marking it ready would require converting
real losses into wins or shopping for favorable seeds/checkpoints, both prohibited
by `artifacts/prevent_cheating.md`. Complete run logs, reports, hashes, provenance,
controls, and failure states are retained in `artifacts/TASK-061`.
