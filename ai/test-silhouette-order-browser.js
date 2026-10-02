'use strict';
// TASK-407: Chromium pixel proof that a unit standing on a producing demon
// portal, barrack or town is drawn over the translucent production silhouette.
// Two map paths: 'cached' (tiny co-op map, grid.canUseSurfaceCache() true, so
// grid.drawEntityOverlays runs) and 'uncached' (33x33 co-op map, cache unusable,
// so grid.drawOther runs). Each case is rendered twice on the real game canvas:
// with the ghost, and a reference whose ghost image is blank (production and its
// turn text kept). Pixels where the unit image is opaque must match the
// reference; pixels where only the ghost is opaque must differ from it.
// Usage: node ai/test-silhouette-order-browser.js --output-dir DIR [--fault ghost-over-unit]
const fs = require('fs');
const path = require('path');
const http = require('http');
const {chromium} = require('playwright');
const root = path.resolve(__dirname, '..');
const argValue = name => {const i = process.argv.indexOf(name); return i < 0 ? null : process.argv[i+1];};
const outArg = argValue('--output-dir');
if (!outArg) {console.error('usage: test-silhouette-order-browser.js --output-dir DIR [--fault ghost-over-unit]'); process.exit(2);}
const out = path.resolve(root, outArg);
const fault = argValue('--fault');
if (fault && fault !== 'ghost-over-unit') {console.error('unknown fault '+fault); process.exit(2);}

const UNIT_TOLERANCE = 2;      // per RGB channel: unit pixel equals reference
const GHOST_MIN_DIFF = 10;     // some RGB channel: ghost-only pixel differs from reference
const MIN_UNIT_SAMPLES = 3;
const MIN_GHOST_SAMPLES = 1;
const SAMPLES_RECORDED = 6;
const CROP_PAD = 24;
const VARIANTS = [
  {path:'cached', map:"generateCoopGame(2,{seed:1,size:'tiny'})"},
  {path:'uncached', map:"generateCoopGame(2,{seed:1})"},
];

// Test-only fault, injected into the page: the pre-TASK-405/406 order, every
// ghost painted after (over) the unit. Repo files are never modified.
function injectGhostOverUnit() {
  Grid.prototype.drawOther = function (ctx) {
    const bars = [];
    for (const column of this.arr) for (const cell of column) {
      cell.building.draw(ctx);
      if (cell.building.hasBar) bars.push(cell.building);
      cell.unit.draw(ctx);
      this.drawProductionSilhouette(ctx, cell.building);
    }
    for (const b of bars) b.drawBars(ctx);
  };
  Grid.prototype.drawEntityOverlays = function (ctx) {
    const bars = [];
    for (const column of this.arr) for (const cell of column) {
      const b = cell.building;
      if (b.isBuildingProduction()) b.draw(ctx);
      else this.drawProductionSilhouette(ctx, b);
      if (b.hasBar) bars.push(b);
      if (cell.unit.notEmpty()) cell.unit.drawBars(ctx);
    }
    for (const b of bars) b.drawBars(ctx);
  };
}

// Places a unit on a producing portal, barrack and town (player 1).
function setupScene() {
  isFogOfWar = false; gameSettings.isOnline = false;
  whooseTurn = 1; actionManager.clear();
  nextTurnPauseInterface.hideButDontUpdateTimer(); timer.pauseAndSaveTime();
  gameEvent.removeSelection();
  const cells = [].concat(...grid.arr);
  const portal = cells.map(c => c.building).find(b => b.isDemonPortal && !b.killed && b.nextProduction);
  const town = cells.map(c => c.building).find(b => b instanceof Town && b.playerColor === 1);
  const free = cells.filter(c => c.building.isEmpty() && c.unit.isEmpty() && !c.hexagon.isMapEdge &&
    !c.building.isMapEdge && c.hexagon.playerColor === 1 && c.hexagon.isSuburb)
    .sort((a, b) => Math.hypot(a.coord.x-town.coord.x, a.coord.y-town.coord.y) - Math.hypot(b.coord.x-town.coord.x, b.coord.y-town.coord.y));
  const barrack = new Barrack(free[0].coord.x, free[0].coord.y, town);
  barrack.unitProduction = new UnitProduction(production.catapult.turns, production.catapult.cost, Catapult, 'catapult');
  town.unitProduction = new UnitProduction(1, 10, KOHb, 'KOHb');
  const units = {};
  for (const [kind, b] of [['portal', portal], ['barrack', barrack], ['town', town]]) {
    const cell = grid.getCell(b.coord);
    if (cell.unit.notEmpty()) cell.unit.killed = true;
    units[kind] = new Noob(b.coord.x, b.coord.y);
  }
  window.__so = {targets:{portal, barrack, town}, units, overlays:0, other:0};
  const overlays = grid.drawEntityOverlays, other = grid.drawOther;
  grid.drawEntityOverlays = function () {__so.overlays++; return overlays.apply(this, arguments);};
  grid.drawOther = function () {__so.other++; return other.apply(this, arguments);};
  // Reference renders swap the ghost image for a blank of the same size.
  const preview = drawProductionPreview;
  window.__so.blank = false;
  window.drawProductionPreview = function (ctx, imageName, pos, coord, turns) {
    if (!__so.blank) return preview.apply(this, arguments);
    const key = '__blank_' + imageName;
    if (!cachedImages[key]) {
      const img = cachedImages[imageName], c = document.createElement('canvas');
      c.width = img.width; c.height = img.height; cachedImages[key] = c;
    }
    return preview.call(this, ctx, key, pos, coord, turns);
  };
  return Object.fromEntries(Object.entries(__so.targets).map(([k, b]) => [k, {coord:b.coord, building:b.name,
    unit:grid.getEntityBodyImageName(__so.units[k])}]));
}

// Renders one case with and without the ghost and samples the main canvas.
function renderCase({kind, pad}) {
  const b = __so.targets[kind], unit = __so.units[kind];
  const ghostName = b.isDemonPortal ? b.nextProduction.type : b.unitProduction.name;
  const ghostPos = b.isDemonPortal ? b.pos : b.unitProduction.pos;
  const unitName = grid.getEntityBodyImageName(unit);
  const unitImg = cachedImages[unitName], ghostImg = cachedImages[ghostName];
  gameEvent.screen.moveTo({x:unit.pos.x+unitImg.width/2, y:unit.pos.y+unitImg.height/2});
  const render = blank => {
    __so.blank = blank; __so.overlays = 0; __so.other = 0;
    const cacheUsable = grid.canUseSurfaceCache();
    drawAll();
    __so.blank = false;
    return {cacheUsable, overlays:__so.overlays, other:__so.other};
  };
  const t = mainCtx.getTransform();
  const toCanvas = (x, y) => t.transformPoint(new DOMPoint(x, y));
  const p0 = toCanvas(unit.pos.x, unit.pos.y), p1 = toCanvas(unit.pos.x+unitImg.width, unit.pos.y+unitImg.height);
  const crop = {x:Math.max(0, Math.floor(p0.x)-pad), y:Math.max(0, Math.floor(p0.y)-pad)};
  crop.w = Math.min(mainCanvas.width, Math.ceil(p1.x)+pad) - crop.x;
  crop.h = Math.min(mainCanvas.height, Math.ceil(p1.y)+pad) - crop.y;
  const withGhost = render(false);
  const a = mainCtx.getImageData(crop.x, crop.y, crop.w, crop.h);
  const reference = render(true);
  const r = mainCtx.getImageData(crop.x, crop.y, crop.w, crop.h);
  const png = img => {const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    c.getContext('2d').putImageData(img, 0, 0); return c.toDataURL('image/png').split(',')[1];};
  // Alpha of an image at world point (x, y), 0 outside it.
  const alphaOf = image => {
    const c = document.createElement('canvas'); c.width = image.width; c.height = image.height;
    const cx = c.getContext('2d'); cx.drawImage(image, 0, 0);
    const d = cx.getImageData(0, 0, c.width, c.height).data;
    return (ix, iy) => ix < 0 || iy < 0 || ix >= c.width || iy >= c.height ? 0 : d[(iy*c.width+ix)*4+3];
  };
  const ua = alphaOf(unitImg), ga = alphaOf(ghostImg);
  const inv = t.inverse();
  const unitPixels = [], ghostPixels = [];
  for (let y = 0; y < crop.h; y++) for (let x = 0; x < crop.w; x++) {
    const w = inv.transformPoint(new DOMPoint(crop.x+x+0.5, crop.y+y+0.5));
    const ux = Math.floor(w.x-unit.pos.x), uy = Math.floor(w.y-unit.pos.y);
    const gx = Math.floor(w.x-ghostPos.x), gy = Math.floor(w.y-ghostPos.y);
    let uMin = 255, uMax = 0, gMin = 255;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const u = ua(ux+dx, uy+dy), g = ga(gx+dx, gy+dy);
      uMin = Math.min(uMin, u); uMax = Math.max(uMax, u); gMin = Math.min(gMin, g);
    }
    const i = (y*crop.w+x)*4;
    const px = {x:crop.x+x, y:crop.y+y, withGhost:Array.from(a.data.slice(i, i+4)), reference:Array.from(r.data.slice(i, i+4))};
    px.maxChannelDiff = Math.max(...[0, 1, 2].map(k => Math.abs(px.withGhost[k]-px.reference[k])));
    // Unit footprint where the ghost lies underneath; ghost-only where no unit is near.
    if (uMin === 255 && gMin >= 128) unitPixels.push(px);
    else if (uMax === 0 && gMin >= 192) ghostPixels.push(px);
  }
  return {kind, ghost:ghostName, unit:unitName, coord:b.coord, crop, withGhost, reference,
    unitPixels, ghostPixels, pngWithGhost:png(a), pngReference:png(r)};
}

(async () => {
  fs.mkdirSync(out, {recursive:true});
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname === '/favicon.ico') {res.writeHead(204); res.end(); return;}
    const file = path.resolve(root, '.'+(pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(root+path.sep)) {res.writeHead(403); res.end(); return;}
    fs.readFile(file, (error, data) => {
      res.writeHead(error ? 404 : 200, {'Content-Type':file.endsWith('.js') ? 'application/javascript' :
        file.endsWith('.html') ? 'text/html' : file.endsWith('.svg') ? 'image/svg+xml' : 'application/octet-stream'});
      res.end(error ? 'Not found' : data);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser, failed = 0;
  const errors = [], cases = [];
  try {
    browser = await chromium.launch({headless:true, args:['--no-sandbox']});
    console.log('browser_engine=chromium browser_version='+browser.version()+(fault ? ' fault='+fault : ''));
    for (const variant of VARIANTS) {
      const page = await browser.newPage({viewport:{width:1280, height:900}, deviceScaleFactor:1});
      page.on('pageerror', e => errors.push(variant.path+': '+e.message));
      page.on('console', m => {if (m.type() === 'error') errors.push(variant.path+': '+m.text());});
      // Offline fixture: no networking, downloads or learned AI.
      await page.route('https://**/*', route => route.fulfill({contentType:'application/javascript',
        body:route.request().url().includes('socket.io') ? 'window.io=()=>({on(){},emit(){}})' :
          route.request().url().includes('FileSaver') ? 'window.saveAs=()=>{}' : 'window.tf={}'}));
      await page.goto(`http://127.0.0.1:${server.address().port}/`, {waitUntil:'load'});
      await page.waitForFunction(() => typeof menu !== 'undefined' && menu.visible && imagesCountLoaded === images.length);
      await page.evaluate(map => {gameSlot = 0; GameManager.start(eval(map), false, false);}, variant.map);
      if (fault) await page.evaluate(injectGhostOverUnit);
      const scene = await page.evaluate(setupScene);
      console.log(`scene path=${variant.path} map=${variant.map} ${JSON.stringify(scene)}`);
      for (const kind of ['portal', 'barrack', 'town']) {
        const c = await page.evaluate(renderCase, {kind, pad:CROP_PAD});
        const observedPath = c.withGhost.cacheUsable ? 'cached' : 'uncached';
        const files = {};
        for (const [label, data] of [['ghost', c.pngWithGhost], ['reference', c.pngReference]]) {
          files[label] = `${variant.path}-${kind}-${label}.png`;
          fs.writeFileSync(path.join(out, files[label]), Buffer.from(data, 'base64'));
        }
        const unitBad = c.unitPixels.filter(p => p.maxChannelDiff > UNIT_TOLERANCE);
        const ghostGood = c.ghostPixels.filter(p => p.maxChannelDiff > GHOST_MIN_DIFF);
        // Evenly spread unit samples; the most visible ghost-only samples.
        const spread = (list, n) => list.length <= n ? list : Array.from({length:n}, (_, i) => list[Math.floor((i+0.5)*list.length/n)]);
        const unitSamples = [...unitBad.slice(0, SAMPLES_RECORDED), ...spread(c.unitPixels, SAMPLES_RECORDED)]
          .map(p => ({...p, pass:p.maxChannelDiff <= UNIT_TOLERANCE}));
        const ghostSamples = [...ghostGood].sort((p, q) => q.maxChannelDiff - p.maxChannelDiff).slice(0, SAMPLES_RECORDED)
          .map(p => ({...p, pass:true}));
        const problems = [];
        if (observedPath !== variant.path) problems.push(`canUseSurfaceCache()=${c.withGhost.cacheUsable}, expected path ${variant.path}`);
        for (const [label, run] of [['withGhost', c.withGhost], ['reference', c.reference]]) {
          const ran = run.overlays ? 'drawEntityOverlays' : run.other ? 'drawOther' : 'none';
          if (ran !== (variant.path === 'cached' ? 'drawEntityOverlays' : 'drawOther')) problems.push(`${label} ran ${ran}`);
        }
        if (c.ghost === c.unit) problems.push('ghost and unit images are the same');
        if (c.unitPixels.length < MIN_UNIT_SAMPLES) problems.push(`only ${c.unitPixels.length} unit-over-ghost pixels`);
        if (unitBad.length) problems.push(`${unitBad.length}/${c.unitPixels.length} unit pixels differ from reference by >${UNIT_TOLERANCE}`);
        if (ghostGood.length < MIN_GHOST_SAMPLES) problems.push(`no ghost-only pixel differs by >${GHOST_MIN_DIFF} (${c.ghostPixels.length} candidates)`);
        const record = {kind, path:variant.path, map:variant.map, canUseSurfaceCache:c.withGhost.cacheUsable,
          passCalls:{withGhost:{drawEntityOverlays:c.withGhost.overlays, drawOther:c.withGhost.other},
            reference:{drawEntityOverlays:c.reference.overlays, drawOther:c.reference.other}},
          coord:c.coord, ghostImage:c.ghost, unitImage:c.unit, crop:c.crop, files,
          unitFootprint:{candidates:c.unitPixels.length, withinTolerance:c.unitPixels.length-unitBad.length,
            tolerance:UNIT_TOLERANCE, samples:unitSamples},
          ghostOnly:{candidates:c.ghostPixels.length, differing:ghostGood.length, minDiff:GHOST_MIN_DIFF, samples:ghostSamples},
          pass:!problems.length, problems};
        cases.push(record);
        const summary = `unitPixels=${record.unitFootprint.withinTolerance}/${c.unitPixels.length} ghostOnlyDiffering=${ghostGood.length}/${c.ghostPixels.length} ghost=${c.ghost} unit=${c.unit}`;
        if (problems.length) {failed++; console.log(`FAIL ${kind} path=${observedPath} ${problems.join('; ')} ${summary}`);}
        else console.log(`PASS ${kind} path=${observedPath} ${summary}`);
      }
      await page.close();
    }
    if (errors.length) {failed++; console.log('FAIL page-errors '+JSON.stringify(errors));}
    fs.writeFileSync(path.join(out, 'pixels.json'), JSON.stringify({engine:'chromium', version:browser.version(),
      fault, pageErrors:errors, pass:!failed, cases}, null, 2)+'\n');
  } finally {
    console.log('page_errors='+errors.length);
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
  console.log(failed ? `FAIL ${failed} case(s)` : `ALL PASS ${cases.length} cases`);
  process.exitCode = failed ? 1 : 0;
})().catch(error => {console.error(error); process.exitCode = 1;});
