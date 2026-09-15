// Portal next-production information and translucent previews (TASK-158). Loads the
// real game page in Chromium, starts a generated typed co-op game (one portal per
// category) with a real human barracks training an archer as a control, and drives
// every typed wave round 4..36 through the real spawnCoopWave. At each wave it proves
// the pre-wave preview equals the attempted spawn, that the preview advances once the
// wave commits, that a blocked portal shows its next attempt (no backlog), and that a
// selected portal's information refreshes across rounds, schedule upgrades and damage
// without reselection. Also covers late categories before activation, current-format
// save/load (pre- and post-wave), destruction, fog, zoom, repeated rendering and
// globalAlpha restoration, with screenshots.
//
// Usage: node20 ai/test-coop-portal-production.js --output-dir DIR
//        node20 ai/test-coop-portal-production.js --output-dir DIR --fault gameround-only-lookup|queued-backlog|alpha-not-restored|no-selection-refresh
// The parent run (no --fault) runs the named negative controls as child processes under
// DIR/negative-controls/<fault>; each must exit 1 on its intended checkpoint. An
// existing DIR/checkpoints.json is never overwritten (exit 2).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const {spawnSync} = require('node:child_process');
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
  'gameround-only-lookup': {marker: 'wave-4-post:preview-info',
    description: 'preview ignores the committed typedWaves marker and uses gameRound only, so it does not advance after the wave'},
  'queued-backlog': {marker: 'wave-12-post:preview-info',
    description: 'a portal skipped while blocked keeps showing the missed production as a queued backlog'},
  'alpha-not-restored': {marker: 'r0-initial:draw-state',
    description: 'the shared preview draw leaves ctx.globalAlpha at the preview opacity'},
  'no-selection-refresh': {marker: 'wave-4-pre:selected-refresh',
    description: 'portal overlay drawing never refreshes the selected entity interface'}
};
if (fault !== undefined && !Object.hasOwn(FAULTS, fault)) { console.error('unknown fault ' + fault); process.exit(2); }
if (fs.existsSync(path.join(out, 'checkpoints.json'))) {
  console.error(`REFUSED existing evidence ${path.relative(root, path.join(out, 'checkpoints.json'))}; not overwriting`);
  process.exit(2);
}

// Independent literal oracle (not read from ai/wave-config.js or ai/demon-config.js).
const CATEGORIES = ['normal', 'ranged', 'heavy', 'highTier'];
const STEPS = {
  normal: [[4, 'imp'], [8, 'clawling'], [12, 'hound']],
  ranged: [[8, 'spitter'], [12, 'emberArcher'], [16, 'hexcaster']],
  heavy: [[8, 'brute'], [12, 'bulwark']],
  highTier: [[12, 'ravager'], [16, 'demonLord']]
};
const NAMES = {imp: 'imp', clawling: 'clawling', hound: 'hound', brute: 'brute', bulwark: 'bulwark', spitter: 'spitter',
  emberArcher: 'ember archer', hexcaster: 'hexcaster', ravager: 'ravager', demonLord: 'demon lord'};
const LABELS = {normal: 'normal', ranged: 'ranged', heavy: 'heavy', highTier: 'high tier'};
const PORTAL_HP = 30, OPACITY = 0.5, BARRACK_TRAIN = {image: 'archer', turns: 2};
function literalType(category, round) {
  if (round === 0 || round % 4 !== 0) return null;
  let type = null;
  for (const [from, name] of STEPS[category]) if (round >= from) type = name;
  return type;
}
function literalNext(category, completed) {
  for (let round = completed + 1; ; round++) {
    const type = literalType(category, round);
    if (type) return {round, type, roundsRemaining: round - completed};
  }
}
const GAME = {humans: 1, seed: 0, size: 'tiny'};
const SOURCES = ['ai/test-coop-portal-production.js', 'sprites/entities/buildings/demonPortal.js', 'groups/grid.js',
  'render/productionPreview.js', 'render/image.js', 'ai/wave-config.js', 'ai/wave-composition.js', 'ai/wave-placement.js',
  'ai/demon-config.js', 'interface/entityinterface.js', 'options/dictionaryEnumeration.js',
  'sprites/entities/buildings/manufactures/preparingManufacture/production.js',
  'sprites/entities/buildings/manufactures/preparingManufacture/preparingManufacture.js',
  'sprites/entities/buildings/manufactures/preparingManufacture/barrack.js', 'sprites/entities/buildings/building.js',
  'sprites/entities/entity.js', 'gameObjectSerialization.js', 'options/save.js', 'options/gamestart.js', 'ai/generateMap.js',
  'index.html'];

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
  console.log(`PASS ${id} ${JSON.stringify(observed).slice(0, 400)}`);
}
function write(name, value) {
  fs.writeFileSync(path.join(out, name), JSON.stringify(value, null, 2) + '\n');
}

function runNegativeControls() {
  const results = [];
  for (const [name, {marker, description}] of Object.entries(FAULTS)) {
    const dir = path.join(out, 'negative-controls', name);
    fs.mkdirSync(dir, {recursive: true});
    const args = [__filename, '--output-dir', path.relative(root, dir), '--fault', name];
    console.log(`NEGATIVE_CONTROL command=${JSON.stringify([process.execPath, ...args])} cwd=${root}`);
    const r = spawnSync(process.execPath, args, {cwd: root, encoding: 'utf8', env: process.env, timeout: 600000});
    fs.writeFileSync(path.join(dir, 'stdout.log'), r.stdout || '');
    fs.writeFileSync(path.join(dir, 'stderr.log'), r.stderr || '');
    for (const line of (r.stdout || '').split('\n').filter(Boolean)) console.log(`  [${name} stdout] ${line}`);
    for (const line of (r.stderr || '').split('\n').filter(Boolean)) console.log(`  [${name} stderr] ${line}`);
    const failLines = (r.stderr || '').split('\n').filter(l => l.startsWith('FAIL '));
    const observed = {exit: r.status, firstFailure: failLines[0] ? failLines[0].split(' ')[1] : null};
    console.log(`NEGATIVE_CONTROL ${name} exit_status=${r.status} first_failure=${observed.firstFailure}`);
    results.push({name, description, command: [process.execPath, ...args], expected: {exit: 1, firstFailure: marker}, observed});
  }
  write('negative-controls.json', results);
  for (const r of results) check(`negative-control:${r.name}`, r.observed, r.expected);
}

// ---- In-page instrumentation (installed once, after faults) ----
function installPage({game, fault}) {
  isFogOfWar = false; gameSettings.isOnline = false;
  generateCoopGame(game.humans, {seed: game.seed, size: game.size}).start(GameManager, false);
  actionManager.clear();
  nextTurnPauseInterface.hideButDontUpdateTimer(); timer.pauseAndSaveTime();

  if (fault === 'gameround-only-lookup')
    Object.defineProperty(DemonPortal.prototype, 'nextProduction', {configurable: true, get() {
      if (this.killed || this.category === undefined) return null;
      return getCoopNextScheduledProduction(this.category, gameRound);
    }});
  if (fault === 'queued-backlog') {
    const spawn = spawnCoopWave; const missed = {};
    spawnCoopWave = function (round) {
      for (const p of external.filter(p => p.isDemonPortal && !p.killed)) {
        const type = getCoopScheduledDemonType(p.category, round);
        if (type && grid.getUnit(p.coord).notEmpty()) missed[p.coord.x + ',' + p.coord.y] = {round, type};
      }
      return spawn.apply(this, arguments);
    };
    const original = Object.getOwnPropertyDescriptor(DemonPortal.prototype, 'nextProduction').get;
    Object.defineProperty(DemonPortal.prototype, 'nextProduction', {configurable: true, get() {
      const next = original.call(this);
      const queued = next && missed[this.coord.x + ',' + this.coord.y];
      if (!queued) return next;
      const completed = Math.max(gameRound, gameSettings.coop.typedWaves.lastRound);
      return {round: queued.round, type: queued.type, roundsRemaining: Math.max(0, queued.round - completed)};
    }});
  }
  if (fault === 'alpha-not-restored')
    drawProductionPreview = function (ctx, imageName, pos, coord, turns) {
      ctx.globalAlpha = PRODUCTION_PREVIEW_OPACITY;
      drawCachedImage(ctx, cachedImages[imageName], pos);
      if (!coord) return;
      const cell = grid.getCell(coord);
      cell.infoText = new CoordText(coord.x, coord.y, turns, cell.hexColor, CoordText.defaultFontSize, 'white',
        CoordText.defaultFontSize / 5);
    };
  if (fault === 'no-selection-refresh')
    DemonPortal.prototype.drawNextProduction = function (ctx) {
      const next = this.nextProduction;
      if (next) drawProductionPreview(ctx, next.type, this.pos, this.coord, next.roundsRemaining);
    };

  const PP = window.PP = {recording: false, calls: [], spriteAlphas: new Set(), current: null, changes: 0, refs: {}, sprites: null};
  const proto = CanvasRenderingContext2D.prototype, drawImage = proto.drawImage;
  const nameOf = img => Object.keys(cachedImages).find(k => cachedImages[k] === img) || 'other';
  proto.drawImage = function (img) {
    if (PP.recording && this === mainCtx) {
      if (PP.current) PP.current.drawn.push({image: nameOf(img), alpha: this.globalAlpha});
      else if (PP.sprites.has(img) || img === grid.surfaceCache) PP.spriteAlphas.add(this.globalAlpha);
    }
    return drawImage.apply(this, arguments);
  };
  const preview = drawProductionPreview;
  drawProductionPreview = function (ctx, imageName, pos, coord, turns) {
    if (!PP.recording || ctx !== mainCtx) return preview.apply(this, arguments);
    const building = grid.getBuilding(coord);
    const entry = {kind: building.isDemonPortal ? 'portal' : building.name, category: building.isDemonPortal ? building.category : null,
      x: coord.x, y: coord.y, imageName, turns, alphaBefore: ctx.globalAlpha, drawn: []};
    PP.current = entry;
    try { preview.apply(this, arguments); } finally { PP.current = null; }
    entry.alphaAfter = ctx.globalAlpha;
    entry.cellText = String(grid.getCell(coord).infoText.text);
    PP.calls.push(entry);
  };
  const change = entityInterface.change;
  entityInterface.change = function () { PP.changes++; return change.apply(this, arguments); };

  PP.bind = () => { for (const c of COOP_PORTAL_CATEGORIES) PP.refs[c] = external.find(p => p.isDemonPortal && p.category === c) || PP.refs[c]; };
  PP.normalized = () => { const g = JSON.parse(JSON.stringify(getGameObject())); delete g.timers; return JSON.stringify(g); };
  PP.snapshot = () => {
    const coop = gameSettings.coop, sel = gameEvent.selected;
    return {gameRound, lastRound: coop.typedWaves ? coop.typedWaves.lastRound : null,
      portals: COOP_PORTAL_CATEGORIES.map(c => { const p = PP.refs[c];
        return {category: c, killed: Boolean(p.killed), registered: grid.getBuilding(p.coord) === p, hp: p.hp,
          next: p.nextProduction, info: p.info.info}; }),
      selected: sel.isDemonPortal ? {category: sel.category, visible: entityInterface.visible,
        title: entityInterface.entity.name.text, image: entityInterface.img.image, text: entityInterface.entity.info.text} : null};
  };
  PP.drawState = () => {
    const before = PP.normalized(), units = players.map(p => p.units.length), ext = external.length;
    PP.sprites = new Set(Object.values(cachedImages));
    const frames = [];
    for (const mode of ['cached-1', 'cached-2', 'cached-3', 'uncached']) {
      PP.calls = []; PP.spriteAlphas = new Set(); PP.recording = true;
      if (mode === 'uncached') grid.canUseSurfaceCache = () => false;
      const surfaceCacheUsable = grid.canUseSurfaceCache();
      try { drawAll(); } finally { PP.recording = false; delete grid.canUseSurfaceCache; }
      frames.push({mode, surfaceCacheUsable, previews: PP.calls.slice().sort((a, b) => a.x - b.x || a.y - b.y),
        spriteAlphas: [...PP.spriteAlphas].sort(), alphaAfterFrame: mainCtx.globalAlpha});
    }
    drawAll();
    return {frames, stateUnchanged: PP.normalized() === before,
      unitsUnchanged: JSON.stringify(players.map(p => p.units.length)) === JSON.stringify(units), externalUnchanged: external.length === ext};
  };
  PP.bind();
  const demonSlot = gameSettings.coop.demonSlot;
  return {categories: [...COOP_PORTAL_CATEGORIES], generation: gameSettings.coop.generation.version, demonSlot,
    humanSlot: gameSettings.coop.humanSlots[0], scale: canvas.scale, minScale: mapBorder.scale.min,
    portals: Object.fromEntries(COOP_PORTAL_CATEGORIES.map(c => [c, {...PP.refs[c].coord}]))};
}

(async () => {
  fs.mkdirSync(path.join(out, 'screenshots'), {recursive: true});
  const sourcesBefore = hashSources();
  console.log(`cwd=${process.cwd()} runtime=${process.execPath} node=${process.version} fault=${fault || 'none'}`);
  const browserErrors = [], comparisons = [], drawStates = [], observations = [], screenshots = [];
  let browser, server, failure = null, versions = {node: process.version};
  try {
    server = http.createServer((req, res) => {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
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
    versions = {...versions, chromium: browser.version(), playwright: require('playwright/package.json').version};
    console.log(`browser=chromium version=${versions.chromium} playwright=${versions.playwright}`);
    const page = await browser.newPage({viewport: {width: 1280, height: 900}, deviceScaleFactor: 1});
    page.on('requestfailed', r => browserErrors.push({type: 'requestfailed', url: r.url(), error: r.failure().errorText}));
    page.on('response', r => { if (r.status() >= 400) browserErrors.push({type: 'http', url: r.url(), status: r.status()}); });
    page.on('pageerror', e => browserErrors.push({type: 'pageerror', message: e.message}));
    page.on('console', m => { if (m.type() === 'error') browserErrors.push({type: 'console', message: m.text()}); });
    await page.route('https://**/*', route => route.fulfill({contentType: 'application/javascript',
      body: route.request().url().includes('socket.io') ? 'window.io=()=>({on(){},emit(){}})' :
        route.request().url().includes('FileSaver') ? 'window.saveAs=()=>{}' : 'window.tf={}'}));
    await page.goto(base + '/', {waitUntil: 'load'});
    await page.waitForFunction(() => typeof menu !== 'undefined' && menu.visible && imagesCountLoaded === images.length, null, {timeout: 120000});
    const started = await page.evaluate(installPage, {game: GAME, fault: fault || null});
    check('runtime-typed-game', {categories: started.categories, generation: started.generation,
      portals: Object.keys(started.portals).sort()}, {categories: CATEGORIES, generation: 4, portals: [...CATEGORIES].sort()});
    const P = started.portals, demonSlot = started.demonSlot;

    // ---- Real barracks control: a human barracks training an archer ----
    const barrack = await page.evaluate(h => {
      const town = players[h].towns[0];
      const hex = town.suburbs.find(s => !(s.coord.x === town.coord.x && s.coord.y === town.coord.y) &&
        grid.getBuilding(s.coord).isEmpty() && grid.getUnit(s.coord).isEmpty());
      whooseTurn = h;
      const b = new Barrack(hex.coord.x, hex.coord.y, town);
      town.buildings.push(b);
      players[h].gold = 500;
      const ordered = b.prepare('archer');
      actionManager.clear();
      window.barrack = b;
      return {x: b.coord.x, y: b.coord.y, cls: b.constructor.name, ordered, train: b.info.info.train, turns: b.info.info.turns,
        production: b.unitProduction.name, portalShared: typeof DemonPortal.prototype.drawNextProduction === 'function' &&
          !(DemonPortal.prototype instanceof PreparingManufacture) && !(DemonPortal.prototype instanceof Manufacture)};
    }, started.humanSlot);
    check('barracks-control-order', {cls: barrack.cls, ordered: barrack.ordered, train: barrack.train, turns: barrack.turns,
      production: barrack.production, portalNotManufacture: barrack.portalShared},
      {cls: 'Barrack', ordered: true, train: 'archer', turns: 2, production: 'archer', portalNotManufacture: true});

    // ---- Tracked expectations ----
    const S = {gameRound: 0, lastRound: null, alive: new Set(CATEGORIES), hp: Object.fromEntries(CATEGORIES.map(c => [c, PORTAL_HP])),
      selected: null, fogged: null};
    const completed = () => Math.max(S.gameRound, S.lastRound || 0);
    const infoOf = c => {
      if (!S.alive.has(c)) return {hp: `0 / ${PORTAL_HP}`};
      const next = literalNext(c, completed());
      return {hp: `${S.hp[c]} / ${PORTAL_HP}`, category: LABELS[c], train: NAMES[next.type], turns: next.roundsRemaining};
    };
    const textOf = c => Object.entries(infoOf(c)).map(([k, v]) => `${k}: ${v}`).join('\n');
    function expectedPreviews() {
      const rows = CATEGORIES.filter(c => S.alive.has(c) && S.fogged !== c).map(c => {
        const next = literalNext(c, completed());
        return {kind: 'portal', category: c, x: P[c].x, y: P[c].y, imageName: next.type, turns: next.roundsRemaining,
          alphaBefore: 1, drawn: [{image: next.type, alpha: OPACITY}], alphaAfter: 1, cellText: String(next.roundsRemaining)};
      });
      rows.push({kind: 'barrack', category: null, x: barrack.x, y: barrack.y, imageName: BARRACK_TRAIN.image, turns: BARRACK_TRAIN.turns,
        alphaBefore: 1, drawn: [{image: BARRACK_TRAIN.image, alpha: OPACITY}], alphaAfter: 1, cellText: String(BARRACK_TRAIN.turns)});
      return rows.sort((a, b) => a.x - b.x || a.y - b.y);
    }
    async function observe(label) {
      const obs = await page.evaluate(() => PP.snapshot());
      const expected = {gameRound: S.gameRound, lastRound: S.lastRound, portals: CATEGORIES.map(c => S.alive.has(c) ?
        {category: c, killed: false, registered: true, hp: S.hp[c], next: literalNext(c, completed()), info: infoOf(c)} :
        {category: c, killed: true, registered: false, hp: 0, next: null, info: infoOf(c)})};
      const observed = {gameRound: obs.gameRound, lastRound: obs.lastRound, portals: obs.portals};
      observations.push({label, completedRounds: completed(), expected, observed});
      check(`${label}:preview-info`, observed, expected);
      const ds = await page.evaluate(() => PP.drawState());
      // The selected interface refreshes on the next rendered frame (drawState renders).
      if (S.selected)
        check(`${label}:selected-info`, await page.evaluate(() => PP.snapshot().selected), {category: S.selected, visible: true,
          title: 'demon portal', image: 'demonPortal' + S.selected[0].toUpperCase() + S.selected.slice(1), text: textOf(S.selected)});
      const previews = expectedPreviews();
      const expectedDraw = {frames: ['cached-1', 'cached-2', 'cached-3', 'uncached'].map(mode => ({mode, previews,
        spriteAlphas: [1], alphaAfterFrame: 1})), stateUnchanged: true, unitsUnchanged: true, externalUnchanged: true};
      const observedDraw = {...ds, frames: ds.frames.map(({surfaceCacheUsable, ...f}) => f)};
      drawStates.push({label, completedRounds: completed(), expected: expectedDraw, observed: ds});
      check(`${label}:draw-state`, observedDraw, expectedDraw, {surfaceCacheUsable: ds.frames.map(f => f.surfaceCacheUsable)});
    }
    const zoomTo = target => page.evaluate(target => {
      const factor = target / canvas.scale;
      if (Math.abs(factor - 1) > 1e-9) gameEvent.screen.scale({x: WIDTH / 2, y: HEIGHT / 2}, Math.log(factor) / 0.001);
      return canvas.scale;
    }, target);
    async function shot(name, coord, {portrait = false, full = false} = {}) {
      const clips = await page.evaluate(coord => {
        const pos = grid.getCell(coord).pos;
        gameEvent.screen.moveTo({x: pos.x, y: pos.y});
        drawAll();
        const el = mainCtx.canvas, rect = el.getBoundingClientRect(), k = rect.width / el.width;
        const cx = rect.left + (pos.x - canvas.offset.x) * canvas.scale * k;
        const cy = rect.top + (pos.y - canvas.offset.y) * canvas.scale * k;
        const half = Math.max(80, assets.size * canvas.scale * k * 1.6);
        const bg = entityInterface.background;
        return {crop: {x: Math.max(0, cx - half), y: Math.max(0, cy - half), width: 2 * half, height: 2 * half},
          portrait: {x: rect.left + bg.x * k, y: rect.top + bg.y * k, width: bg.width * k, height: bg.height * k}};
      }, coord);
      const entries = [];
      const one = async (file, clip) => {
        const target = path.join(out, 'screenshots', file);
        const bytes = await page.screenshot({path: target, ...(clip ? {clip} : {})});
        const entry = {path: path.relative(root, target), sha256: sha(bytes), round: S.gameRound, lastRound: S.lastRound, ...(clip ? {clip} : {})};
        screenshots.push(entry); entries.push(entry);
        console.log(`PASS screenshot ${entry.path} sha256=${entry.sha256}`);
        return bytes;
      };
      const bytes = await one(`${name}-crop.png`, clips.crop);
      if (full) await one(`${name}-map.png`);
      if (portrait) await one(`${name}-portrait.png`, clips.portrait);
      return bytes;
    }
    const select = c => page.evaluate(coord => {
      // Select the portal itself: a spawned demon may stand on its cell.
      const building = grid.getBuilding(coord);
      gameEvent.removeSelection(); building.select(); gameEvent.selected = building; drawAll();
      return gameEvent.selected.isDemonPortal ? gameEvent.selected.category : null;
    }, P[c]).then(selected => { check(`select-${c}-r${S.gameRound}`, selected, c); S.selected = c; });

    // ---- r0: every category before activation (Ranged, Heavy, High Tier are late) ----
    await select('normal');
    await observe('r0-initial');
    for (const c of CATEGORIES) await shot(`r0-before-activation-${c}`, P[c], {portrait: c === 'normal'});
    const barrackBytes = await shot('r0-barracks-control', barrack);
    const portalBytes = await shot('r0-normal-portal-control', P.normal);
    const sheet = await browser.newPage({viewport: {width: 900, height: 520}, deviceScaleFactor: 1});
    await sheet.setContent(`<body style="margin:0;font:16px sans-serif;background:#ddd"><div style="padding:8px"><b>Side by side (same helper, same frame state)</b></div>
      <div style="display:flex;gap:16px;padding:8px">
      <div><b>Real barracks</b>: train archer, turns ${BARRACK_TRAIN.turns}<br><img src="data:image/png;base64,${barrackBytes.toString('base64')}"></div>
      <div><b>Normal portal</b>: train imp, turns 4<br><img src="data:image/png;base64,${portalBytes.toString('base64')}"></div></div></body>`);
    await sheet.locator('img').evaluateAll(imgs => Promise.all(imgs.map(i => i.decode())));
    const sideBytes = await sheet.screenshot({path: path.join(out, 'screenshots', 'side-by-side-barracks-vs-portal.png')});
    screenshots.push({path: path.relative(root, path.join(out, 'screenshots', 'side-by-side-barracks-vs-portal.png')), sha256: sha(sideBytes), composedFrom: ['r0-barracks-control-crop.png', 'r0-normal-portal-control-crop.png']});
    await sheet.close();

    // Fog: a fogged portal draws no preview and sets no turns text; visible ones are unchanged.
    // The game was started without fog, so fog-layer hexagon sprites were never created;
    // only that layer's painting is skipped here, the per-cell visibility checks are real.
    await page.evaluate(coord => {
      window.savedFog = {enabled: isFogOfWar, arr: grid.fogOfWar};
      grid.fogOfWar = grid.arr.map(column => column.map(() => 1));
      grid.fogOfWar[coord.x][coord.y] = 0;
      grid.drawFogOfWar = () => {};
      isFogOfWar = true;
    }, P.highTier);
    S.fogged = 'highTier';
    await observe('r0-fog-high-tier');
    await page.evaluate(() => { isFogOfWar = savedFog.enabled; grid.fogOfWar = savedFog.arr; delete grid.drawFogOfWar; drawAll(); });
    S.fogged = null;

    async function wave(R, {block = [], afterPre, afterPost} = {}) {
      // Round boundary with the selection kept: information must refresh on draw.
      const previousText = S.selected && S.alive.has(S.selected) ? textOf(S.selected) : null;
      const refresh = await page.evaluate(R => {
        const sel = gameEvent.selected, before = entityInterface.entity.info.text, c0 = PP.changes;
        gameRound = R - 1;
        const staleBeforeDraw = entityInterface.entity.info.text === before;
        drawAll(); const after = entityInterface.entity.info.text, c1 = PP.changes;
        drawAll(); drawAll(); const c2 = PP.changes;
        return {sameSelection: gameEvent.selected === sel, before, staleBeforeDraw, after, changesFirstDraw: c1 - c0, changesRepeatedDraws: c2 - c1};
      }, R);
      S.gameRound = R - 1;
      if (S.selected) {
        const text = textOf(S.selected);
        check(`wave-${R}-pre:selected-refresh`, refresh, {sameSelection: true, before: previousText, staleBeforeDraw: true, after: text,
          changesFirstDraw: previousText === text ? 0 : 1, changesRepeatedDraws: 0});
      }
      for (const c of block) {
        const blocker = await page.evaluate(coord => { const u = new Imp(coord.x, coord.y); return {name: u.name, owner: u.playerColor}; }, P[c]);
        check(`wave-${R}-block-${c}`, blocker, {name: 'imp', owner: demonSlot});
      }
      await observe(`wave-${R}-pre`);
      if (afterPre) await afterPre();
      const completedBefore = completed();
      const res = await page.evaluate(R => {
        const live = external.filter(p => p.isDemonPortal && !p.killed);
        const pre = live.map(p => ({category: p.category, x: p.coord.x, y: p.coord.y, next: p.nextProduction, train: p.info.info.train,
          turns: p.info.info.turns, attempted: getCoopScheduledDemonType(p.category, R), blocked: grid.getUnit(p.coord).notEmpty()}));
        const composed = composeTypedCoopWave(R, live.map(p => ({x: p.coord.x, y: p.coord.y, category: p.category}))).selections;
        const result = spawnCoopWave(R);
        return {pre, composed, result, lastRound: gameSettings.coop.typedWaves.lastRound};
      }, R);
      const rows = CATEGORIES.filter(c => S.alive.has(c)).map(c => {
        const pre = res.pre.find(p => p.category === c), literal = literalType(c, R), blocked = block.includes(c);
        const spawned = res.result.spawned.filter(s => s.x === P[c].x && s.y === P[c].y).map(s => s.type);
        const composed = res.composed.find(s => s.x === P[c].x && s.y === P[c].y);
        return {round: R, category: c, x: P[c].x, y: P[c].y, completedBeforeWave: completedBefore, blocked,
          preview: {round: pre.next.round, type: pre.next.type, roundsRemaining: pre.next.roundsRemaining, train: pre.train, turns: pre.turns},
          pureLookupAttempt: pre.attempted, composedSelection: composed ? composed.type : null, literalAttempt: literal, spawned,
          previewMatchesAttempt: literal ? pre.next.round === R && pre.next.type === pre.attempted : pre.next.round > R};
      });
      comparisons.push(...rows);
      check(`wave-${R}-spawn-identity`, rows.map(r => ({category: r.category, preview: r.preview, pureLookupAttempt: r.pureLookupAttempt,
        composedSelection: r.composedSelection, spawned: r.spawned, previewMatchesAttempt: r.previewMatchesAttempt})),
        rows.map(r => { const next = literalNext(r.category, completedBefore), literal = literalType(r.category, R);
          return {category: r.category, preview: {...next, train: NAMES[next.type], turns: next.roundsRemaining},
            pureLookupAttempt: literal, composedSelection: literal, spawned: literal && !r.blocked ? [literal] : [], previewMatchesAttempt: true}; }));
      // Occupied portals are filtered out before composition (ai/wave-composition.js), so
      // they are never placement selections: skipped stays 0 and nothing spawns there.
      check(`wave-${R}-committed`, {skipped: res.result.skipped, lastRound: res.lastRound,
        blockedSpawns: rows.filter(r => r.blocked).flatMap(r => r.spawned)}, {skipped: 0, lastRound: R, blockedSpawns: []});
      S.lastRound = R;
      await observe(`wave-${R}-post`);
      if (afterPost) await afterPost();
      const cleared = await page.evaluate(slot => { const live = players[slot].units.filter(u => !u.killed); live.forEach(u => u.kill()); drawAll(); return live.length; }, demonSlot);
      check(`wave-${R}-cleared-demons`, cleared, rows.filter(r => r.literalAttempt).length);
      await page.evaluate(R => { gameRound = R; drawAll(); }, R);
      S.gameRound = R;
    }

    // Normal: before upgrade (imp at 4) and after upgrade (clawling at 8), selected throughout.
    await wave(4, {afterPre: () => shot('wave-4-pre-normal-imp', P.normal, {portrait: true}),
      afterPost: () => shot('wave-4-post-normal-upgraded-clawling', P.normal, {portrait: true})});
    // Ranged activates at 8; then damage refreshes the selected ranged portal.
    await wave(8, {afterPost: async () => {
      await select('ranged');
      const hit = await page.evaluate(coord => { const p = grid.getBuilding(coord), c0 = PP.changes, next = JSON.stringify(p.nextProduction);
        p.hit(13); drawAll(); return {changes: PP.changes - c0, hp: p.hp, previewUnchanged: JSON.stringify(p.nextProduction) === next,
          text: entityInterface.entity.info.text, sameSelection: gameEvent.selected === p}; }, P.ranged);
      S.hp.ranged = PORTAL_HP - 13;
      check('wave-8-post:damage-refresh', hit, {changes: 1, hp: S.hp.ranged, previewUnchanged: true, text: textOf('ranged'), sameSelection: true});
      await observe('wave-8-post-damaged-ranged');
      await shot('wave-8-post-damaged-ranged', P.ranged, {portrait: true});
    }});
    // Heavy's bulwark upgrade wave is blocked: next attempt, not a backlog.
    await wave(12, {block: ['heavy'], afterPre: () => shot('wave-12-pre-blocked-heavy', P.heavy),
      afterPost: () => shot('wave-12-post-blocked-heavy-next-attempt', P.heavy)});
    await select('heavy');
    await wave(16, {afterPost: async () => {
      const heavy = comparisons.filter(r => r.round === 16 && r.category === 'heavy')[0];
      check('wave-16-no-backlog-heavy', {spawned: heavy.spawned, totalSpawnedThisWave: comparisons.filter(r => r.round === 16).flatMap(r => r.spawned).length},
        {spawned: ['bulwark'], totalSpawnedThisWave: 4});
      await shot('wave-16-post-heavy-once-ranged-upgraded', P.heavy, {portrait: true, full: true});
    }});

    // Current-format save/load at the pre-wave and committed-wave boundaries of round 20.
    let savedPre, savedPost, spawned20;
    await wave(20, {afterPre: async () => { savedPre = await page.evaluate(() => JSON.stringify(getGameObject())); },
      afterPost: async () => {
        savedPost = await page.evaluate(() => JSON.stringify(getGameObject()));
        spawned20 = comparisons.filter(r => r.round === 20).map(r => ({category: r.category, spawned: r.spawned}));
      }});
    const after20 = {...S, alive: new Set(S.alive), hp: {...S.hp}};
    const load = async (label, saved) => {
      const r = await page.evaluate(saved => {
        gameEvent.removeSelection();
        const before = JSON.parse(saved); delete before.timers;
        loadFromJson(saved);
        nextTurnPauseInterface.hideButDontUpdateTimer(); timer.pauseAndSaveTime();
        PP.bind(); window.barrack = grid.getBuilding(barrack.coord); drawAll();
        return {roundTrip: PP.normalized() === JSON.stringify(before), portals: external.filter(p => p.isDemonPortal).length,
          barrackTrain: grid.getBuilding(barrack.coord).info.info.train};
      }, saved);
      check(`${label}:round-trip`, r, {roundTrip: true, portals: 4, barrackTrain: 'archer'});
    };
    await load('load-r20-pre-wave', savedPre);
    S.gameRound = 19; S.lastRound = 16; S.selected = null;
    await select('heavy');
    await observe('load-r20-pre-wave');
    await shot('load-r20-pre-wave-restored', P.heavy, {portrait: true});
    const reloaded = await page.evaluate(() => spawnCoopWave(20));
    check('load-r20-pre-wave:spawn-identity', CATEGORIES.map(c => ({category: c,
      spawned: reloaded.spawned.filter(s => s.x === P[c].x && s.y === P[c].y).map(s => s.type)})), spawned20);
    S.lastRound = 20;
    await observe('load-r20-pre-wave-continued-post');
    await load('load-r20-post-wave', savedPost);
    S.gameRound = 19; S.lastRound = 20; S.selected = null;
    await observe('load-r20-post-wave');
    check('load-r20-post-wave:no-repeated-wave', await page.evaluate(() => spawnCoopWave(20)), {spawned: [], skipped: 0});
    await page.evaluate(slot => { players[slot].units.filter(u => !u.killed).forEach(u => u.kill()); gameRound = 20; drawAll(); }, demonSlot);
    Object.assign(S, {gameRound: after20.gameRound, lastRound: after20.lastRound});

    // Destruction of the selected normal portal: no preview, no information, no spawn.
    await select('normal');
    const destroyed = await page.evaluate(coord => { const p = grid.getBuilding(coord); window.destroyedPortal = p; p.hit(p.hp); drawAll();
      return {killed: p.killed, next: p.nextProduction, selectionRemoved: !gameEvent.selected.isDemonPortal, interfaceVisible: entityInterface.visible,
        building: grid.getBuilding(coord).isEmpty() ? 'empty' : grid.getBuilding(coord).name}; }, P.normal);
    S.alive.delete('normal'); S.hp.normal = 0; S.selected = null;
    check('r20-destroyed-normal', destroyed, {killed: true, next: null, selectionRemoved: true, interfaceVisible: false, building: 'empty'});
    await observe('r20-destroyed-normal');
    await shot('r20-destroyed-normal-no-preview', P.normal);
    await select('highTier');
    await wave(24);
    await wave(28);
    // Zoom: selected High Tier portal before a wave at normal and reduced zoom.
    await wave(32, {afterPre: async () => {
      await shot('wave-32-pre-high-tier-zoom-normal', P.highTier, {portrait: true, full: true});
      const reduced = Math.max(started.minScale, started.scale * 0.5);
      const actual = await zoomTo(reduced);
      check('wave-32-pre:zoom-reduced', Math.abs(actual - reduced) < 1e-6, true, {scale: actual});
      await observe('wave-32-pre-zoom-reduced');
      await shot('wave-32-pre-high-tier-zoom-reduced', P.highTier, {full: true});
      await zoomTo(started.minScale);
      await page.evaluate(() => { gameEvent.screen.moveTo(grid.center); drawAll(); });
      await observe('wave-32-pre-zoom-minimum');
      screenshots.push(await (async () => { const f = path.join(out, 'screenshots', 'wave-32-pre-overview-minimum-zoom.png');
        const b = await page.screenshot({path: f}); return {path: path.relative(root, f), sha256: sha(b), round: S.gameRound}; })());
      const back = await zoomTo(started.scale);
      check('wave-32-pre:zoom-restored', Math.abs(back - started.scale) < 1e-6, true, {scale: back});
    }});
    await wave(36, {afterPost: () => shot('wave-36-post-high-tier-demon-lord-next', P.highTier, {portrait: true})});

    const repeated = await page.evaluate(() => { const before = PP.normalized(), units = players.map(p => p.units.length).join();
      for (let i = 0; i < 25; i++) drawAll();
      return {stateUnchanged: PP.normalized() === before, unitsUnchanged: players.map(p => p.units.length).join() === units,
        destroyedPortalNext: destroyedPortal.nextProduction, alpha: mainCtx.globalAlpha}; });
    check('repeated-rendering-no-units', repeated, {stateUnchanged: true, unitsUnchanged: true, destroyedPortalNext: null, alpha: 1});
    check('screenshots-captured', screenshots.every(s => fs.statSync(path.join(root, s.path)).size > 1000) && screenshots.length >= 25, true,
      {count: screenshots.length});
    check('browser-errors', browserErrors, []);
    check('sources-unchanged-during-run', hashSources(), sourcesBefore);
    if (!fault) runNegativeControls();
  } catch (error) {
    failure = error.checkpoint || String(error && error.stack || error);
    if (!error.checkpoint) console.error('FAIL exception ' + (error && error.stack || error));
  } finally {
    if (browser) await browser.close();
    if (server) await new Promise(resolve => server.close(resolve));
    write('preview-spawn-comparisons.json', {oracle: 'literal STEPS table in ai/test-coop-portal-production.js', observations, waves: comparisons});
    write('draw-state-checkpoints.json', drawStates);
    write('browser-errors.json', browserErrors);
    write('screenshots.json', screenshots);
    write('source-identities.json', {algorithm: 'sha256', files: sourcesBefore, recheckedAtEnd: hashSources(),
      unchangedDuringRun: JSON.stringify(hashSources()) === JSON.stringify(sourcesBefore)});
    const passed = checkpoints.filter(k => k.pass).length;
    write('checkpoints.json', {program: 'ai/test-coop-portal-production.js', fault: fault || null, versions,
      status: failure ? 'failed' : 'passed', failure, summary: {total: checkpoints.length, passed, failed: checkpoints.length - passed}, checkpoints});
    if (failure) { console.error(`FAILED portal-production fault=${fault || 'none'} failure=${failure}`); process.exitCode = 1; }
    else console.log(`PASS portal-production checkpoints=${checkpoints.length} screenshots=${screenshots.length} negative_controls=${fault ? 'n/a' : Object.keys(FAULTS).map(f => f + ':1').join(',')}`);
  }
})();
