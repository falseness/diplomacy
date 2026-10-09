# Final 13-mission tutorial audit (TASK-770)

The combined tutorial revision passes the 13-mission audit. Gameplay inputs are client `95a080ad971ed8603e6ca6b31aa9ad004ca7041f` and server `ea551e994224dca5e1d8b38a9b3e9fd62a712394`; this audit adds documentation only. Local proof is indexed in `artifacts/TASK-770/evidence-index.json` and is deliberately uncommitted.

The active stable IDs, in display order 1–13, are `tutorial-1,2,3,14,5,6,7,8,9,10,11,13,15`. Economy retains ID 14 at display position 4. Removed IDs 4, 12 and 16 do not complete or launch another mission. Existing ID-14 completion and surviving completions are retained.

Shipped-page smoke passes 155 assertions, including all 13 starts, victory transitions, stored checkmarks and zero page errors. These forced victory transitions establish UI behavior only. Four registered guard groups cover 4/4/3/2 missions, 130 games in total, without exclusions. Map validation, static registration and rules-manifest checks pass. This evidence is reused from TASK-769 after comparing all 1,489 tracked input hashes, the Node binary, dependency lock and original complete outputs. No discovery or rules inputs changed in this audit.

All 13 balance harnesses have matching final-input evidence. Twelve were run on the combined revision; the economy run is reused from TASK-769. Tutorial 1 tests twenty seeds per policy; the other harnesses test seed 1 with their named policies. Observed results include:

| Stable ID | Required behavior |
| --- | --- |
| 3 | Catapults destroy all three towers; intended play wins at round 11. Aggressive and retreat/lure controls issue no catapult commands and lose at rounds 16 and 9. |
| 6 | Retreat loses the front town at round 24, keeps the rear town through every recorded phase, rebuilds and wins at round 39. Standing ground loses at round 28 despite twelve successful production orders. All ten portals contribute combat. |
| 11 | Two distinct fighters complete combat/retreat/heal/reengagement cycles; eleven HP is healed and all twelve enemies engage. Rotation wins at round 12; charge and no-rotation lose at rounds 6 and 9. |
| 13 | Actual catapult damage destroys four occupied base towers and damages the town; intended play wins at round 19. No-catapult, aggressive and retreat/lure policies do not win within forty rounds. |
| 14 | Economy-first play wins at round 22; premature army production does not win within forty rounds. |

Every surviving map has strictly more lakes, mountains and bushes than its own recorded baseline (39 positive comparisons). Economy uses the TASK-757 tutorial-14 baseline. Removed maps have no density requirement. Hold the Walls remains 13×9; Lose a Town has ten portals; Rotate and Heal has twelve enemies; Escort the Catapults has four occupied base towers.

All thirteen before/after pairs and the clean/completed menus were visually reviewed. Pick Your Targets keeps its central engagement readable; Retreat and Rebuild keeps the central retreat corridor open. Break the Walls clearly separates siege weapons and the defended wall. Economy's neutral opening makes the need to expand visible. Hold the Walls presents a shorter, legible siege approach. Lose a Town visibly distinguishes the rear refuge from the crowded portal front. High Ground retains its hill/pass focus. Through the Bushes retains the northern covered approach and southern ford. Cavalry Raid keeps its flank and target town readable. Hold the Bridge keeps the narrow crossing obvious. Rotate and Heal leaves the healing suburbs clear despite the larger enemy force. Escort the Catapults keeps the ridge pass, wall and four towers distinct. Fortify in Time preserves the central approach and building space.

The portal cluster in mission 6 is deliberately dense; screenshots alone cannot establish its tactical timing. Gameplay traces supply that proof. Screenshot reuse is backed by exact final-map equality with each approved snapshot. Deterministic finite policies establish these tested outcomes, not universal balance or exhaustive human strategy coverage. No production access, push or deployment forms part of this audit.
