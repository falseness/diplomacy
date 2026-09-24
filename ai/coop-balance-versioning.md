# Current co-op rules

Co-op games use generation version 4, six typed portal categories and the weak
combat stats in `demon-config.js`. `wave-config.js` defines the single four-round
schedule. `balanceVersion: 2` remains a validated save marker, not a selector.
Generation seed/options remain deterministic map replay metadata. Typed wave
`lastRound` prevents duplicate production after reload; weighted wave metadata,
old generation versions and untyped portals are rejected, never migrated.

Historical results remain under local artifacts. The inert
`fixtures/coop-legacy-stored-maps.json` is retained as TASK-230 rejection data.
Current source save/load and UI regression coverage runs with
`node ai/test-task243-verification.js --output-dir <fresh-directory>`.
