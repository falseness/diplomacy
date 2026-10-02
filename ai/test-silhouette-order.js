'use strict';
// TASK-405: in the uncached map path (grid.drawOther) the translucent production
// silhouette is drawn after the building and before the unit standing on the
// same cell, for demon portals, barracks and towns. TASK-406: in the cached path
// (grid.drawEntityOverlays) the unit body baked into the surface cache is drawn
// again right after the silhouette, so the unit stays on top of it. A recording canvas logs
// every drawImage with its image key and the canvas alpha at call time; the
// per-cell order is checked against literal expectations.
//
// usage: node ai/test-silhouette-order.js --output-dir DIR [--fault NAME]
const fs = require('fs');
const path = require('path');
const {isDeepStrictEqual} = require('util');
const {createFixture, defaultFixture} = require('./test-coop-harness');

const ROOT = path.resolve(__dirname, '..');

// Independent literal expectations (not read from production tables).
const GHOST_ALPHA = 0.5;
const UNIT_ALPHA = 1;
const CASES = [
  {kind: 'portal', coord: {x: 7, y: 5}, ghost: 'imp', unit: 'noob'},
  {kind: 'barrack', coord: {x: 1, y: 2}, ghost: 'archer', unit: 'noob'},
  {kind: 'town', coord: {x: 1, y: 1}, ghost: 'KOHb', unit: 'noob'}
];
const CONTROL = {kind: 'control', coord: {x: 0, y: 2}, ghost: 'archer'};
// Overlay pass: the barrack unit is mirrored, so its body is the 'Left' image.
const OVERLAY_UNIT_IMAGE = {portal: 'noob', barrack: 'noobLeft', town: 'noob'};

// Test-only faults, injected into the game realm; repo files are never modified.
const FAULTS = {
  // The pre-TASK-405 order: every silhouette drawn after the cell's unit.
  'ghost-after-unit': `
    Grid.prototype.drawOther = function(ctx) {
      const bars = []
      for (const column of this.arr) for (const cell of column) {
        cell.building.draw(ctx)
        if (cell.building.hasBar) bars.push(cell.building)
        cell.unit.draw(ctx)
        if (cell.building.isPreparingManufacture) cell.building.unitProduction.draw(ctx)
        else if (cell.building.isDemonPortal) cell.building.drawNextProduction(ctx)
      }
      for (const b of bars) b.drawBars(ctx)
    }`,
  // The pre-TASK-406 cached overlay pass: silhouettes painted over the cached unit.
  'no-unit-redraw': `
    Grid.prototype.drawEntityOverlays = function(ctx) {
      const bars = []
      for (let i = 0; i < this.arr.length; ++i) for (let j = 0; j < this.arr[i].length; ++j) {
        if (isFogOfWar && !this.fogOfWar[i][j]) continue
        const cell = this.arr[i][j]
        const building = cell.building
        if (building.isBuildingProduction()) building.draw(ctx)
        else if (building.isPreparingManufacture) building.unitProduction.draw(ctx)
        else if (building.isDemonPortal) building.drawNextProduction(ctx)
        if (building.hasBar) bars.push(building)
        if (cell.unit.notEmpty()) cell.unit.drawBars(ctx)
      }
      for (const b of bars) b.drawBars(ctx)
    }`
};

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--output-dir') args.outputDir = argv[++i];
    else if (argv[i] === '--fault') args.fault = argv[++i];
    else throw new Error('unknown argument ' + argv[i]);
  }
  if (!args.outputDir) throw new Error('--output-dir DIR is required');
  if (args.fault && !FAULTS[args.fault]) throw new Error('unknown fault ' + args.fault);
  return args;
}

function setupScene(f) {
  f.evaluate(`(() => {
    // Every image is a tagged stand-in so the recorder can name what is drawn.
    cachedImages = new Proxy({}, {get: (t, key) => typeof key === 'string' ? {imageKey: key} : undefined})
    const town = grid.getBuilding({x: 1, y: 1})
    town.unitProduction = new UnitProduction(1, 10, KOHb, 'KOHb')
    const barrack = new Barrack(1, 2, town)
    barrack.unitProduction = new UnitProduction(2, 40, Archer, 'archer')
    new Noob(1, 2)
    const control = new Barrack(0, 2, town)
    control.unitProduction = new UnitProduction(3, 40, Archer, 'archer')
    new DemonPortal(7, 5, 'melee')
    // A unit on a plain cell (no building, no silhouette) for the overlay pass.
    plainCell: for (const column of grid.arr) for (const cell of column)
      if (cell.coord.x > 2 && cell.building.isEmpty() && cell.unit.isEmpty() && !cell.hexagon.isMapEdge) {
        globalThis.plainUnit = new Noob(cell.coord.x, cell.coord.y)
        break plainCell
      }
    globalThis.recordingCanvas = () => {
      const calls = []
      const target = {globalAlpha: 1}
      const ctx = new Proxy(target, {
        get(t, p) {
          if (p in t) return t[p]
          if (p === 'drawImage') return (img, x, y) => calls.push({image: img && img.imageKey || null,
            alpha: t.globalAlpha, x, y})
          return () => {}
        },
        set(t, p, v) { t[p] = v; return true }
      })
      return {ctx, calls}
    }
  })()`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const out = path.resolve(ROOT, args.outputDir);
  fs.mkdirSync(out, {recursive: true});
  const config = defaultFixture();
  config.coop = true;
  const f = createFixture(config, () => {});
  setupScene(f);
  if (args.fault) f.evaluate(FAULTS[args.fault] + '; undefined');

  const record = pass => f.evaluate(`(() => {
    const canvas = recordingCanvas()
    ${pass}
    const cellAt = {}
    for (const column of grid.arr) for (const cell of column) {
      const at = cell.coord.x + ',' + cell.coord.y
      for (const e of [cell.building, cell.unit]) if (e.notEmpty() && e.pos) cellAt[e.pos.x + ',' + e.pos.y] = at
    }
    return canvas.calls.map((c, index) => ({index, ...c, cell: cellAt[c.x + ',' + c.y] || null}))
  })()`);
  const result = record('grid.drawOther(canvas.ctx)');
  fs.writeFileSync(path.join(out, 'sequence-drawOther.json'), JSON.stringify(
    {fault: args.fault || null, ghostAlpha: GHOST_ALPHA, unitAlpha: UNIT_ALPHA, drawImage: result}, null, 2) + '\n');

  let failures = 0;
  function check(name, observed, expected) {
    if (isDeepStrictEqual(observed, expected)) {
      console.log(`PASS ${name} ${JSON.stringify(observed)}`);
      return;
    }
    failures++;
    console.log(`MISMATCH ${name}\nexpected=${JSON.stringify(expected)}\nobserved=${JSON.stringify(observed)}`);
  }
  const onCell = coord => result.filter(c => c.cell === coord.x + ',' + coord.y);

  for (const c of CASES) {
    const calls = onCell(c.coord);
    const ghosts = calls.filter(d => d.image === c.ghost);
    const units = calls.filter(d => d.image === c.unit);
    check(`drawOther-${c.kind}-ghost-before-unit`, {
      ghosts: ghosts.map(d => d.alpha), units: units.map(d => d.alpha),
      ghostBeforeUnit: ghosts.length === 1 && units.length === 1 && ghosts[0].index < units[0].index
    }, {ghosts: [GHOST_ALPHA], units: [UNIT_ALPHA], ghostBeforeUnit: true});
  }
  const control = onCell(CONTROL.coord);
  check('drawOther-control-ghost', {ghosts: control.filter(d => d.image === CONTROL.ghost).map(d => d.alpha),
    units: control.filter(d => d.alpha === UNIT_ALPHA && d.image !== 'barrack').length},
    {ghosts: [GHOST_ALPHA], units: 0});

  // Cached path: the overlay pass on top of the surface cache.
  const plain = f.evaluate(`plainUnit.coord`);
  f.evaluate(`grid.getUnit({x: 1, y: 2}).mirrorX = true; undefined`);
  const overlay = record('grid.drawEntityOverlays(canvas.ctx)');
  f.evaluate(`globalThis.savedFog = {on: isFogOfWar, map: grid.fogOfWar}
    isFogOfWar = true
    grid.fogOfWar = grid.arr.map(column => column.map(() => true))
    grid.fogOfWar[7][5] = false; undefined`);
  const fogged = record('grid.drawEntityOverlays(canvas.ctx)');
  f.evaluate(`isFogOfWar = savedFog.on; grid.fogOfWar = savedFog.map; undefined`);
  fs.writeFileSync(path.join(out, 'sequence-overlay.json'), JSON.stringify(
    {fault: args.fault || null, ghostAlpha: GHOST_ALPHA, unitAlpha: UNIT_ALPHA, unitImage: OVERLAY_UNIT_IMAGE,
      plainUnitCell: plain, drawImage: overlay, foggedPortalDrawImage: fogged}, null, 2) + '\n');
  const overlayOn = (calls, coord) => calls.filter(c => c.cell === coord.x + ',' + coord.y)
    .map(d => ({image: d.image, alpha: d.alpha}));
  for (const c of CASES) {
    check(`overlay-${c.kind}-unit-over-ghost`, overlayOn(overlay, c.coord),
      [{image: c.ghost, alpha: GHOST_ALPHA}, {image: OVERLAY_UNIT_IMAGE[c.kind], alpha: UNIT_ALPHA}]);
  }
  check('overlay-no-redraw-without-ghost', {plainCellFound: !!plain, drawImage: plain ? overlayOn(overlay, plain) : null},
    {plainCellFound: true, drawImage: []});
  check('overlay-fogged-cell-silent', {portalCell: overlayOn(fogged, CASES[0].coord),
    barrackStillDrawn: overlayOn(fogged, CASES[1].coord).length > 0},
    {portalCell: [], barrackStillDrawn: true});

  console.log(failures ? `FAIL silhouette-order failures=${failures}` : 'PASS silhouette-order');
  process.exit(failures ? 1 : 0);
}

main();
