// Reproduces the reported in-game zoom crash (undefined drawChanceOfWinningText
// access) in real local co-op games started through the menu with real wheel,
// keyboard and mouse input. Production code is not patched or stubbed.
// Each size runs two phases:
//   fresh: new ten-human game, zoom, one full round, menu resume, zoom (clean).
//   legacy-slot: the saved slot is turned into a save written before settings
//     persistence (no gameSettings key). Its menu Load throws after replacing
//     gameSettings with {isOnline:false}; the next new co-op game then crashes on
//     its first frame and later zoom changes scale on a frozen board.
//     Both modes then dismiss the card, zoom out and capture the legacy board.
//   default: regression mode, fails when the target failure is observed or the
//     legacy game's animation frames stop while its scale changes
//   --expect-reproduction: diagnostic, succeeds only when the target failure and
//     a real scale change are observed in the same game and no unrelated page
//     error happened
//   --matrix: functional zoom matrix, see runMatrix
const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
// Browser tests run with NODE_PATH/PLAYWRIGHT_BROWSERS_PATH; default both so the plain command works too.
if (process.env.PLAYWRIGHT_BROWSERS_PATH === undefined) process.env.PLAYWRIGHT_BROWSERS_PATH = '0';
const {chromium} = require('playwright');

const root = path.resolve(__dirname, '..');
const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : process.argv[index + 1];
};
const humans = Number(arg('--humans', '10'));
const expectReproduction = process.argv.includes('--expect-reproduction');
const matrixMode = process.argv.includes('--matrix');
const sizes = arg('--sizes', 'tiny,normal,big').split(',');
const out = path.resolve(arg('--output-dir', path.join(root, matrixMode ? 'artifacts/TASK-149' : 'artifacts/TASK-147')));
const TARGET = /Cannot read properties of undefined \(reading 'drawChanceOfWinningText'\)/;
// The legacy slot restore fails on its co-op portals; this is part of the chain, not unrelated.
const LEGACY_LOAD_ERROR = /^portal requires demon ownership$/;
const SIZE_LABELS = {tiny: 'Tiny', normal: 'Normal', big: 'Big'};
assert.ok(Number.isInteger(humans) && humans >= 1 && humans <= 12, 'humans must be 1..12');
for (const size of sizes) assert.ok(SIZE_LABELS[size], 'unknown size ' + size);

const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');
const checkpoints = [];
function check(checkpoint, observed, expected) {
  const passed = JSON.stringify(observed) === JSON.stringify(expected);
  checkpoints.push({checkpoint, expected, observed, passed});
  console.log(`${passed ? 'PASS' : 'MISMATCH'} ${checkpoint} expected=${JSON.stringify(expected)} observed=${JSON.stringify(observed)}`);
  return passed;
}

function startServer(served) {
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname === '/favicon.ico') {res.writeHead(204); res.end(); return;}
    const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(root + path.sep)) {res.writeHead(403); res.end(); return;}
    fs.readFile(file, (error, data) => {
      if (!error) served.add(path.relative(root, file));
      res.writeHead(error ? 404 : 200, {'Content-Type': file.endsWith('.js') ? 'application/javascript' :
        file.endsWith('.html') ? 'text/html' : file.endsWith('.svg') ? 'image/svg+xml' : 'application/octet-stream'});
      res.end(error ? 'Not found' : data);
    });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}
// Offline local game: no networking, downloads or learned AI.
const routeOffline = page => page.route('https://**/*', route => route.fulfill({contentType: 'application/javascript',
  body: route.request().url().includes('socket.io') ? 'window.io=()=>({on(){},emit(){}})' :
    route.request().url().includes('FileSaver') ? 'window.saveAs=()=>{}' : 'window.tf={}'}));

// --matrix: seed 0, Tiny/Normal/Big x 1/2/4/10/12 initial humans, every case
// started through the local menu and driven by real browser input only.
//   desktop page: wheel to both clamps with the combat overlay off, click-select
//     after zoom, I key turns the overlay on, wheel to both clamps again, viewport
//     resize and zoom, Back-to-menu save (current format), menu Load, zoom.
//   touch page (mobile user agent, so the game registers its touch handlers):
//     taps Load on that save and pinches to both clamps with CDP touch events.
// Pass-through wrappers count Grid.draw/drawChanceOfWinningText calls; they call
// the original and never catch. --cases limits the run (e.g. tiny-H1).
// Negative controls, expected to fail: --fault drop-interface removes
// gameSettings.interface (the original defect state); --fault skip-overlay
// never presses I, so the overlay-on assertions cannot pass vacuously.
const MATRIX_SIZES = ['tiny', 'normal', 'big'];
const MATRIX_HUMANS = [1, 2, 4, 10, 12];
const MATRIX_SEED = 0;
const DESKTOP = {width: 1280, height: 900};
const RESIZED = {width: 1000, height: 700};
const TOUCH_UA = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36';
// Independent of the game: co-op side length (TASK-083) and camera bounds min = 5 / side, max = 1.
const expectedSide = (size, count) => Math.max({tiny: 11, normal: 15, big: 21}[size],
  Math.ceil({tiny: 15, normal: 25, big: 39}[size] * Math.sqrt(count / 4)));
const atBound = (value, bound) => Math.abs(value - bound) <= 1e-9 * Math.max(1, Math.abs(bound));

async function runMatrix() {
  const started = Date.now();
  const fault = arg('--fault', null);
  assert.ok(fault === null || ['drop-interface', 'skip-overlay'].includes(fault), 'unknown fault ' + fault);
  const allIds = MATRIX_SIZES.flatMap(size => MATRIX_HUMANS.map(count => `${size}-H${count}`));
  const selected = arg('--cases', null) ? arg('--cases').split(',') : allIds;
  for (const id of selected) assert.ok(allIds.includes(id), 'unknown case ' + id);
  if (fs.existsSync(path.join(out, 'matrix.json'))) {
    console.error(`FAIL output-exists: ${path.join(out, 'matrix.json')} (never overwrite earlier evidence)`);
    process.exitCode = 1;
    return;
  }
  fs.mkdirSync(path.join(out, 'screenshots'), {recursive: true});
  let stage = 'server startup';
  const progress = label => {
    stage = label;
    console.log(`browser_stage=${label} elapsed_ms=${Date.now() - started}`);
  };
  const deadline = setTimeout(() => {
    console.error(`FAIL browser deadline stage=${stage} elapsed_ms=${Date.now() - started}`);
    process.exit(1);
  }, 3 * 3600 * 1000);
  deadline.unref();
  const served = new Set();
  const server = await startServer(served);
  const url = `http://127.0.0.1:${server.address().port}/`;
  const matrix = {mode: 'matrix', seed: MATRIX_SEED, fault, selectedCases: selected, fullMatrix: selected.length === allIds.length,
    node: process.version, cwd: process.cwd(), argv: process.argv.slice(1), target: TARGET.source, cases: []};
  const traces = {}, browserErrors = [];
  let browser, fatal = null;
  try {
    browser = await chromium.launch({headless: true});
    matrix.browser = {engine: 'chromium', version: browser.version()};
    console.log('browser_engine=chromium browser_version=' + browser.version() + ' node=' + process.version);
    for (const id of selected) {
      const [size, humanLabel] = id.split('-');
      const trace = traces[id] = [];
      const entry = {id, size, humans: Number(humanLabel.slice(1)), seed: MATRIX_SEED, status: 'running', screenshots: [], errors: []};
      matrix.cases.push(entry);
      const caseStart = Date.now(), firstCheckpoint = checkpoints.length;
      try {
        await matrixCase(browser, url, entry, trace, browserErrors, fault, progress);
      } catch (error) {
        entry.fatal = String(error.stack || error);
        console.error(`FAIL case=${id} stage=${stage}`, error);
      }
      check(`${id}-completed-without-exception`, entry.fatal || null, null);
      const caseChecks = checkpoints.slice(firstCheckpoint);
      entry.checkpoints = {total: caseChecks.length, failed: caseChecks.filter(c => !c.passed).map(c => c.checkpoint)};
      entry.status = entry.checkpoints.failed.length ? 'failed' : 'passed';
      entry.elapsedMs = Date.now() - caseStart;
      console.log(`CASE ${id} status=${entry.status} checkpoints=${caseChecks.length} failed=${entry.checkpoints.failed.length} ` +
        `map=${entry.launched ? entry.launched.mapSize.join('x') : '?'} pageErrors=${entry.errors.filter(e => e.kind === 'pageerror').length} ` +
        `elapsed_ms=${entry.elapsedMs}`);
    }
  } catch (error) {
    fatal = error;
    console.error(`FAIL stage=${stage}`, error);
  } finally {
    progress('cleanup');
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
    clearTimeout(deadline);
  }

  const pageErrors = browserErrors.filter(error => error.kind === 'pageerror');
  const targets = browserErrors.filter(error => error.target);
  check('matrix-browser-started', !!matrix.browser && !fatal, true);
  if (matrix.fullMatrix)
    check('matrix-case-ids', matrix.cases.map(entry => entry.id), allIds);
  check('matrix-distinct-cases', new Set(matrix.cases.map(entry => entry.id)).size, selected.length);
  check('matrix-failed-cases', matrix.cases.filter(entry => entry.status !== 'passed').map(entry => entry.id), []);
  check('matrix-uncaught-page-errors', pageErrors.length, 0);
  matrix.summary = {cases: matrix.cases.length, passed: matrix.cases.filter(entry => entry.status === 'passed').length,
    pageErrors: pageErrors.length, consoleErrors: browserErrors.length - pageErrors.length, targetErrors: targets.length,
    fatal: fatal ? String(fatal.stack || fatal) : null, elapsedMs: Date.now() - started};
  const sources = [...new Set([path.relative(root, __filename), ...served])].filter(file => file.endsWith('.js') || file.endsWith('.html')).sort();
  fs.writeFileSync(path.join(out, 'source-identities.json'), JSON.stringify(sources.map(file =>
    ({file, sha256: sha256(fs.readFileSync(path.join(root, file)))})), null, 2) + '\n');
  fs.writeFileSync(path.join(out, 'input-traces.json'), JSON.stringify(traces, null, 2) + '\n');
  fs.writeFileSync(path.join(out, 'browser-errors.json'), JSON.stringify(browserErrors, null, 2) + '\n');
  fs.writeFileSync(path.join(out, 'checkpoints.json'), JSON.stringify({mode: 'matrix', seed: MATRIX_SEED, fault,
    cases: selected, total: checkpoints.length, failed: checkpoints.filter(c => !c.passed).length, checkpoints}, null, 2) + '\n');
  fs.writeFileSync(path.join(out, 'matrix.json'), JSON.stringify(matrix, null, 2) + '\n');
  console.log(`SUMMARY ${JSON.stringify(matrix.summary)}`);
  const failed = checkpoints.filter(c => !c.passed);
  if (failed.length) {
    if (targets.length) console.error(`FAIL target-defect-observed: ${targets[0].message}\n${targets[0].stack || ''}`);
    console.error('FAIL checkpoints: ' + failed.map(c => c.checkpoint).join(', '));
    process.exitCode = 1;
    return;
  }
  console.log(`PASS co-op zoom matrix cases=${matrix.cases.length} seed=${MATRIX_SEED} checkpoints=${checkpoints.length}`);
}

async function matrixCase(browser, url, entry, trace, browserErrors, fault, progress) {
  const {id, size, humans: count} = entry;
  let phase = 'launch';
  const contexts = [];
  const openPage = async (pageName, options) => {
    const context = await browser.newContext({viewport: DESKTOP, deviceScaleFactor: 1, ...options});
    contexts.push(context);
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    const record = (kind, message, detail) => {
      const error = {case: id, page: pageName, phase, kind, message, ...detail, afterInput: trace.length - 1, target: TARGET.test(message)};
      entry.errors.push(error); browserErrors.push(error);
      console.log(`${kind} case=${id} page=${pageName} phase=${phase} target=${error.target} message=${message}`);
    };
    page.on('pageerror', error => record('pageerror', error.message, {stack: error.stack}));
    page.on('console', message => {
      if (message.type() === 'error') record('console', message.text(), {location: message.location()});
    });
    await routeOffline(page);
    await page.goto(url, {waitUntil: 'load'});
    await page.waitForFunction(() => typeof menu !== 'undefined' && menu.visible &&
      imagesCountLoaded === images.length, undefined, {timeout: 120000});
    // Observation only: count calls, then run the original unchanged.
    await page.evaluate(() => {
      window.__zoomObs = {draws: 0, overlayDraws: 0, wheels: 0, touchMoves: 0};
      // Input reached the page: each notch/move waits for its own dispatch.
      document.addEventListener('mousewheel', () => { __zoomObs.wheels++; });
      document.addEventListener('touchmove', () => { __zoomObs.touchMoves++; }, {passive: true});
      const draw = Grid.prototype.draw, overlay = Grid.prototype.drawChanceOfWinningText;
      Grid.prototype.draw = function (ctx) { __zoomObs.draws++; return draw.call(this, ctx); };
      Grid.prototype.drawChanceOfWinningText = function (ctx) { __zoomObs.overlayDraws++; return overlay.call(this, ctx); };
    });
    return {page, context, name: pageName};
  };
  const input = (p, type, detail = {}) => {
    const step = {index: trace.length, page: p.name, phase, input: type, ...detail};
    trace.push(step);
    return step;
  };
  const view = p => p.page.evaluate(() => ({
    scale: canvas.scale, offset: {x: canvas.offset.x, y: canvas.offset.y},
    bounds: mapBorder && mapBorder.scale ? {min: mapBorder.scale.min, max: mapBorder.scale.max} : null,
    frameTime: lastGameFrameTime === undefined ? null : lastGameFrameTime,
    draws: __zoomObs.draws, overlayDraws: __zoomObs.overlayDraws,
    overlay: gameSettings.interface ? gameSettings.interface.drawChanceOfWinningText : 'interface-missing',
    menu: menu.visible, pause: nextTurnPauseInterface.visible, viewport: [innerWidth, innerHeight],
    visualViewportScale: visualViewport.scale,
  }));
  const content = p => p.page.evaluate(() => {
    const c = document.getElementById('canvas'), data = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    const colors = new Set();
    let hash = 2166136261;
    for (let y = 4; y < c.height; y += 9) for (let x = 4; x < c.width; x += 9) {
      const i = (y * c.width + x) * 4, key = (data[i] >> 4) << 8 | (data[i + 1] >> 4) << 4 | data[i + 2] >> 4;
      colors.add(key);
      hash = Math.imul(hash ^ key, 16777619) >>> 0;
    }
    return {distinctColors: colors.size, sampleHash: hash.toString(16)};
  });
  const shot = async (p, label) => {
    const file = path.join(out, 'screenshots', `${id}-${label}.png`);
    const bytes = await p.page.screenshot({path: file});
    const shotRecord = {label, page: p.name, phase, file: path.relative(out, file), sha256: sha256(bytes), afterInput: trace.length - 1};
    entry.screenshots.push(shotRecord);
    console.log(`screenshot ${shotRecord.file} sha256=${shotRecord.sha256}`);
  };
  const click = async (p, expression) => {
    const pos = await p.page.evaluate(expression => {
      const control = (0, eval)(expression), rect = control.rect || control;
      return {x: rect.centerX, y: rect.centerY};
    }, expression);
    input(p, p.name === 'touch' ? 'tap' : 'click', {control: expression, ...pos});
    if (p.name === 'touch') await p.page.touchscreen.tap(pos.x, pos.y);
    else await p.page.mouse.click(pos.x, pos.y);
  };
  const nextFrame = p => p.page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => resolve())));
  const scaleState = v => ({scale: v.scale, offset: v.offset, bounds: v.bounds});
  const validStep = s => s.after.bounds && [s.after.scale, s.after.offset.x, s.after.offset.y].every(Number.isFinite) &&
    s.after.scale >= s.after.bounds.min * (1 - 1e-9) && s.after.scale <= s.after.bounds.max * (1 + 1e-9);
  const wheelNotch = async (p, tag, x, y, deltaY) => {
    const before = await view(p);
    const received = await p.page.evaluate(() => __zoomObs.wheels);
    const step = input(p, 'wheel', {tag, x, y, deltaY});
    await p.page.mouse.move(x, y);
    await p.page.mouse.wheel(0, deltaY);
    // Heavy maps dispatch late; read the scale only after this notch was handled and a frame ran.
    await p.page.waitForFunction(count => __zoomObs.wheels > count, received);
    await nextFrame(p);
    step.before = scaleState(before);
    step.after = scaleState(await view(p));
    return step;
  };
  // Wheel until the bound is reached, then one more notch that must hold it.
  const wheelToClamp = async (p, tag, direction, x, y) => {
    const steps = [];
    for (let i = 0; i < 40; i++) {
      const step = await wheelNotch(p, tag, x, y, direction === 'out' ? 400 : -400);
      steps.push(step);
      const bound = step.before.bounds[direction === 'out' ? 'min' : 'max'];
      if (atBound(step.before.scale, bound)) return {steps, reached: true, held: atBound(step.after.scale, bound)};
    }
    return {steps, reached: false, held: false};
  };
  // Zoom out to min and back in to max; checks bounds, finite values, content and frames.
  const zoomPhase = async (p, name, x, y, overlayOn, clamp) => {
    const start = await view(p);
    const outward = await clamp(p, name + '-out', 'out', x, y);
    await p.page.waitForTimeout(250);
    const atMin = {view: await view(p), content: await content(p)};
    await shot(p, `${name}-zoomed-out`);
    const inward = await clamp(p, name + '-in', 'in', x, y);
    await p.page.waitForTimeout(250);
    const atMax = {view: await view(p), content: await content(p)};
    await p.page.waitForTimeout(300);
    const final = await view(p);
    const steps = [...outward.steps, ...inward.steps];
    const result = {start, atMin, atMax, final, steps: steps.length,
      scales: {start: start.scale, min: atMin.view.scale, max: atMax.view.scale, final: final.scale}};
    check(`${id}-${name}-clamped-at-min-and-max`, {minReached: outward.reached, minHeld: outward.held,
      maxReached: inward.reached, maxHeld: inward.held}, {minReached: true, minHeld: true, maxReached: true, maxHeld: true});
    check(`${id}-${name}-finite-bounded-scale-and-offset`, {changes: steps.filter(s => s.before.scale !== s.after.scale).length > 0,
      invalidSteps: steps.filter(s => !validStep(s)).map(s => s.index)}, {changes: true, invalidSteps: []});
    check(`${id}-${name}-visible-rendered-content`, {minColors: atMin.content.distinctColors >= 16,
      maxColors: atMax.content.distinctColors >= 16, zoomChangesPixels: atMin.content.sampleHash !== atMax.content.sampleHash},
      {minColors: true, maxColors: true, zoomChangesPixels: true});
    check(`${id}-${name}-frames-continue`, {duringZoom: atMax.view.draws > start.draws && atMax.view.frameTime > start.frameTime,
      afterZoom: final.draws > atMax.view.draws && final.frameTime > atMax.view.frameTime}, {duringZoom: true, afterZoom: true});
    check(`${id}-${name}-combat-overlay`, {flag: final.overlay, overlayDrawn: final.overlayDraws > start.overlayDraws},
      {flag: overlayOn, overlayDrawn: overlayOn});
    return result;
  };
  const dismissPause = async p => {
    input(p, p.name === 'touch' ? 'tap' : 'click', {control: 'dismiss next-turn pause', x: 640, y: 450});
    if (p.name === 'touch') await p.page.touchscreen.tap(640, 450);
    else await p.page.mouse.click(640, 450);
    await p.page.waitForTimeout(300);
    return (await view(p)).pause;
  };
  const snapshot = p => p.page.evaluate(() => ({
    round: gameRound, whooseTurn, slot: gameSlot, mapSize: [grid.arr.length, grid.arr[0].length],
    roster: players.map(player => player.role), generation: gameSettings.coop && gameSettings.coop.generation,
    fog: isFogOfWar, overlay: gameSettings.interface ? gameSettings.interface.drawChanceOfWinningText : 'interface-missing',
  }));

  try {
    const expectedBounds = {min: 5 / expectedSide(size, count), max: 1};
    const expectedGeneration = {version: 4, playerCount: count, seed: MATRIX_SEED, size};
    progress(`${id}-menu`);
    const desktop = await openPage('desktop', {});
    await click(desktop, 'menu.main.buttons[0]');
    if (await desktop.page.evaluate(() => menu.play.modeButton.text.text) !== 'Co-op') await click(desktop, 'menu.play.modeButton');
    for (let i = 0; i < 3 && await desktop.page.evaluate(() => menu.play.sizeSlider.realValue) !== 'Tiny'; i++)
      await click(desktop, 'menu.play.sizeSlider.leftButton');
    for (let i = 0; i < 3 && await desktop.page.evaluate(() => menu.play.sizeSlider.realValue) !== SIZE_LABELS[size]; i++)
      await click(desktop, 'menu.play.sizeSlider.rightButton');
    for (let i = 0; i < 12; i++) await click(desktop, 'menu.play.playersSlider.leftButton');
    for (let i = 1; i < count; i++) await click(desktop, 'menu.play.playersSlider.rightButton');
    for (let i = 0; i < 3 && await desktop.page.evaluate(() => menu.play.mapSlider.value) !== MATRIX_SEED; i++)
      await click(desktop, 'menu.play.mapSlider.leftButton');
    entry.menuSettings = await desktop.page.evaluate(() => ({mode: menu.play.modeButton.text.text,
      humans: Number(menu.play.playersSlider.realValue), size: menu.play.sizeSlider.realValue,
      seed: menu.play.mapSlider.value, fog: menu.play.isFogOfWar, timer: menu.play.isDynamicTimer}));
    check(`${id}-menu-settings`, {mode: entry.menuSettings.mode, humans: entry.menuSettings.humans,
      size: entry.menuSettings.size.toLowerCase(), seed: entry.menuSettings.seed}, {mode: 'Co-op', humans: count, size, seed: MATRIX_SEED});
    await click(desktop, 'menu.play.playButton');
    await click(desktop, 'menu.startGame.buttons[0].movingForm.elements[1].rect');
    await desktop.page.waitForFunction(() => !menu.visible && whooseTurn === 1, undefined, {timeout: 300000});
    entry.launched = await snapshot(desktop);
    const launchedView = await view(desktop);
    entry.bounds = {expected: expectedBounds, observed: launchedView.bounds};
    check(`${id}-launched`, {roster: entry.launched.roster, mapSize: entry.launched.mapSize,
      generation: entry.launched.generation && {version: entry.launched.generation.version, playerCount: entry.launched.generation.playerCount,
        seed: entry.launched.generation.seed, size: entry.launched.generation.size}},
      {roster: ['NEUTRAL', ...Array(count).fill('HUMAN'), 'DEMONS'], mapSize: [expectedSide(size, count), expectedSide(size, count)],
        generation: expectedGeneration});
    check(`${id}-scale-bounds`, {min: atBound(launchedView.bounds.min, expectedBounds.min), max: atBound(launchedView.bounds.max, 1),
      startScale: launchedView.scale}, {min: true, max: true, startScale: 1});
    if (fault === 'drop-interface') {
      input(desktop, 'fault', {fault, action: 'delete gameSettings.interface'});
      await desktop.page.evaluate(() => { delete gameSettings.interface; });
    }
    await desktop.page.waitForTimeout(500);
    check(`${id}-pause-dismissed`, await dismissPause(desktop), false);
    await shot(desktop, 'before-zoom');
    const clamp = (p, tag, direction, x, y) => wheelToClamp(p, tag, direction, x, y);

    progress(`${id}-overlay-off`);
    phase = 'overlay-off';
    entry.overlayOff = await zoomPhase(desktop, 'overlay-off', 640, 450, false, clamp);

    progress(`${id}-selection`);
    phase = 'selection';
    await wheelToClamp(desktop, 'selection-out', 'out', 640, 450);
    // A visible, unfogged own entity away from the corner buttons; towns only without a unit on top.
    const target = await desktop.page.evaluate(() => {
      const W = innerWidth, H = innerHeight, player = players[whooseTurn];
      const buttons = [undoButton, backToMenuButton, nextTurnButton, iButton].map(button => button.rect);
      const list = [...player.units.filter(unit => !unit.killed).map(e => ['unit', e]),
        ...player.towns.filter(town => grid.arr[town.coord.x][town.coord.y].unit.isEmpty()).map(e => ['town', e])];
      for (const [kind, e] of list) {
        const t = biasToTransition(e.coord.x, e.coord.y);
        const x = (t.x * basis.offset.x - canvas.offset.x) * canvas.scale / devicePixelRatio;
        const y = (t.y * basis.offset.y - canvas.offset.y) * canvas.scale / devicePixelRatio;
        if (x < W * 0.05 || x > W * 0.95 || y < H * 0.05 || y > H * 0.95) continue;
        if (buttons.some(r => x * devicePixelRatio > r.x - 20 && x * devicePixelRatio < r.x + r.width + 20 &&
          y * devicePixelRatio > r.y - 20 && y * devicePixelRatio < r.y + r.height + 20)) continue;
        if (isFogOfWar && !grid.fogOfWar[e.coord.x][e.coord.y]) continue;
        window.__zoomSelectionTarget = e;
        return {kind, coord: {x: e.coord.x, y: e.coord.y}, x, y, player: whooseTurn, scale: canvas.scale};
      }
      return null;
    });
    entry.selection = {target};
    check(`${id}-selection-target-visible-after-zoom`, {found: !!target, atMinScale: !!target && atBound(target.scale, launchedView.bounds.min)},
      {found: true, atMinScale: true});
    if (target) {
      input(desktop, 'click', {control: `own ${target.kind} at ${target.coord.x},${target.coord.y}`, x: target.x, y: target.y});
      await desktop.page.mouse.click(target.x, target.y);
      await desktop.page.waitForTimeout(200);
      entry.selection.afterClick = await desktop.page.evaluate(() => ({selectedTarget: gameEvent.selected === __zoomSelectionTarget,
        coord: gameEvent.selected.coord ? {x: gameEvent.selected.coord.x, y: gameEvent.selected.coord.y} : null}));
      check(`${id}-selection-after-zoom`, entry.selection.afterClick, {selectedTarget: true, coord: target.coord});
      for (let i = 0; i < 2; i++) await wheelNotch(desktop, 'selection-in', 640, 450, -400);
      entry.selection.afterZoom = await desktop.page.evaluate(() => gameEvent.selected === __zoomSelectionTarget);
      check(`${id}-selection-kept-while-zooming`, entry.selection.afterZoom, true);
    }

    progress(`${id}-overlay-on`);
    phase = 'overlay-on';
    if (fault !== 'skip-overlay') {
      input(desktop, 'key', {key: 'KeyI'});
      await desktop.page.keyboard.press('KeyI');
      await desktop.page.waitForTimeout(200);
    }
    entry.overlayCells = await desktop.page.evaluate(() => grid.chanceOfWinning.flat().filter(text => text.text !== '').length);
    entry.overlayOn = await zoomPhase(desktop, 'overlay-on', 640, 450, true, clamp);
    await shot(desktop, 'overlay-on-zoomed');

    progress(`${id}-resize`);
    phase = 'resize';
    input(desktop, 'resize', {viewport: RESIZED});
    await desktop.page.setViewportSize(RESIZED);
    await desktop.page.waitForTimeout(300);
    const resizeStart = await view(desktop);
    const resizeSteps = [];
    for (let i = 0; i < 3; i++) resizeSteps.push(await wheelNotch(desktop, 'resized-out', RESIZED.width / 2, RESIZED.height / 2, 400));
    for (let i = 0; i < 3; i++) resizeSteps.push(await wheelNotch(desktop, 'resized-in', RESIZED.width / 2, RESIZED.height / 2, -400));
    await desktop.page.waitForTimeout(300);
    const resized = {view: await view(desktop), content: await content(desktop)};
    await shot(desktop, 'resized-zoomed');
    input(desktop, 'resize', {viewport: DESKTOP});
    await desktop.page.setViewportSize(DESKTOP);
    await desktop.page.waitForTimeout(300);
    const restored = await view(desktop);
    entry.resize = {start: resizeStart, resized, restored};
    check(`${id}-resize-zoom`, {viewport: resizeStart.viewport, restoredViewport: restored.viewport,
      changes: resizeSteps.filter(s => s.before.scale !== s.after.scale).length > 0,
      invalidSteps: resizeSteps.filter(s => !validStep(s)).map(s => s.index), content: resized.content.distinctColors >= 16,
      framesContinue: resized.view.draws > resizeStart.draws && restored.draws > resized.view.draws},
      {viewport: [RESIZED.width, RESIZED.height], restoredViewport: [DESKTOP.width, DESKTOP.height], changes: true,
        invalidSteps: [], content: true, framesContinue: true});

    progress(`${id}-save-reload`);
    phase = 'save';
    const beforeSave = await snapshot(desktop);
    await click(desktop, 'backToMenuButton');
    await desktop.page.waitForFunction(() => menu.visible);
    entry.save = await desktop.page.evaluate(() => {
      const raw = localStorage.getItem(gameSlot + 'gameSettings');
      return {slot: gameSlot, hasSave: hasSave(gameSlot), settings: raw && JSON.parse(raw)};
    });
    const savedGeneration = entry.save.settings && entry.save.settings.coop && entry.save.settings.coop.generation;
    check(`${id}-current-format-save`, {hasSave: entry.save.hasSave, overlay: entry.save.settings && entry.save.settings.interface &&
      entry.save.settings.interface.drawChanceOfWinningText, generation: savedGeneration && {version: savedGeneration.version,
      playerCount: savedGeneration.playerCount, seed: savedGeneration.seed, size: savedGeneration.size}},
      {hasSave: true, overlay: true, generation: expectedGeneration});
    phase = 'reload';
    await click(desktop, 'menu.main.buttons[4]');
    await click(desktop, 'menu.load.buttons[0].movingForm.elements[1].rect');
    await desktop.page.waitForFunction(() => !menu.visible, undefined, {timeout: 300000});
    entry.reloaded = await snapshot(desktop);
    check(`${id}-reloaded-state`, entry.reloaded, {...beforeSave, overlay: true});
    check(`${id}-reloaded-pause-dismissed`, await dismissPause(desktop), false);
    await shot(desktop, 'reloaded-before-zoom');
    entry.reloadedZoom = await zoomPhase(desktop, 'reloaded', 640, 450, true, clamp);
    await shot(desktop, 'reloaded-zoomed');

    progress(`${id}-pinch`);
    phase = 'pinch-load';
    const storageState = await desktop.context.storageState();
    // isMobile applies the page's user-scalable=no viewport as a phone does.
    const touch = await openPage('touch', {isMobile: true, hasTouch: true, userAgent: TOUCH_UA, storageState});
    check(`${id}-touch-page-uses-touch-handlers`, await touch.page.evaluate(() => mobilePhone), true);
    await click(touch, 'menu.main.buttons[4]');
    await click(touch, 'menu.load.buttons[0].movingForm.elements[1].rect');
    await touch.page.waitForFunction(() => !menu.visible, undefined, {timeout: 300000});
    entry.touchLoaded = await snapshot(touch);
    check(`${id}-touch-reloaded-state`, entry.touchLoaded, entry.reloaded);
    check(`${id}-touch-pause-dismissed`, await dismissPause(touch), false);
    phase = 'pinch';
    const cdp = await touch.context.newCDPSession(touch.page);
    const points = half => [{x: 640 - half, y: 450, id: 0}, {x: 640 + half, y: 450, id: 1}];
    // One two-finger gesture; the game scales from the gesture's start distance on each move.
    const pinch = async (tag, fromHalf, toHalf, moves) => {
      const steps = [];
      input(touch, 'touchStart', {tag, touchPoints: points(fromHalf)});
      await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: points(fromHalf)});
      for (let i = 1; i <= moves; i++) {
        const half = fromHalf + (toHalf - fromHalf) * i / moves;
        const before = await view(touch);
        const received = await touch.page.evaluate(() => __zoomObs.touchMoves);
        const step = input(touch, 'touchMove', {tag, touchPoints: points(half), distance: 2 * half});
        await cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: points(half)});
        await touch.page.waitForFunction(count => __zoomObs.touchMoves > count, received);
        await nextFrame(touch);
        step.before = scaleState(before);
        step.after = scaleState(await view(touch));
        steps.push(step);
      }
      input(touch, 'touchEnd', {tag});
      await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
      await touch.page.waitForTimeout(80);
      return steps;
    };
    const pinchToClamp = async (p, tag, direction) => {
      const steps = direction === 'out' ? await pinch(tag, 300, 20, 20) : await pinch(tag, 20, 300, 20);
      const bound = steps[steps.length - 1].after.bounds[direction === 'out' ? 'min' : 'max'];
      const reached = atBound(steps[steps.length - 1].after.scale, bound);
      // A further gesture past the bound must hold it.
      const extra = direction === 'out' ? await pinch(tag + '-past-bound', 200, 40, 5) : await pinch(tag + '-past-bound', 40, 200, 5);
      return {steps: [...steps, ...extra], reached, held: reached && extra.every(s => atBound(s.after.scale, bound))};
    };
    entry.pinch = await zoomPhase(touch, 'pinch', 640, 450, true, pinchToClamp);
    const wheelStep = await wheelNotch(touch, 'touch-page-wheel-unregistered', 640, 450, 400);
    check(`${id}-touch-page-ignores-wheel`, wheelStep.after.scale === wheelStep.before.scale, true);
    entry.pinch.visualViewportScale = (await view(touch)).visualViewportScale;
    check(`${id}-pinch-scales-game-not-page`, entry.pinch.visualViewportScale, 1);
    await shot(touch, 'pinch-final');
    phase = 'done';
  } finally {
    for (const context of contexts) await context.close().catch(() => {});
    entry.pageErrors = entry.errors.filter(error => error.kind === 'pageerror').length;
    check(`${id}-zero-uncaught-page-errors`, entry.errors.filter(error => error.kind === 'pageerror').map(error => error.message), []);
    check(`${id}-zero-console-errors`, entry.errors.filter(error => error.kind === 'console').map(error => error.message), []);
  }
}

(async () => {
  if (matrixMode) return runMatrix();
  const started = Date.now();
  let stage = 'server startup';
  const progress = label => {
    stage = label;
    console.log(`browser_stage=${label} elapsed_ms=${Date.now() - started}`);
  };
  // A hung browser must fail with context; Playwright timeouts do not cover everything.
  const deadline = setTimeout(() => {
    console.error(`FAIL browser deadline stage=${stage} elapsed_ms=${Date.now() - started}`);
    process.exit(1);
  }, 1500000);
  deadline.unref();
  fs.mkdirSync(path.join(out, 'screenshots'), {recursive: true});
  const served = new Set();
  const server = await startServer(served);
  let browser, fatal = null;
  const report = {mode: expectReproduction ? 'expect-reproduction' : 'regression', humans, sizes,
    node: process.version, cwd: process.cwd(), target: TARGET.source, expectedSetupError: LEGACY_LOAD_ERROR.source, cases: []};
  const browserErrors = [];
  try {
    browser = await chromium.launch({headless: true});
    report.browser = {engine: 'chromium', version: browser.version()};
    console.log('browser_engine=chromium browser_version=' + browser.version() + ' node=' + process.version);
    for (const size of sizes) {
      progress(`${size}-launch`);
      const context = await browser.newContext({viewport: {width: 1280, height: 900}, deviceScaleFactor: 1});
      const page = await context.newPage();
      page.setDefaultTimeout(15000);
      const entry = {size, phase: 'fresh', interactions: [], errors: [], reproduced: false};
      report.cases.push(entry);
      const action = (type, detail = {}) => {
        entry.interactions.push({index: entry.interactions.length, phase: entry.phase, type, ...detail});
      };
      const record = (kind, message, detail) => {
        const error = {size, phase: entry.phase, kind, message, ...detail,
          afterInteraction: entry.interactions.length - 1, target: TARGET.test(message),
          expectedSetup: kind === 'pageerror' && entry.phase === 'legacy-load' && LEGACY_LOAD_ERROR.test(message)};
        entry.errors.push(error); browserErrors.push(error);
        console.log(`${kind} size=${size} phase=${error.phase} target=${error.target} expectedSetup=${error.expectedSetup} message=${message}`);
      };
      page.on('pageerror', error => record('pageerror', error.message, {stack: error.stack}));
      page.on('console', message => {
        if (message.type() === 'error') record('console', message.text(), {location: message.location()});
      });
      await routeOffline(page);
      await page.goto(`http://127.0.0.1:${server.address().port}/`, {waitUntil: 'load'});
      await page.waitForFunction(() => typeof menu !== 'undefined' && menu.visible &&
        imagesCountLoaded === images.length, undefined, {timeout: 60000});
      const click = async (expression) => {
        const pos = await page.evaluate(expression => {
          const control = (0, eval)(expression), rect = control.rect || control;
          return {x: rect.centerX, y: rect.centerY};
        }, expression);
        action('click', {control: expression, ...pos});
        await page.mouse.click(pos.x, pos.y);
      };
      // Safe while a failed restore leaves grid/players partially replaced.
      const settingsState = () => page.evaluate(() => ({
        interfacePresent: gameSettings.interface !== undefined,
        settingsKeys: Object.keys(gameSettings),
        settings: JSON.parse(JSON.stringify(gameSettings)),
        scale: canvas.scale, menu: menu.visible, slot: gameSlot,
      }));
      const snapshot = () => page.evaluate(() => ({
        interfacePresent: gameSettings.interface !== undefined,
        settings: JSON.parse(JSON.stringify(gameSettings)),
        scale: canvas.scale, scaleBounds: {min: mapBorder.scale.min, max: mapBorder.scale.max},
        round: gameRound, whooseTurn, menu: menu.visible, slot: gameSlot,
        mapSize: [grid.arr.length, grid.arr[0].length],
        roster: players.map((player, slot) => ({slot, role: player.role})),
      }));
      const boardHash = () => page.evaluate(() => document.getElementById('canvas').toDataURL()).then(sha256);
      const shot = async (label) => {
        const file = path.join(out, 'screenshots', `${size}-${label}.png`);
        const bytes = await page.screenshot({path: file});
        const shotRecord = {label, phase: entry.phase, file: path.relative(out, file), sha256: sha256(bytes)};
        (entry.screenshots ||= []).push(shotRecord);
        console.log(`screenshot ${shotRecord.file} sha256=${shotRecord.sha256}`);
      };
      const targetSeen = (phase = entry.phase) => entry.errors.some(error => error.target && error.phase === phase);
      // One real wheel notch per step; wheel down zooms out, up zooms in.
      const wheel = async (tag, deltaY, count, force = false) => {
        for (let i = 0; i < count && (force || !targetSeen()); i++) {
          const before = await page.evaluate(() => canvas.scale);
          action('wheel', {tag, x: 640, y: 450, deltaY});
          await page.mouse.move(640, 450);
          await page.mouse.wheel(0, deltaY);
          // Let animation frames render at the new scale.
          await page.waitForTimeout(120);
          const after = await page.evaluate(() => canvas.scale);
          entry.interactions[entry.interactions.length - 1].scale = {before, after, changed: before !== after};
        }
      };
      const scaleChanges = phase => entry.interactions.filter(i => i.phase === phase && i.type === 'wheel' &&
        i.scale && i.scale.changed).length;
      const startCoopGame = async (label) => {
        await click('menu.main.buttons[0]');
        if (await page.evaluate(() => menu.play.modeButton.text.text) !== 'Co-op') await click('menu.play.modeButton');
        for (let i = 0; i < 3 && await page.evaluate(() => menu.play.sizeSlider.realValue) !== 'Tiny'; i++)
          await click('menu.play.sizeSlider.leftButton');
        for (let i = 0; i < 3 && await page.evaluate(() => menu.play.sizeSlider.realValue) !== SIZE_LABELS[size]; i++)
          await click('menu.play.sizeSlider.rightButton');
        for (let i = 0; i < 12; i++) await click('menu.play.playersSlider.leftButton');
        for (let i = 1; i < humans; i++) await click('menu.play.playersSlider.rightButton');
        const menuSettings = await page.evaluate(() => ({mode: menu.play.modeButton.text.text,
          humans: Number(menu.play.playersSlider.realValue), size: menu.play.sizeSlider.realValue,
          seed: menu.play.mapSlider.value, fog: menu.play.isFogOfWar, timer: menu.play.isDynamicTimer}));
        check(`${size}-${label}-menu-settings`, {mode: menuSettings.mode, humans: menuSettings.humans,
          size: menuSettings.size.toLowerCase()}, {mode: 'Co-op', humans, size});
        await click('menu.play.playButton');
        await click('menu.startGame.buttons[0].movingForm.elements[1].rect');
        await page.waitForFunction(() => !menu.visible && whooseTurn === 1, undefined, {timeout: 180000});
        const launched = await snapshot();
        const generation = await page.evaluate(() => gameSettings.coop && gameSettings.coop.generation);
        check(`${size}-${label}-launched`, {roles: launched.roster.map(p => p.role), menu: launched.menu,
          generation: generation && {playerCount: generation.playerCount, size: generation.size}},
          {roles: ['NEUTRAL', ...Array(humans).fill('HUMAN'), 'DEMONS'], menu: false,
            generation: {playerCount: humans, size}});
        return {menuSettings, launched, generation};
      };

      progress(`${size}-menu`);
      ({menuSettings: entry.menuSettings, launched: entry.launched, generation: entry.generation} =
        await startCoopGame('fresh'));
      // Frames keep running before any input.
      await page.waitForTimeout(500);
      await shot('before-input');

      progress(`${size}-zoom-after-startup`);
      await wheel('startup-out', 400, 12);
      await wheel('startup-in', -400, 16);
      await page.mouse.click(640, 450);
      action('click', {control: 'dismiss next-turn pause', x: 640, y: 450});
      await wheel('dismissed-out', 300, 6);
      if (!targetSeen()) await shot('after-startup-zoom');

      progress(`${size}-full-round`);
      const round = entry.launched.round;
      for (let step = 0; step < humans + 2 && !targetSeen(); step++) {
        const before = await page.evaluate(() => ({round: gameRound, turn: whooseTurn}));
        if (before.round > round) break;
        action('key', {keys: 'Shift+Enter', before});
        await page.keyboard.down('Shift'); await page.keyboard.press('Enter'); await page.keyboard.up('Shift');
        await page.waitForFunction(b => whooseTurn !== b.turn || gameRound !== b.round || gameExit, before,
          {timeout: 180000});
        await wheel(`turn-${step}`, step % 2 ? -360 : 360, 1);
      }
      entry.afterRound = await snapshot();
      if (!targetSeen()) {
        check(`${size}-round-completed`, entry.afterRound.round, round + 1);
        await wheel('after-round-out', 400, 12);
        await wheel('after-round-in', -400, 16);
      }

      if (!targetSeen()) {
        progress(`${size}-resume`);
        action('menuBack');
        await page.evaluate(() => menuBack());
        await click('menu.main.buttons[4]');
        await click('menu.load.buttons[0].movingForm.elements[1].rect');
        await page.waitForFunction(() => !menu.visible, undefined, {timeout: 180000});
        entry.resumed = await snapshot();
        await wheel('resumed-out', 400, 12);
        await wheel('resumed-in', -400, 16);
      }
      await page.waitForTimeout(300);
      entry.final = await snapshot();
      entry.scaleChanges = scaleChanges('fresh');
      await shot('fresh-final');
      check(`${size}-fresh-no-target-failure`, targetSeen('fresh'), false);
      check(`${size}-fresh-interface-settings-present-final`, entry.final.interfacePresent, true);
      check(`${size}-fresh-real-scale-change`, entry.scaleChanges > 0, true);

      // Same slot, now in the format saved before settings persistence (2025-03-24).
      progress(`${size}-legacy-slot`);
      entry.phase = 'legacy-load';
      action('menuBack');
      await page.evaluate(() => menuBack());
      entry.legacySlot = await page.evaluate(() => {
        const hadSettings = localStorage.getItem(gameSlot + 'gameSettings') !== null;
        localStorage.removeItem(gameSlot + 'gameSettings');
        return {slot: gameSlot, hadSettings, removedKey: gameSlot + 'gameSettings', hasSave: hasSave(gameSlot)};
      });
      action('legacy-slot-state', entry.legacySlot);
      check(`${size}-legacy-slot-prepared`, {hadSettings: entry.legacySlot.hadSettings, hasSave: entry.legacySlot.hasSave},
        {hadSettings: true, hasSave: true});
      await click('menu.main.buttons[4]');
      await click('menu.load.buttons[0].movingForm.elements[1].rect');
      await page.waitForTimeout(1500);
      entry.legacyLoad = await settingsState();
      if (entry.legacyLoad.menu) await click('menu.load.buttons[menu.load.buttons.length - 1]');
      else {
        action('menuBack');
        await page.evaluate(() => menuBack());
      }

      progress(`${size}-legacy-new-game`);
      entry.phase = 'legacy-new-game';
      ({menuSettings: entry.legacyMenuSettings, launched: entry.legacyLaunched} = await startCoopGame('legacy-new-game'));
      await page.waitForTimeout(500);
      await shot('legacy-before-input');
      const hashBefore = await boardHash();
      // The next-turn card covers the shared canvas, so its pixels stay equal
      // while frames run; the animation loop's frame time shows whether they do.
      const frameBefore = await page.evaluate(() => lastGameFrameTime);
      await wheel('legacy-out', 400, 12, true);
      await wheel('legacy-in', -400, 16, true);
      await page.waitForTimeout(300);
      const hashAfter = await boardHash();
      entry.legacyFinal = await snapshot();
      entry.legacyScaleChanges = scaleChanges('legacy-new-game');
      entry.legacyBoard = {hashBefore, hashAfter, frozen: hashBefore === hashAfter};
      entry.legacyFrames = {before: frameBefore, after: await page.evaluate(() => lastGameFrameTime)};
      entry.legacyFrames.continued = entry.legacyFrames.after > entry.legacyFrames.before;
      entry.reproduced = targetSeen('legacy-new-game');
      if (entry.reproduced) {
        const first = entry.errors.find(error => error.target && error.phase === 'legacy-new-game');
        entry.failure = {message: first.message, stack: first.stack, phase: first.phase,
          afterInteraction: first.afterInteraction, interaction: entry.interactions[first.afterInteraction],
          interactionSequence: entry.interactions.filter(i => i.phase !== 'fresh'),
          settingsSnapshot: entry.legacyLaunched.settings, interfacePresent: entry.legacyLaunched.interfacePresent,
          mapSize: entry.legacyLaunched.mapSize, roster: entry.legacyLaunched.roster, seed: entry.legacyMenuSettings.seed,
          scaleAtFailure: entry.legacyLaunched.scale, finalScale: entry.legacyFinal.scale,
          scaleChangesAfterFailure: entry.legacyScaleChanges, board: entry.legacyBoard};
        await shot('failure-state');
      }
      else await shot('legacy-final');
      // Dismiss the card and zoom out so the capture shows the board itself.
      entry.phase = 'legacy-board';
      await page.mouse.click(640, 450);
      action('click', {control: 'dismiss next-turn pause', x: 640, y: 450});
      await wheel('legacy-board-out', 400, 4, true);
      await page.waitForTimeout(300);
      entry.legacyBoardView = {...await snapshot(), frameTime: await page.evaluate(() => lastGameFrameTime),
        pauseVisible: await page.evaluate(() => nextTurnPauseInterface.visible), scaleChanges: scaleChanges('legacy-board')};
      await shot('legacy-board-after-zoom');
      check(`${size}-legacy-new-game-real-scale-change`, entry.legacyScaleChanges > 0, true);
      if (expectReproduction) {
        check(`${size}-legacy-load-leaves-settings-without-interface`,
          {menu: entry.legacyLoad.menu, interfacePresent: entry.legacyLoad.interfacePresent, keys: entry.legacyLoad.settingsKeys},
          {menu: true, interfacePresent: false, keys: ['isOnline']});
        check(`${size}-legacy-new-game-settings-without-interface`, entry.legacyLaunched.interfacePresent, false);
        check(`${size}-legacy-new-game-target-failure`, entry.reproduced, true);
        check(`${size}-legacy-board-frozen-while-scale-changes`, entry.legacyBoard.frozen, true);
      } else {
        check(`${size}-legacy-frames-continue-while-scale-changes`, entry.legacyFrames.continued, true);
        check(`${size}-legacy-board-view-after-zoom`, {pauseVisible: entry.legacyBoardView.pauseVisible,
          scaleChanged: entry.legacyBoardView.scaleChanges > 0, framesContinued: entry.legacyBoardView.frameTime > entry.legacyFrames.after},
          {pauseVisible: false, scaleChanged: true, framesContinued: true});
      }
      console.log(`CASE size=${size} humans=${humans} reproduced=${entry.reproduced} freshScaleChanges=${entry.scaleChanges} ` +
        `legacyScaleChanges=${entry.legacyScaleChanges} errors=${entry.errors.length} map=${entry.legacyLaunched.mapSize.join('x')} ` +
        `seed=${entry.legacyMenuSettings.seed} finalScale=${entry.legacyFinal.scale} boardFrozen=${entry.legacyBoard.frozen}`);
      await context.close();
    }
  } catch (error) {
    fatal = error;
    console.error(`FAIL stage=${stage}`, error);
  } finally {
    progress('cleanup');
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
    clearTimeout(deadline);
  }

  const targets = browserErrors.filter(error => error.target);
  const expectedSetup = browserErrors.filter(error => error.expectedSetup);
  const unrelated = browserErrors.filter(error => !error.target && !error.expectedSetup);
  const reproducedWithScaleChange = report.cases.some(entry => entry.reproduced && entry.legacyScaleChanges > 0);
  report.summary = {reproduced: targets.length > 0, reproducedWithScaleChange,
    reproducedSizes: report.cases.filter(entry => entry.reproduced).map(entry => entry.size),
    targetPhases: [...new Set(targets.map(error => error.phase))],
    targetErrors: targets.length, expectedSetupErrors: expectedSetup.length, unrelatedErrors: unrelated.length,
    fatal: fatal ? String(fatal.stack || fatal) : null, elapsedMs: Date.now() - started};
  const sources = [...new Set([path.relative(root, __filename), ...served])].filter(file => file.endsWith('.js') || file.endsWith('.html')).sort();
  fs.writeFileSync(path.join(out, 'source-identities.json'), JSON.stringify(sources.map(file =>
    ({file, sha256: sha256(fs.readFileSync(path.join(root, file)))})), null, 2) + '\n');
  fs.writeFileSync(path.join(out, 'reproduction.json'), JSON.stringify(report, null, 2) + '\n');
  fs.writeFileSync(path.join(out, 'browser-errors.json'), JSON.stringify(browserErrors, null, 2) + '\n');

  // Independently expected outcome per mode.
  if (expectReproduction) {
    check('diagnostic-browser-started', !!report.browser && !fatal, true);
    check('diagnostic-target-observed-with-scale-change', reproducedWithScaleChange, true);
    check('diagnostic-no-unrelated-page-errors', unrelated.length, 0);
  } else {
    check('regression-browser-started', !!report.browser && !fatal, true);
    check('regression-no-target-failure', targets.length, 0);
    check('regression-no-unrelated-page-errors', unrelated.length, 0);
  }
  fs.writeFileSync(path.join(out, 'checkpoints.json'), JSON.stringify({mode: report.mode, humans, sizes,
    checkpoints}, null, 2) + '\n');
  console.log(`SUMMARY ${JSON.stringify(report.summary)}`);
  const failed = checkpoints.filter(c => !c.passed);
  if (failed.length) {
    const first = targets[0];
    if (!expectReproduction && first) console.error(`FAIL target-regression: ${first.message}\n${first.stack}`);
    else if (expectReproduction && !report.summary.reproduced) console.error('FAIL missing-reproduction: undefined drawChanceOfWinningText access was not observed');
    console.error('FAIL checkpoints: ' + failed.map(c => c.checkpoint).join(', '));
    process.exitCode = 1;
    return;
  }
  console.log(`PASS co-op zoom ${report.mode} humans=${humans} sizes=${sizes.join(',')}`);
})().catch(error => {console.error(error); process.exitCode = 1;});
