'use strict';
// Source-only workload calibration. This is not a network or G09 proof.
const fs = require('node:fs');
const assert = require('node:assert/strict');
const {performance} = require('node:perf_hooks');
const fixture = require('/root/diplomacy_server/tests/coop/helpers/current-coop-fixture');
const [countText, output] = process.argv.slice(2);
const count = Number(countText);
assert([4, 12, 24, 48].includes(count));
global.townInterface = {change() {}, hide() {}};
const positions = [];
for (let y = 11; y >= 6; y--) for (let x = 1; x <= 12; x++) positions.push({x, y});
const spec = fixture.currentCoopFixtureSpec({
    label: `mobile-${count}`, humans: 2, size: 'tiny', seed: 1,
    purpose: 'TASK-225 source-only mobile workload calibration; no network coverage',
    players: [
        {rgb: {r: 100, g: 100, b: 100}, gold: 0, towns: []},
        {rgb: {r: 40, g: 80, b: 160}, gold: 200, towns: [{x: 1, y: 1}]},
        {rgb: {r: 57, g: 80, b: 160}, gold: 230, towns: [{x: 11, y: 1}]},
    ],
    demons: positions.slice(0, count).map(p => ({type: 'imp', ...p})),
});
const before = fixture.buildCurrentCoopBoardInVm(spec);
// Select the demon actor exactly as the production phase dispatcher does.
whooseTurn = 3;
assert.equal(players[3].units.length, count);
assert.equal(players[3] instanceof DemonPlayer, true);
assert.equal(gameSettings.aiActionLimit || 0, 0);
const started = performance.now();
players[3].play();
const elapsedMs = performance.now() - started;
const after = JSON.parse(JSON.stringify(getGameObject()));
assert.equal(players[3].units.length, count);
const moved = players[3].units.filter((u, i) =>
    u.coord.x !== spec.demons[i].x || u.coord.y !== spec.demons[i].y).length;
assert(moved > 0, 'mobile fixture must exercise actual movement');
const result = {scope: 'source-only calibration, not independent gameplay correctness or G09 closure',
    count, elapsedMs, moved, spec, before, after, criterionClosures: [], fullAuditReady: false};
fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n', {flag: 'wx'});
console.log(`PASS mobile-${count} genuineAI=true moved=${moved} elapsedMs=${elapsedMs.toFixed(3)} networkCoverage=false`);
