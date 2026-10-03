'use strict';
// TASK-371: real-browser proof of fog landmark visibility per mode. A local
// co-op game and a competitive hot-seat game run the real gameLoop in Chromium
// (low-end-device mode, one page at a time); fogged goldmines/portals are
// compared pixel by pixel against a fog-only reference (cell artwork cleared).
// Usage: node ai/test-fog-landmark-browser.js --output-dir DIR
const {spawnSync} = require('child_process');
// Playwright 1.44 needs node >= 16 and lives in /opt/diplomacy/node_modules.
if (Number(process.versions.node.split('.')[0]) < 16 || !process.env.NODE_PATH) {
  const result = spawnSync('/usr/local/bin/node20', [__filename, ...process.argv.slice(2)], {stdio:'inherit',
    env:{...process.env, NODE_PATH:process.env.NODE_PATH || '/opt/diplomacy/node_modules',
      PLAYWRIGHT_BROWSERS_PATH:process.env.PLAYWRIGHT_BROWSERS_PATH || '0'}});
  process.exit(result.status === null ? 1 : result.status);
}
const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const {chromium} = require('playwright');
const root = path.resolve(__dirname, '..');
const outputIndex = process.argv.indexOf('--output-dir');
if (outputIndex < 0) {console.error('usage: --output-dir DIR'); process.exit(2);}
const out = path.resolve(process.argv[outputIndex+1]);
const shots = path.join(out, 'screenshots');
// A pixel differs when any RGB channel differs by more than CHANNEL_TOLERANCE.
const CHANNEL_TOLERANCE = 16;
const HIDDEN_MAX_DIFF = 20;    // fog-only: crop must match the reference
const DRAWN_MIN_DIFF = 1000;   // artwork drawn: of a 113x113 landmark image
const MIN_FRAMES = 3;
const COOP_MAP = "generateCoopGame(2,{seed:1})";       // 33x33: surface cache unusable at zoom 1
const COMPETITIVE_MAP = "maps['fight forever'][0]";    // 40x30: surface cache unusable at zoom 1
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

// Installed once per page after GameManager.start: wraps (does not replace)
// drawAll, grid.drawFogLandmark and drawCachedImage to log each frame.
function instrument() {
  const fl = window.__fl = {frame:0, recording:false, frames:[], targets:{}, dci:0, cur:null};
  const drawAllOriginal = drawAll;
  window.drawAll = function () {
    fl.frame++;
    fl.cur = fl.recording ? {frame:fl.frame, drawFogLandmarkCalls:0, landmarkDrawCachedImage:0, targets:[]} : null;
    const result = drawAllOriginal.apply(this, arguments);
    if (fl.cur) fl.frames.push(fl.cur);
    fl.cur = null;
    return result;
  };
  const drawCachedImageOriginal = drawCachedImage;
  window.drawCachedImage = function () {fl.dci++; return drawCachedImageOriginal.apply(this, arguments);};
  const landmarkOriginal = grid.drawFogLandmark;
  grid.drawFogLandmark = function (ctx, building) {
    const before = fl.dci;
    const result = landmarkOriginal.apply(this, arguments);
    const drew = fl.dci > before;
    if (fl.cur) {
      fl.cur.drawFogLandmarkCalls++;
      if (drew) fl.cur.landmarkDrawCachedImage++;
      const key = building.coord && building.coord.x + ',' + building.coord.y;
      if (fl.targets[key]) fl.cur.targets.push({cell:key, name:building.name,
        imageName:grid.getEntityBodyImageName(building), drawCachedImage:drew});
    }
    return result;
  };
}

(async () => {
  fs.mkdirSync(shots, {recursive:true});
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname === '/favicon.ico') {res.writeHead(204); res.end(); return;}
    const file = path.resolve(root, '.'+(pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(root+path.sep)) {res.writeHead(403);res.end();return;}
    fs.readFile(file, (error, data) => {
      res.writeHead(error ? 404 : 200, {'Content-Type':file.endsWith('.js') ? 'application/javascript' :
        file.endsWith('.html') ? 'text/html' : file.endsWith('.svg') ? 'image/svg+xml' : 'application/octet-stream'});
      res.end(error ? 'Not found' : data);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  const cases = [], consoleErrors = [], failures = [];
  try {
    browser = await chromium.launch({headless:true, args:['--enable-low-end-device-mode']});
    console.log('browser_engine=chromium browser_version='+browser.version()+' args=--enable-low-end-device-mode');

    const save = async (page, name, options) => {
      const bytes = await page.screenshot({path:path.join(shots, name), ...options});
      console.log(`screenshot ${name} bytes=${bytes.length}`);
      return {file:'screenshots/'+name, bytes:bytes.length, sha256:sha(bytes), base64:bytes.toString('base64')};
    };
    const differing = (page, a, b) => page.evaluate(async ({a, b, tolerance}) => {
      const pixels = async base64 => {
        const bitmap = await createImageBitmap(await (await fetch('data:image/png;base64,'+base64)).blob());
        const c = new OffscreenCanvas(bitmap.width, bitmap.height), ctx = c.getContext('2d');
        ctx.drawImage(bitmap, 0, 0);
        return ctx.getImageData(0, 0, c.width, c.height).data;
      };
      const [pa, pb] = [await pixels(a), await pixels(b)];
      if (pa.length !== pb.length) return -1;
      let count = 0;
      for (let i = 0; i < pa.length; i += 4)
        if (Math.abs(pa[i]-pb[i]) > tolerance || Math.abs(pa[i+1]-pb[i+1]) > tolerance || Math.abs(pa[i+2]-pb[i+2]) > tolerance) count++;
      return count;
    }, {a, b, tolerance:CHANNEL_TOLERANCE});
    const waitFrames = (page, n) => page.waitForFunction(n => __fl.frame >= n, null, {timeout:120000})
      .then(() => page.evaluate(() => __fl.frame));

    async function openGame(label, mapExpression) {
      const page = await browser.newPage({viewport:{width:1280,height:900}, deviceScaleFactor:1});
      page.on('pageerror', e => consoleErrors.push(label+': '+e.message));
      page.on('console', m => {if (m.type() === 'error') consoleErrors.push(label+': '+m.text());});
      // Offline: no server socket, downloads or learned AI.
      await page.route('https://**/*', route => route.fulfill({contentType:'application/javascript',
        body:route.request().url().includes('socket.io') ? 'window.io=()=>({on(){},emit(){}})' :
          route.request().url().includes('FileSaver') ? 'window.saveAs=()=>{}' : 'window.tf={}'}));
      await page.goto(`http://127.0.0.1:${server.address().port}/`, {waitUntil:'load'});
      await page.waitForFunction(() => typeof menu !== 'undefined' && menu.visible && imagesCountLoaded === images.length);
      const game = await page.evaluate(mapExpression => {
        // The menu's local start: GameManager.start runs requestAnimationFrame(gameLoop).
        GameManager.start(eval(mapExpression), true, false);
        nextTurnPauseInterface.hideButDontUpdateTimer(); timer.pauseAndSaveTime();
        return {map:mapExpression, coop:!!gameSettings.coop, drawFogLandmarks:gameSettings.drawFogLandmarks,
          isFogOfWar, whooseTurn, size:[grid.arr.length, grid.arr[0].length],
          surfaceCacheUsable:grid.canUseSurfaceCache(), canvasScale:canvas.scale};
      }, mapExpression);
      await page.evaluate(instrument);
      console.log(JSON.stringify({game:label, ...game}));
      return {page, game};
    }

    // Picks fogged landmarks nearest the board centre (so the camera can centre them).
    const pick = (page, filter, skip = []) => page.evaluate(({filter, skip}) => {
      const centre = {x:(mapDepth.bounds.left+mapDepth.bounds.right)/2, y:(mapDepth.bounds.top+mapDepth.bounds.bottom)/2};
      let best;
      for (let i = 0; i < grid.arr.length; i++) for (let j = 0; j < grid.arr[i].length; j++) {
        const b = grid.arr[i][j].building;
        const ok = filter === 'portal' ? b.isDemonPortal && !b.killed : b.name === 'goldmine';
        if (!ok || grid.fogOfWar[i][j] || skip.includes(i+','+j)) continue;
        const d = Math.hypot(b.pos.x-centre.x, b.pos.y-centre.y);
        if (!best || d < best.d) best = {x:i, y:j, d};
      }
      return best && {x:best.x, y:best.y};
    }, {filter, skip});

    async function runCase(page, game, spec) {
      const {name, cell, prefix, forceVisible, full} = spec;
      const key = cell.x+','+cell.y;
      const setup = await page.evaluate(({cell, key, forceVisible}) => {
        const b = grid.arr[cell.x][cell.y].building;
        const naturalFog = grid.fogOfWar[cell.x][cell.y];
        if (forceVisible) grid.fogOfWar[cell.x][cell.y] = 1;
        const image = cachedImages[grid.getEntityBodyImageName(b)];
        // Move the camera through the real screen API to the landmark's centre.
        gameEvent.screen.moveTo({x:b.pos.x+image.width/2, y:b.pos.y+image.height/2});
        __fl.targets = {[key]:true}; __fl.frames = []; __fl.recording = true;
        return {building:b.name, imageName:grid.getEntityBodyImageName(b), killed:!!b.killed,
          coord:b.coord, naturalFogValue:naturalFog, fogMask:forceVisible ? 'forced-visible' : (naturalFog ? 'natural-visible' : 'natural-fogged'),
          image:{w:image.width, h:image.height}, worldPos:b.pos};
      }, {cell, key, forceVisible});
      const startFrame = await page.evaluate(() => __fl.frame);
      await waitFrames(page, startFrame + MIN_FRAMES + 1);
      // Screen box of the landmark image from the live main-canvas transform.
      const box = await page.evaluate(({cell}) => {
        const b = grid.arr[cell.x][cell.y].building, image = cachedImages[grid.getEntityBodyImageName(b)];
        const t = mainCtx.getTransform(), r = mainCanvas.getBoundingClientRect(), k = r.width / mainCanvas.width;
        const p = t.transformPoint(new DOMPoint(b.pos.x, b.pos.y)), q = t.transformPoint(new DOMPoint(b.pos.x+image.width, b.pos.y+image.height));
        return {x:r.left+p.x*k, y:r.top+p.y*k, width:(q.x-p.x)*k, height:(q.y-p.y)*k};
      }, {cell});
      const pad = 40;
      const clip = {x:Math.round(box.x-pad), y:Math.round(box.y-pad), width:Math.round(box.width+2*pad), height:Math.round(box.height+2*pad)};
      assert(clip.x >= 0 && clip.y >= 0 && clip.x+clip.width <= 1280 && clip.y+clip.height <= 900, name+': landmark on screen');
      const screenshots = {};
      if (full) screenshots.full = await save(page, full);
      screenshots.crop = await save(page, prefix+'-crop.png', {clip});
      const frames = await page.evaluate(() => {__fl.recording = false; return __fl.frames;});
      const stillFog = await page.evaluate(({cell}) => grid.fogOfWar[cell.x][cell.y], {cell});
      // Fog-only reference: the same cell with its building artwork cleared.
      await page.evaluate(({cell}) => {
        const c = grid.arr[cell.x][cell.y];
        window.__savedBuilding = c.building;
        const empty = new Empty(); empty.coord = {x:cell.x, y:cell.y};
        c.building = empty;
      }, {cell});
      await waitFrames(page, (await page.evaluate(() => __fl.frame)) + MIN_FRAMES);
      screenshots.reference = await save(page, prefix+'-fog-reference.png', {clip});
      await page.evaluate(({cell}) => {grid.arr[cell.x][cell.y].building = __savedBuilding;}, {cell});
      await waitFrames(page, (await page.evaluate(() => __fl.frame)) + 1);
      const diff = await differing(page, screenshots.crop.base64, screenshots.reference.base64);
      for (const s of Object.values(screenshots)) delete s.base64;

      const targetCalls = frames.map(f => f.targets.filter(t => t.cell === key));
      const landmarkDrawCachedImageTotal = frames.reduce((n, f) => n + f.landmarkDrawCachedImage, 0);
      const targetDrawCachedImage = targetCalls.reduce((n, calls) => n + calls.filter(t => t.drawCachedImage).length, 0);
      const record = {name, map:game.map, cell:key, ...setup, fogValueDuringFrames:stillFog,
        drawFogLandmarks:game.drawFogLandmarks, surfaceCacheUsable:game.surfaceCacheUsable,
        frames:frames.length, frameLog:frames, landmarkDrawCachedImageTotal, targetDrawCachedImage,
        screenBox:box, clip, differingPixels:diff, channelTolerance:CHANNEL_TOLERANCE, screenshots};
      const checks = [];
      const check = (label, ok) => {checks.push({label, ok}); if (!ok) failures.push(name+': '+label);};
      check('frames >= '+MIN_FRAMES, frames.length >= MIN_FRAMES);
      check('per-frame grid.draw path (surface cache unusable)', game.surfaceCacheUsable === false);
      if (spec.expect === 'hidden') {
        record.threshold = {differingPixelsAtMost:HIDDEN_MAX_DIFF};
        check('drawFogLandmarks false', game.drawFogLandmarks === false);
        check('fog mask natural', setup.fogMask === 'natural-fogged' && stillFog === 0);
        check('drawFogLandmark called for the cell every frame', targetCalls.every(calls => calls.length === 1));
        check('0 drawCachedImage from drawFogLandmark', landmarkDrawCachedImageTotal === 0 && targetDrawCachedImage === 0);
        check('crop equals fog-only reference', diff >= 0 && diff <= HIDDEN_MAX_DIFF);
      } else if (spec.expect === 'fog-drawn') {
        record.threshold = {differingPixelsAtLeast:DRAWN_MIN_DIFF};
        check('drawFogLandmarks true', game.drawFogLandmarks === true);
        check('fog mask natural', setup.fogMask === 'natural-fogged' && stillFog === 0);
        check('landmark drawn by drawFogLandmark every frame', targetCalls.every(calls => calls.length === 1 && calls[0].drawCachedImage));
        check('target drawCachedImage count == frames', targetDrawCachedImage === frames.length);
        check('artwork differs from fog-only reference', diff >= DRAWN_MIN_DIFF);
      } else {
        record.threshold = {differingPixelsAtLeast:DRAWN_MIN_DIFF};
        check('cell visible during frames', stillFog === 1);
        check('visible cell bypasses drawFogLandmark', targetCalls.every(calls => calls.length === 0));
        check('artwork differs from fog-only reference', diff >= DRAWN_MIN_DIFF);
      }
      record.checks = checks;
      record.pass = checks.every(c => c.ok);
      cases.push(record);
      console.log(JSON.stringify({case:name, cell:key, building:setup.building, fogMask:setup.fogMask,
        drawFogLandmarks:game.drawFogLandmarks, frames:frames.length, landmarkDrawCachedImageTotal, targetDrawCachedImage,
        differingPixels:diff, threshold:record.threshold, failed:checks.filter(c => !c.ok).map(c => c.label)}));
      console.log((record.pass ? 'PASS ' : 'FAIL ')+name);
    }

    {
      const {page, game} = await openGame('coop', COOP_MAP);
      const goldmine = await pick(page, 'goldmine'), portal = await pick(page, 'portal');
      const visible = await pick(page, 'goldmine', [goldmine.x+','+goldmine.y]);
      // TASK-450-4: co-op draws fog landmarks too.
      await runCase(page, game, {name:'coop-fogged-goldmine-drawn', cell:goldmine, prefix:'coop-goldmine', full:'coop-full.png', expect:'fog-drawn'});
      await runCase(page, game, {name:'coop-fogged-portal-drawn', cell:portal, prefix:'coop-portal', expect:'fog-drawn'});
      // No co-op goldmine is in vision at game start, so this cell is forced visible (controlled fixture).
      await runCase(page, game, {name:'coop-visible-goldmine-drawn', cell:visible, prefix:'coop-visible-goldmine', forceVisible:true, expect:'visible-drawn'});
      await page.close();
    }
    {
      const {page, game} = await openGame('competitive', COMPETITIVE_MAP);
      const goldmine = await pick(page, 'goldmine');
      await runCase(page, game, {name:'competitive-fogged-goldmine-drawn', cell:goldmine, prefix:'competitive-goldmine', full:'competitive-full.png', expect:'fog-drawn'});
      await page.close();
    }
    if (consoleErrors.length) failures.push('console errors: '+JSON.stringify(consoleErrors));
    else console.log('PASS browser-console-errors count=0');
    // Verify recorded hashes against the files on disk.
    for (const c of cases) for (const s of Object.values(c.screenshots)) {
      const bytes = fs.readFileSync(path.join(out, s.file));
      if (sha(bytes) !== s.sha256 || bytes.length <= 1024) failures.push('screenshot '+s.file+' hash/size');
    }
    fs.writeFileSync(path.join(out, 'checkpoints.json'), JSON.stringify({
      browser:{engine:'chromium', version:browser.version(), args:['--enable-low-end-device-mode'], viewport:'1280x900', pages:'one at a time'},
      constants:{CHANNEL_TOLERANCE, HIDDEN_MAX_DIFF, DRAWN_MIN_DIFF, MIN_FRAMES}, cases, consoleErrors, failures}, null, 2)+'\n');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
  console.log(`SUMMARY cases=${cases.length} pass=${cases.filter(c => c.pass).length} failures=${failures.length}`);
  if (failures.length) {console.error(failures.join('\n')); process.exitCode = 1;}
})().catch(error => {console.error(error); process.exitCode = 1;});
