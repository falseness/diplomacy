// Typed portal artwork (TASK-156). Validates the four category SVGs derived from
// assets/sprites/demonPortal.svg, then loads the real game page in Chromium and
// proves each runtime category resolves to its own decoded asset in map drawing,
// cached sprites, the grid surface cache and the entity portrait, with portal
// health bars and ownership tint unchanged. Captures a labeled category sheet and
// map/portrait views at normal and reduced zoom.
//
// Usage: node20 ai/test-coop-typed-portal-svg.js --output-dir DIR
//        node20 ai/test-coop-typed-portal-svg.js --output-dir DIR --fault collapse-mapping|color-only-heavy|missing-ranged-asset
// The parent run (no --fault) runs the three named negative controls as child
// processes under DIR/negative-controls/<fault> and requires each to exit 1 on its
// intended checkpoint. An existing DIR/checkpoints.json is never overwritten (exit 2).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const {spawnSync} = require('node:child_process');
const {JSDOM} = require('jsdom');
if (!process.env.PLAYWRIGHT_BROWSERS_PATH &&
    fs.existsSync(path.join(path.dirname(require.resolve('playwright-core/package.json')), '.local-browsers')))
  process.env.PLAYWRIGHT_BROWSERS_PATH = '0';
const {chromium} = require('playwright');

const root = path.resolve(__dirname, '..');
function option(name) {
  const i = process.argv.indexOf(name);
  if (i < 0) return undefined;
  assert(process.argv[i + 1] && !process.argv[i + 1].startsWith('--'), `value required for ${name}`);
  return process.argv[i + 1];
}
const outArg = option('--output-dir');
if (!outArg) { console.error('usage: --output-dir DIR [--fault NAME]'); process.exit(2); }
const out = path.resolve(root, outArg);
const fault = option('--fault');
const FAULTS = {
  'collapse-mapping': 'map-draw-asset:normal',
  'color-only-heavy': 'silhouette-distinct:demonPortal|demonPortalHeavy',
  'missing-ranged-asset': 'asset-decoded:ranged'
};
if (fault !== undefined && !Object.hasOwn(FAULTS, fault)) { console.error('unknown fault ' + fault); process.exit(2); }
if (fs.existsSync(path.join(out, 'checkpoints.json'))) {
  console.error(`REFUSED existing evidence ${path.relative(root, path.join(out, 'checkpoints.json'))}; not overwriting`);
  process.exit(2);
}

// Independent literal expectations (not read from the game).
const CATEGORIES = ['normal', 'ranged', 'heavy', 'highTier'];
const LABELS = {normal: 'Normal', ranged: 'Ranged', heavy: 'Heavy', highTier: 'High Tier'};
const ASSETS = {normal: 'demonPortalNormal', ranged: 'demonPortalRanged', heavy: 'demonPortalHeavy', highTier: 'demonPortalHighTier'};
const MOTIFS = {normal: 'normal-claw-motif', ranged: 'ranged-arrow-motif', heavy: 'heavy-bastion-motif', highTier: 'high-tier-crown-motif'};
const BASE = 'demonPortal';
const HP = {normal: 30, ranged: 17, heavy: 8, highTier: 3}; // after hits of 0/13/22/27 on 30 max
const DAMAGE = {normal: 0, ranged: 13, heavy: 22, highTier: 27};
// Next-production portrait lines at round 0 (TASK-158): category, train, turns.
const NEXT_AT_ROUND_0 = {normal: ['normal', 'train: imp', 'turns: 4'], ranged: ['ranged', 'train: spitter', 'turns: 8'],
  heavy: ['heavy', 'train: brute', 'turns: 8'], highTier: ['high tier', 'train: ravager', 'turns: 12']};
// Silhouettes are compared as binarized alpha masks at 128 px, so colour cannot contribute.
const SILHOUETTE_SIZE = 128, MAX_SILHOUETTE_IOU = 0.95;
const GAME = {humans: 1, seed: 0, size: 'tiny'};
const SOURCES = ['ai/test-coop-typed-portal-svg.js', 'assets/sprites/demonPortal.svg',
  ...CATEGORIES.map(c => `assets/sprites/${ASSETS[c]}.svg`), 'sprites/entities/buildings/demonPortal.js',
  'render/loadassets.js', 'render/image.js', 'groups/grid.js', 'interface/entityinterface.js', 'sprites/elements/image.js',
  'sprites/entities/entity.js', 'sprites/entities/hpBar.js', 'sprites/hexagon.js', 'ai/wave-config.js', 'ai/generateMap.js', 'index.html'];

const sha = data => crypto.createHash('sha256').update(data).digest('hex');
const hashSources = () => Object.fromEntries(SOURCES.map(p => [p, sha(fs.readFileSync(path.join(root, p)))]));
const checkpoints = [];
function check(id, observed, expected, detail) {
  const pass = JSON.stringify(observed) === JSON.stringify(expected) &&
    (() => { try { assert.deepEqual(observed, expected); return true; } catch { return false; } })();
  checkpoints.push({id, expected, observed, pass, ...(detail ? {detail} : {})});
  if (!pass) {
    console.error(`FAIL ${id} expected=${JSON.stringify(expected)} observed=${JSON.stringify(observed)}`);
    const error = new Error('checkpoint failed: ' + id); error.checkpoint = id; throw error;
  }
  console.log(`PASS ${id} ${JSON.stringify(observed)}`);
}
function write(name, value) {
  fs.writeFileSync(path.join(out, name), JSON.stringify(value, null, 2) + '\n');
}

function validateSvg(source) {
  const doc = new JSDOM(source, {contentType: 'image/svg+xml'}).window.document;
  const svg = doc.documentElement;
  assert.equal(svg.localName, 'svg');
  assert.equal(svg.namespaceURI, 'http://www.w3.org/2000/svg');
  const ids = [...doc.querySelectorAll('[id]')].map(n => n.id);
  const refs = [];
  let external = 0, handlers = 0;
  for (const el of doc.querySelectorAll('*')) for (const attr of el.attributes) {
    if (/^on/i.test(attr.name)) handlers++;
    if (/data:|https?:|\/\//i.test(attr.value) && !attr.name.startsWith('xmlns')) external++;
    if (attr.localName === 'href') refs.push(attr.value.replace(/^#/, ''));
    for (const m of attr.value.matchAll(/url\(\s*['"]?#([^)'"\s]+)['"]?\s*\)/g)) refs.push(m[1]);
    if (attr.name === 'aria-labelledby') refs.push(...attr.value.split(/\s+/));
  }
  return {
    root: svg.localName, viewBox: svg.getAttribute('viewBox'),
    title: Boolean(doc.querySelector('title')?.textContent.trim()), desc: Boolean(doc.querySelector('desc')?.textContent.trim()),
    passiveVectorOnly: doc.querySelectorAll('image, foreignObject, script, style').length === 0 && handlers === 0 && external === 0,
    uniqueIds: new Set(ids).size === ids.length, unresolvedReferences: refs.filter(r => !ids.includes(r)),
    motifs: Object.values(MOTIFS).filter(m => ids.includes(m)), baseGroups: ['obsidian-mound', 'carved-stone-arch', 'recessed-entrance', 'horns', 'runes'].filter(g => ids.includes(g))
  };
}

function runNegativeControls() {
  const results = [];
  for (const [name, marker] of Object.entries(FAULTS)) {
    const dir = path.join(out, 'negative-controls', name);
    fs.mkdirSync(dir, {recursive: true});
    const args = [__filename, '--output-dir', path.relative(root, dir), '--fault', name];
    console.log(`NEGATIVE_CONTROL command=${JSON.stringify([process.execPath, ...args])} cwd=${root}`);
    const r = spawnSync(process.execPath, args, {cwd: root, encoding: 'utf8', env: process.env, timeout: 300000});
    fs.writeFileSync(path.join(dir, 'stdout.log'), r.stdout || '');
    fs.writeFileSync(path.join(dir, 'stderr.log'), r.stderr || '');
    for (const line of (r.stdout || '').split('\n').filter(Boolean)) console.log(`  [${name} stdout] ${line}`);
    for (const line of (r.stderr || '').split('\n').filter(Boolean)) console.log(`  [${name} stderr] ${line}`);
    const failLines = (r.stderr || '').split('\n').filter(l => l.startsWith('FAIL '));
    const observed = {exit: r.status, firstFailure: failLines[0] ? failLines[0].split(' ')[1] : null};
    console.log(`NEGATIVE_CONTROL ${name} exit_status=${r.status} first_failure=${observed.firstFailure}`);
    results.push({name, command: [process.execPath, ...args], expected: {exit: 1, firstFailure: marker}, observed});
  }
  write('negative-controls.json', results);
  for (const r of results) check(`negative-control:${r.name}`, r.observed, r.expected);
}

(async () => {
  fs.mkdirSync(path.join(out, 'screenshots'), {recursive: true});
  const sourcesBefore = hashSources();
  console.log(`cwd=${process.cwd()} runtime=${process.execPath} node=${process.version} fault=${fault || 'none'}`);
  const manifest = {generatedBy: 'ai/test-coop-typed-portal-svg.js', fault: fault || null, base: {}, categories: {}, screenshots: []};
  const browserErrors = [];
  let browser, server, failure = null;
  try {
    // ---- Static SVG validation (served bytes, including any fault substitution) ----
    const served = {};
    for (const name of [BASE, ...CATEGORIES.map(c => ASSETS[c])])
      served[name] = fs.readFileSync(path.join(root, 'assets/sprites', name + '.svg'), 'utf8');
    if (fault === 'color-only-heavy') // recoloured base art that only claims the heavy motif id
      served[ASSETS.heavy] = served[BASE].replace('#fb375d', '#d24a14').replace('#651437', '#5a1a0a')
        .replace('</svg>', `<g id="${MOTIFS.heavy}"/>\n</svg>`);
    for (const [name, source] of Object.entries(served)) {
      const category = CATEGORIES.find(c => ASSETS[c] === name);
      const xml = validateSvg(source);
      check(`svg-valid:${name}`, xml, {root: 'svg', viewBox: '0 0 512 512', title: true, desc: true, passiveVectorOnly: true,
        uniqueIds: true, unresolvedReferences: [], motifs: category ? [MOTIFS[category]] : [],
        baseGroups: ['obsidian-mound', 'carved-stone-arch', 'recessed-entrance', 'horns', 'runes']});
      const entry = {asset: name, path: `assets/sprites/${name}.svg`, sha256: sha(source), bytes: Buffer.byteLength(source), xml};
      if (category) manifest.categories[category] = {label: LABELS[category], ...entry, motif: MOTIFS[category]};
      else manifest.base = {label: 'Uncategorized (older saves/fixtures)', ...entry};
    }
    check('svg-distinct-bytes', new Set(Object.values(served).map(sha)).size, 5);

    // ---- Browser ----
    server = http.createServer((req, res) => {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
      const m = pathname.match(/^\/assets\/sprites\/(demonPortal\w*)\.svg$/);
      if (m && fault === 'missing-ranged-asset' && m[1] === ASSETS.ranged) { res.writeHead(404); res.end('Missing asset'); return; }
      if (m && served[m[1]] !== undefined) { res.writeHead(200, {'Content-Type': 'image/svg+xml'}); res.end(served[m[1]]); return; }
      const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
      if (!file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
      fs.readFile(file, (error, data) => {
        res.writeHead(error ? 404 : 200, {'Content-Type': file.endsWith('.js') ? 'application/javascript' :
          file.endsWith('.html') ? 'text/html' : file.endsWith('.svg') ? 'image/svg+xml' : 'application/octet-stream'});
        res.end(error ? 'Not found' : data);
      });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({headless: true});
    console.log(`browser=chromium version=${browser.version()} playwright=${require('playwright/package.json').version}`);
    manifest.browser = {engine: 'chromium', version: browser.version()};
    const page = await browser.newPage({viewport: {width: 1280, height: 900}, deviceScaleFactor: 1});
    page.on('requestfailed', r => browserErrors.push({type: 'requestfailed', url: r.url(), error: r.failure().errorText}));
    page.on('response', r => { if (r.status() >= 400) browserErrors.push({type: 'http', url: r.url(), status: r.status()}); });
    page.on('pageerror', e => browserErrors.push({type: 'pageerror', message: e.message}));
    page.on('console', m => { if (m.type() === 'error') browserErrors.push({type: 'console', message: m.text()}); });
    // Offline page: stub CDN scripts (socket.io, FileSaver, tfjs).
    await page.route('https://**/*', route => route.fulfill({contentType: 'application/javascript',
      body: route.request().url().includes('socket.io') ? 'window.io=()=>({on(){},emit(){}})' :
        route.request().url().includes('FileSaver') ? 'window.saveAs=()=>{}' : 'window.tf={}'}));
    await page.goto(base + '/', {waitUntil: 'load'});
    const names = [BASE, ...CATEGORIES.map(c => ASSETS[c])];
    await page.waitForFunction(names => names.every(n => assets[n] && assets[n].src && assets[n].complete), names, {timeout: 120000});

    const decoded = await page.evaluate(async names => {
      const result = {};
      for (const n of names) {
        const img = assets[n];
        let decodeOk = false;
        try { await img.decode(); decodeOk = true; } catch (e) { decodeOk = false; }
        result[n] = {registered: demonSpriteImages.includes(n) && spriteImages.includes(n), source: new URL(img.src).pathname,
          decodeOk, naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight};
      }
      return result;
    }, names);
    for (const n of names) {
      const category = CATEGORIES.find(c => ASSETS[c] === n);
      check(`asset-decoded:${category || 'base'}`, decoded[n],
        {registered: true, source: `/assets/sprites/${n}.svg`, decodeOk: true, naturalWidth: 512, naturalHeight: 512});
      (category ? manifest.categories[category] : manifest.base).browserDecode = decoded[n];
    }

    // Colour-independent silhouettes: binarized alpha masks of each asset.
    const masks = await page.evaluate(({names, size}) => {
      const result = {};
      for (const n of names) {
        const c = document.createElement('canvas'); c.width = c.height = size;
        const ctx = c.getContext('2d'); ctx.drawImage(assets[n], 0, 0, size, size);
        const data = ctx.getImageData(0, 0, size, size).data;
        result[n] = Array.from({length: size * size}, (_, i) => data[i * 4 + 3] >= 128 ? 1 : 0).join('');
      }
      return result;
    }, {names, size: SILHOUETTE_SIZE});
    const silhouettes = {};
    for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
      const a = masks[names[i]], b = masks[names[j]];
      let inter = 0, union = 0;
      for (let k = 0; k < a.length; k++) { if (a[k] === '1' && b[k] === '1') inter++; if (a[k] === '1' || b[k] === '1') union++; }
      const iou = Math.round(inter / union * 10000) / 10000;
      silhouettes[`${names[i]}|${names[j]}`] = iou;
    }
    manifest.silhouetteIoU = {size: SILHOUETTE_SIZE, maxAllowed: MAX_SILHOUETTE_IOU, pairs: silhouettes};
    // Check pairs against the base first, then category pairs.
    const pairOrder = Object.keys(silhouettes).sort((x, y) => (y.startsWith(BASE + '|') - x.startsWith(BASE + '|')));
    for (const pair of pairOrder)
      check(`silhouette-distinct:${pair}`, {maxIoU: MAX_SILHOUETTE_IOU, distinct: silhouettes[pair] <= MAX_SILHOUETTE_IOU},
        {maxIoU: 0.95, distinct: true}, {measuredIoU: silhouettes[pair]});

    // Labeled four-category sheet (separate page, same served bytes).
    const sheet = await browser.newPage({viewport: {width: 1320, height: 520}, deviceScaleFactor: 1});
    sheet.on('pageerror', e => browserErrors.push({type: 'pageerror', page: 'sheet', message: e.message}));
    sheet.on('response', r => { if (r.status() >= 400) browserErrors.push({type: 'http', page: 'sheet', url: r.url(), status: r.status()}); });
    await sheet.setContent(`<body style="margin:0;font:18px sans-serif;background:#bbcbb0">
      <div style="padding:8px 14px;font-weight:bold">Typed demon portals: category → asset (256 / 64 / 48 / 32 px)</div>
      <div style="display:flex">${[...CATEGORIES.map(c => [LABELS[c], ASSETS[c]]), ['Uncategorized', BASE]].map(([label, n]) =>
        `<div style="width:264px;text-align:center"><b>${label}</b><br><code style="font-size:13px">${n}.svg</code><br>
        <img width="256" height="256" src="${base}/assets/sprites/${n}.svg"><br>
        <img width="64" height="64" src="${base}/assets/sprites/${n}.svg"><img width="48" height="48" src="${base}/assets/sprites/${n}.svg"><img width="32" height="32" src="${base}/assets/sprites/${n}.svg"></div>`).join('')}</div></body>`);
    await sheet.locator('img').evaluateAll(images => Promise.all(images.map(img => img.decode())));
    async function shot(target, name, opts = {}) {
      const file = path.join(out, 'screenshots', name);
      const bytes = await target.screenshot({path: file, ...opts});
      const entry = {path: path.relative(root, file), sha256: sha(bytes), ...(opts.clip ? {clip: opts.clip} : {})};
      manifest.screenshots.push(entry);
      console.log(`PASS screenshot ${entry.path} sha256=${entry.sha256}`);
      return entry;
    }
    await shot(sheet, 'category-sheet.png');
    await sheet.close();

    // ---- Real generated co-op game ----
    await page.waitForFunction(() => typeof menu !== 'undefined' && menu.visible && imagesCountLoaded === images.length, null, {timeout: 120000});
    const started = await page.evaluate(game => {
      isFogOfWar = false; gameSettings.isOnline = false;
      generateCoopGame(game.humans, {seed: game.seed, size: game.size}).start(GameManager, false);
      actionManager.clear();
      nextTurnPauseInterface.hideButDontUpdateTimer(); timer.pauseAndSaveTime();
      if (game.fault === 'collapse-mapping') // negative control: every category draws the base asset
        Object.defineProperty(DemonPortal.prototype, 'imageName', {get() { return 'demonPortal'; }});
      drawAll();
      return {categories: [...COOP_PORTAL_CATEGORIES], portals: external.filter(e => e.isDemonPortal).map(e => e.category).sort(),
        demonSlot: gameSettings.coop.demonSlot, scale: canvas.scale};
    }, {...GAME, fault: fault || null}).catch(e => { throw new Error('game start failed: ' + e.message); });
    check('runtime-categories', {categories: started.categories, portals: started.portals},
      {categories: CATEGORIES, portals: [...CATEGORIES].sort()});
    manifest.game = {...GAME, demonSlot: started.demonSlot, normalScale: started.scale};

    // Cached sprite canvases: sized to assets.size, nonempty and distinct per category.
    const cached = await page.evaluate(names => {
      const result = {};
      for (const n of names) {
        const c = cachedImages[n];
        const data = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        let ink = 0, minX = c.width, minY = c.height, maxX = -1, maxY = -1;
        for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if (data[(y * c.width + x) * 4 + 3]) {
          ink++; minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
        }
        let h = 0; for (let i = 0; i < data.length; i += 7) h = (h * 31 + data[i]) >>> 0;
        result[n] = {canvas: c instanceof HTMLCanvasElement, sizedToAssets: c.width === Math.floor(assets.size) && c.height === Math.floor(assets.size),
          nonempty: ink > c.width * c.height * 0.1, bounds: {minX, minY, maxX, maxY}, pixelHash: h};
      }
      return result;
    }, names);
    for (const c of CATEGORIES) {
      const {bounds, pixelHash, ...rest} = cached[ASSETS[c]];
      check(`cached-sprite:${c}`, {...rest, boundsNonempty: bounds.maxX > bounds.minX && bounds.maxY > bounds.minY},
        {canvas: true, sizedToAssets: true, nonempty: true, boundsNonempty: true});
      manifest.categories[c].cachedSprite = cached[ASSETS[c]];
    }
    check('cached-sprites-distinct', new Set(names.map(n => cached[n].pixelHash)).size, 5);

    const zoomTo = (target) => page.evaluate(target => {
      const factor = target / canvas.scale;
      if (Math.abs(factor - 1) > 1e-9) gameEvent.screen.scale({x: WIDTH / 2, y: HEIGHT / 2}, Math.log(factor) / 0.001);
      return canvas.scale;
    }, target);
    const minScale = await page.evaluate(() => mapBorder.scale.min);
    const reducedScale = Math.max(minScale, started.scale * 0.5);
    manifest.game.reducedScale = reducedScale;

    for (const c of CATEGORIES) {
      const expectedAsset = ASSETS[c];
      // Damage first so health bars are part of every capture.
      const runtime = await page.evaluate(({c, damage}) => {
        const portal = external.find(e => e.isDemonPortal && e.category === c);
        window.portal = portal;
        if (damage) portal.hit(damage);
        gameEvent.removeSelection();
        gameEvent.selectSomethingOnCell(grid.getCell(portal.coord));
        gameEvent.screen.moveTo({x: portal.pos.x + assets.size / 2, y: portal.pos.y + assets.size / 2});
        let bars = 0; const drawBars = portal.drawBars;
        portal.drawBars = function (ctx) { bars++; return drawBars.call(this, ctx); };
        grid.invalidateSurfaceCache && grid.invalidateSurfaceCache();
        drawAll();
        delete portal.drawBars;
        const calls = []; const rec = {drawImage: (img) => calls.push(img)};
        portal.draw(rec); const direct = calls.slice(); calls.length = 0;
        grid.drawEntityBody(rec, portal); const body = calls.slice(); calls.length = 0;
        entityInterface.img.draw(rec); const portrait = calls.slice(); calls.length = 0;
        const nameOf = img => Object.keys(cachedImages).find(k => cachedImages[k] === img) ||
          ('asset:' + (Object.keys(assets).find(k => assets[k] === img) || 'unknown'));
        const surfaceIndex = grid.surfaceCacheBuildings ? grid.surfaceCacheBuildings.indexOf(portal) : -1;
        // Rendered bounds of the map body on a clean canvas.
        const probe = document.createElement('canvas'); probe.width = probe.height = Math.ceil(assets.size);
        const pctx = probe.getContext('2d'); pctx.translate(-portal.pos.x, -portal.pos.y); portal.draw(pctx);
        const data = pctx.getImageData(0, 0, probe.width, probe.height).data;
        let ink = 0; for (let i = 3; i < data.length; i += 4) if (data[i]) ink++;
        const hex = grid.getHexagon(portal.coord);
        return {
          name: portal.name, imageName: portal.imageName,
          mapDraw: direct.map(nameOf), gridBody: body.map(nameOf),
          surfaceCache: surfaceIndex < 0 ? null : nameOf(grid.surfaceCacheBuildingImages[surfaceIndex]),
          portrait: {image: entityInterface.img.image, drawn: portrait.map(nameOf), visible: entityInterface.visible,
            title: entityInterface.entity.name.text, info: entityInterface.entity.info.text,
            background: entityInterface.background.color, ownerColor: players[portal.ownerSlot].fullColor.hex},
          renderedInk: ink,
          health: {hp: portal.hp, killed: portal.killed, barsDrawn: bars > 0,
            green: portal.hpBar.rects.filter(r => r.color === portal.hpBar.healthColor).length},
          tint: {hexOwner: hex.playerColor, portalOwner: portal.playerColor, demonSlot: gameSettings.coop.demonSlot,
            role: portal.player.role},
          json: {name: portal.toJSON().name, category: portal.toJSON().category}
        };
      }, {c, damage: DAMAGE[c]});
      const slot = started.demonSlot, hp = HP[c];
      check(`map-draw-asset:${c}`, {name: runtime.name, imageName: runtime.imageName, mapDraw: runtime.mapDraw, gridBody: runtime.gridBody,
        surfaceCache: runtime.surfaceCache}, {name: 'demonPortal', imageName: expectedAsset, mapDraw: [expectedAsset],
        gridBody: [expectedAsset], surfaceCache: expectedAsset});
      check(`map-rendered-bounds:${c}`, runtime.renderedInk > 0, true);
      const {ownerColor, background, ...portrait} = runtime.portrait;
      check(`portrait-asset:${c}`, {...portrait, backgroundIsOwnerColor: background === ownerColor},
        {image: expectedAsset, drawn: [`asset:${expectedAsset}`], visible: true, title: 'demon portal',
          info: `hp: ${hp} / 30\ncategory: ${NEXT_AT_ROUND_0[c].join('\n')}`,
          backgroundIsOwnerColor: true}, {background, ownerColor});
      check(`health-bar:${c}`, runtime.health, {hp, killed: false, barsDrawn: true, green: Math.floor(hp / 10) + hp % 10});
      check(`ownership-tint:${c}`, runtime.tint, {hexOwner: slot, portalOwner: slot, demonSlot: slot, role: 'DEMONS'});
      check(`save-identity:${c}`, runtime.json, {name: 'demonPortal', category: c});
      manifest.categories[c].runtime = {mapDraw: runtime.mapDraw[0], gridBody: runtime.gridBody[0], surfaceCache: runtime.surfaceCache,
        portrait: runtime.portrait.image, hp: runtime.health.hp};

      for (const [zoom, scale] of [['normal', started.scale], ['reduced', reducedScale]]) {
        const actual = await zoomTo(scale);
        const clip = await page.evaluate(() => {
          gameEvent.screen.moveTo({x: portal.pos.x + assets.size / 2, y: portal.pos.y + assets.size / 2});
          drawAll();
          const el = mainCtx.canvas, rect = el.getBoundingClientRect(), k = rect.width / el.width;
          const cx = rect.left + (portal.pos.x + assets.size / 2 - canvas.offset.x) * canvas.scale * k;
          const cy = rect.top + (portal.pos.y + assets.size / 2 - canvas.offset.y) * canvas.scale * k;
          const half = Math.max(60, assets.size * canvas.scale * k * 1.1);
          const bg = entityInterface.background;
          return {portal: {x: Math.max(0, cx - half), y: Math.max(0, cy - half), width: 2 * half, height: 2 * half},
            portrait: {x: rect.left + bg.x * k, y: rect.top + bg.y * k, width: bg.width * k, height: bg.height * k}};
        });
        check(`zoom-${zoom}:${c}`, Math.abs(actual - scale) < 1e-6, true);
        await shot(page, `map-${c}-${zoom}.png`);
        await shot(page, `portal-${c}-${zoom}-crop.png`, {clip: clip.portal});
        if (zoom === 'normal') await shot(page, `portrait-${c}.png`, {clip: clip.portrait});
      }
      await zoomTo(started.scale);
    }
    // Whole board at reduced zoom with every category visible, nothing selected.
    await page.evaluate(() => { gameEvent.removeSelection(); gameEvent.screen.moveTo(grid.center); });
    await zoomTo(minScale);
    await page.evaluate(() => drawAll());
    await shot(page, 'map-overview-reduced.png');
    await zoomTo(started.scale);

    // Destroyed portals stop drawing any asset and leave an empty building cell.
    const destroyed = await page.evaluate(() => {
      const portal = external.find(e => e.isDemonPortal && e.category === 'normal');
      const coord = {...portal.coord};
      portal.hit(portal.hp);
      const calls = []; portal.draw({drawImage: img => calls.push(img)});
      return {killed: portal.killed, drawCalls: calls.length, empty: grid.getBuilding(coord).isEmpty(),
        remaining: external.filter(e => e.isDemonPortal).map(e => e.category).sort()};
    });
    check('destroyed-portal-not-drawn:normal', destroyed, {killed: true, drawCalls: 0, empty: true, remaining: ['heavy', 'highTier', 'ranged']});

    check('browser-errors', browserErrors, []);
    const sourcesAfter = hashSources();
    check('sources-unchanged-during-run', sourcesAfter, sourcesBefore);
    if (!fault) runNegativeControls();
  } catch (error) {
    failure = error.checkpoint || String(error && error.stack || error);
    if (!error.checkpoint) console.error('FAIL exception ' + (error && error.stack || error));
  } finally {
    if (browser) await browser.close();
    if (server) await new Promise(resolve => server.close(resolve));
    write('asset-manifest.json', manifest);
    write('browser-errors.json', browserErrors);
    write('source-identities.json', {algorithm: 'sha256', files: sourcesBefore, recheckedAtEnd: hashSources(),
      unchangedDuringRun: JSON.stringify(hashSources()) === JSON.stringify(sourcesBefore)});
    const passed = checkpoints.filter(k => k.pass).length;
    write('checkpoints.json', {program: 'ai/test-coop-typed-portal-svg.js', fault: fault || null, status: failure ? 'failed' : 'passed',
      failure, summary: {total: checkpoints.length, passed, failed: checkpoints.length - passed}, checkpoints});
    if (failure) { console.error(`FAILED typed-portal-svg fault=${fault || 'none'} failure=${failure}`); process.exitCode = 1; }
    else console.log(`PASS typed-portal-svg checkpoints=${checkpoints.length} screenshots=${manifest.screenshots.length} categories=${CATEGORIES.join(',')} negative_controls=${fault ? 'n/a' : Object.keys(FAULTS).map(f => f + ':1').join(',')}`);
  }
})();
