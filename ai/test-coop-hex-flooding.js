// Usage: node ai/test-coop-hex-flooding.js [--output-dir DIR] [--fault forged-town]
// Sudden death on generated hexagonal co-op maps (seed 0, tiny/normal/big x humans 1/4/12).
// The production neutral turn (NeutralPlayer.nextTurn -> suddenDeath -> radialSuddenDeath)
// runs from suddenDeathRound until the flooded layer goes negative; floodCell is wrapped
// to record every flooded cell. Sudden-death cycle c = (gameRound - suddenDeathRound)/2
// floods layer R - c, so human towns (layer R-3) flood at cycle 3, before the elite core.
// --output-dir writes flooding.txt and mask.json. --fault forged-town moves one recorded
// human town to layer 0 (the centre) and must fail the humans-before-portals assertion.
const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const {createFixture} = require('./test-coop-harness');

const option = name => { const i = process.argv.indexOf(name); return i < 0 ? null : process.argv[i + 1]; };
const outputDir = option('--output-dir');
const fault = option('--fault');
// Literal elite categories and layer formula, independent of the planner/runtime helpers.
const ELITE = ['chaos', 'heavy', 'siege', 'mage'];
const layerOf = (c, R) => { const q = c.x - R, r = c.y - Math.floor(c.x/2) - Math.ceil(R/2);
  return Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r)); };
const f = createFixture(undefined, () => {});
function compare(label, observed, expected) {
  assert.deepEqual(observed, expected, label);
  console.log('PASS ' + label);
}
const table = [], mask = [];
for (const size of ['tiny', 'normal', 'big']) for (const humans of [1, 4, 12]) {
  const label = `${size}-humans-${humans}-seed-0`;
  const started = Date.now();
  f.evaluate(`globalThis.generated=generateCoopGame(${humans},{size:'${size}',seed:0});
    generated.start({clearValues() {external=[];externalProduction=[];nature=[];goldmines=[];gameRound=0;gameExit=false;},updateCameraBorders() {}}, false);`);
  const map = f.evaluate('JSON.parse(JSON.stringify(generated))');
  const R = map.mapShape.radius;
  const towns = map.players.slice(1, humans + 1).flatMap((p, i) => p.towns.map(t => ({human: i + 1, x: t.x, y: t.y})));
  if (fault === 'forged-town') { towns[0].x = R; towns[0].y = Math.ceil(R/2) + Math.floor(R/2); }
  const elitePortals = map.portals.filter(p => ELITE.includes(p.category));
  const run = f.evaluate(`(() => {
    const neutral = players[0], flood = neutral.floodCell.bind(neutral), log = [];
    neutral.floodCell = (x, y) => {
      const b = grid.arr[x][y].building;
      log.push({round: gameRound, x, y, isMapEdge: b.isMapEdge === true, name: b.name, portal: b.isDemonPortal === true});
      flood(x, y);
    };
    // Stop the game-over path from leaving the loop; flooding continues until the layer goes negative.
    menuBack = () => { ends++ }; globalThis.ends = 0;
    const threshold = suddenDeathRound, rounds = [];
    gameRound = threshold - 1;
    while (gameRound < threshold + 2 * (gameSettings.mapShape.radius + 1)) {
      const before = log.length;
      neutral.nextTurn();
      rounds.push({round: gameRound, cells: log.length - before});
    }
    neutral.floodCell = flood;
    return {threshold, rounds, log, ends, result: gameSettings.coop.result, shape: gameSettings.mapShape};
  })()`);
  compare(label + '-runtime-shape', run.shape, map.mapShape);
  const cycles = [];
  for (const {round, cells} of run.rounds) {
    const offset = round - run.threshold;
    if (offset % 2) { compare(`${label}-odd-round-${round}-no-flood`, cells, 0); continue; }
    const c = offset / 2, layer = R - c;
    const flooded = run.log.filter(e => e.round === round);
    compare(`${label}-cycle-${c}-layer`, [...new Set(flooded.map(e => layerOf(e, R)))], layer < 0 ? [] : [layer]);
    // Every playable cell of that ring: 6*layer cells, 1 at the centre.
    compare(`${label}-cycle-${c}-ring-count`, cells, layer < 0 ? 0 : layer === 0 ? 1 : 6 * layer);
    if (layer >= 0) cycles.push({round, cycle: c, layer, cells});
  }
  const layers = cycles.map(r => r.layer);
  compare(label + '-first-layer-is-radius', layers[0], R);
  compare(label + '-layers-strictly-decrease', layers.every((l, i) => i === 0 || l < layers[i - 1]), true);
  const cycleOf = cell => {
    const e = run.log.find(e => e.x === cell.x && e.y === cell.y);
    return e ? (e.round - run.threshold) / 2 : null;
  };
  const townCycles = towns.map(t => ({...t, layer: layerOf(t, R), cycle: cycleOf(t)}));
  const portalCycles = elitePortals.map(p => cycleOf(p));
  const firstElite = Math.min(...portalCycles);
  const firstEliteRound = run.threshold + 2 * firstElite;
  const innerBeforeTown = run.log.filter(e => (e.round - run.threshold) / 2 <= 3 && layerOf(e, R) < R - 3).length;
  const maskHits = run.log.filter(e => e.isMapEdge).length;
  const row = {case: label, radius: R, suddenDeathRound: run.threshold, cycles, towns: townCycles,
    elitePortals: elitePortals.length, firstElitePortalCycle: firstElite, firstElitePortalRound: firstEliteRound,
    firstElitePortalLayer: R - firstElite, innerCellsFloodedByCycle3: innerBeforeTown,
    portalCellsFloodedAsPortal: run.log.filter(e => e.portal).length, result: run.result};
  table.push(row);
  mask.push({case: label, radius: R, floodCellCalls: run.log.length, isMapEdgeCalls: maskHits});
  // Humans must flood before the elite core (the "rush the portals" pressure).
  compare(label + '-humans-flood-before-elite-portals', townCycles.every(t => t.cycle !== null && t.cycle < firstElite), true);
  compare(label + '-towns-flood-at-cycle-3', townCycles.map(t => [t.layer, t.cycle]), townCycles.map(() => [R - 3, 3]));
  compare(label + '-no-inner-cell-by-cycle-3', innerBeforeTown, 0);
  compare(label + '-elite-portal-cycles-all-flooded', portalCycles.every(c => c !== null), true);
  compare(label + '-mask-never-flooded', maskHits, 0);
  console.log(`PASS ${label} R=${R} towns_cycle=3 first_elite_cycle=${firstElite} flood_calls=${run.log.length} mask_calls=0 ms=${Date.now() - started}`);
}
if (outputDir) {
  fs.mkdirSync(outputDir, {recursive: true});
  const lines = ['Sudden death on generated hexagonal co-op maps (seed 0). cycle c = (gameRound - suddenDeathRound)/2, flooded layer = R - c.', ''];
  for (const r of table) {
    lines.push(`== ${r.case} radius=${r.radius} suddenDeathRound=${r.suddenDeathRound}`);
    lines.push('  gameRound  cycle  floodedLayer  cellsFlooded');
    for (const c of r.cycles) lines.push(`  ${String(c.round).padStart(9)}  ${String(c.cycle).padStart(5)}  ${String(c.layer).padStart(12)}  ${String(c.cells).padStart(12)}`);
    lines.push(`  firstFloodedLayer=${r.cycles[0].layer} (== R ${r.cycles[0].layer === r.radius}) layersStrictlyDecrease=true`);
    for (const t of r.towns) lines.push(`  humanTown human=${t.human} cell=${t.x},${t.y} layer=${t.layer} floodCycle=${t.cycle}`);
    lines.push(`  firstElitePortal cycle=${r.firstElitePortalCycle} round=${r.firstElitePortalRound} layer=${r.firstElitePortalLayer} (elitePortals=${r.elitePortals})`);
    lines.push(`  innerCellsFloodedByCycle3=${r.innerCellsFloodedByCycle3} coopResultAfterFlood=${r.result}`);
    lines.push(`  ASSERT every human town cycle (${[...new Set(r.towns.map(t => t.cycle))].join(',')}) < first elite portal cycle (${r.firstElitePortalCycle}): PASS`);
    lines.push(`  ASSERT towns on layer R-3=${r.radius - 3} flooded exactly at cycle 3 (cycles 0,1,2 flood layers ${r.radius},${r.radius - 1},${r.radius - 2}): PASS`);
    lines.push('');
  }
  fs.writeFileSync(path.join(outputDir, 'flooding.txt'), lines.join('\n'));
  fs.writeFileSync(path.join(outputDir, 'mask.json'), JSON.stringify({method: 'players[0].floodCell wrapped in the vm; isMapEdge read from grid.arr[x][y].building before the original floodCell ran',
    totalIsMapEdgeCalls: mask.reduce((s, m) => s + m.isMapEdgeCalls, 0), cases: mask}, null, 1) + '\n');
}
console.log(`PASS co-op hex flooding cases=${table.length} sizes=tiny,normal,big humans=1,4,12 seed=0`);
