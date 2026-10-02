'use strict';
// TASK-405: in the uncached map path (grid.drawOther) the translucent production
// silhouette is drawn after the building and before the unit standing on the
// same cell, for demon portals, barracks and towns. A recording canvas logs
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

  const result = f.evaluate(`(() => {
    const canvas = recordingCanvas()
    grid.drawOther(canvas.ctx)
    const cellAt = {}
    for (const column of grid.arr) for (const cell of column) {
      const at = cell.coord.x + ',' + cell.coord.y
      for (const e of [cell.building, cell.unit]) if (e.notEmpty() && e.pos) cellAt[e.pos.x + ',' + e.pos.y] = at
    }
    return canvas.calls.map((c, index) => ({index, ...c, cell: cellAt[c.x + ',' + c.y] || null}))
  })()`);
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

  console.log(failures ? `FAIL silhouette-order failures=${failures}` : 'PASS silhouette-order');
  process.exit(failures ? 1 : 0);
}

main();
