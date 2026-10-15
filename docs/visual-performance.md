Open the actual game URL with `?visualsPerf=1`. Ordinary URLs install no sampler or diagnostic controls. Start a disposable local game; do not use a saved or online game for automated replay. Leave the tab visible and focused throughout capture.

For manual diagnosis, press Start, perform normal wheel or two-finger pinch zoom, then Stop and Export. The downloaded `visuals-performance.json` contains real game-loop RAF timestamps, update/render CPU spans, camera scale/offset, input timestamps, cache/raster/allocation counters, visibility/focus history, viewport/DPR, browser identity and loaded-script SHA256 identities. Supply known deployment commits as `&clientCommit=<sha>&serverCommit=<sha>` in the diagnostic URL; exports label these as user-supplied and include fetched source hashes for independent checking. Unknown commit fields remain null; attach exact deployment commits separately. Do not infer them from a different checkout.

For repeatable comparison, check “Local test-owned game”, choose wheel on desktop or pinch on a touch browser, and press “3 paired captures”. Six runs alternate pair order (off/on, on/off, off/on). Each has 10 seconds warm-up, 5 seconds idle-before, 20 seconds zoom-in/out, and 5 seconds settled-after. Replay uses synthetic events through the existing wheel/touch handlers; it never replaces RAF or changes zoom limits. Export after completion. Original camera and atmospheric flag are restored; the local preference is never saved by capture. Stop cancels replay; restoration occurs when the current wait window ends. Keep normal camera defaults. Capture raw actual user input separately to compare against synthetic replay.

A valid comparison requires equal board, viewport/DPR, starting camera and ordered actual camera trajectories. Hidden/unfocused or board-changing runs are invalid. Input timing must also match to within one second per event; otherwise the pair is invalid. Camera equality allows only floating point roundoff (1e-9 scale, 1e-7 offset). Use per-frame timestamps to inspect scheduling differences; automated timing does not certify device FPS. Long gaps and raw measurements remain in the export, including invalid runs.

No genuine user-device export was provided: **user-device-performance-unverified**. `sample-report.json` and paired JSON files are automated-environment export/workload tests only, never a 60 FPS claim. No physical-device measurements are claimed. Main integration identity is deferred to the main integrator.

The scoped automated checks run serially from the sibling server with `VISUALS_INPUT=wheel` and `VISUALS_INPUT=pinch` respectively:

```
VISUALS_INPUT=wheel timeout --signal=TERM --kill-after=5s 585s /usr/local/bin/node20 tests/client/test-atmospheric-visuals.js --case live-performance-capture --output-dir /root/diplomacy/artifacts/TASK-1046/revision-2
```

Repeat with `VISUALS_INPUT=pinch`; never overlap shards. The helper owns its temporary Xvfb/Openbox display when no DISPLAY is provided, and cleans it on completion. Tests disable Playwright's artificial focus override through its pinned 1.44 in-process CDP session to verify real minimize/restore visibility. This is test-only driver setup; production never changes browser focus behavior. `VISUALS_SCENES=1` selects the separate trusted-input screenshot probe without running paired timing windows.
