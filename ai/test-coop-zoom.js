// Reproduces the reported in-game zoom crash (undefined drawChanceOfWinningText
// access) in real local co-op games started through the menu with real wheel,
// keyboard and mouse input. Production code is not patched or stubbed.
// Each size runs two phases:
//   fresh: new ten-human game, zoom, one full round, menu resume, zoom (clean).
//   legacy-slot: the saved slot is turned into a save written before settings
//     persistence (no gameSettings key). Its menu Load throws after replacing
//     gameSettings with {isOnline:false}; the next new co-op game then crashes on
//     its first frame and later zoom changes scale on a frozen board.
//   default: regression mode, fails when the target failure is observed
//   --expect-reproduction: diagnostic, succeeds only when the target failure and
//     a real scale change are observed in the same game and no unrelated page
//     error happened
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
const sizes = arg('--sizes', 'tiny,normal,big').split(',');
const out = path.resolve(arg('--output-dir', path.join(root, 'artifacts/TASK-147')));
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

(async () => {
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
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
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
      // Offline local game: no networking, downloads or learned AI.
      await page.route('https://**/*', route => route.fulfill({contentType: 'application/javascript',
        body: route.request().url().includes('socket.io') ? 'window.io=()=>({on(){},emit(){}})' :
          route.request().url().includes('FileSaver') ? 'window.saveAs=()=>{}' : 'window.tf={}'}));
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
      await wheel('legacy-out', 400, 12, true);
      await wheel('legacy-in', -400, 16, true);
      await page.waitForTimeout(300);
      const hashAfter = await boardHash();
      entry.legacyFinal = await snapshot();
      entry.legacyScaleChanges = scaleChanges('legacy-new-game');
      entry.legacyBoard = {hashBefore, hashAfter, frozen: hashBefore === hashAfter};
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
      check(`${size}-legacy-new-game-real-scale-change`, entry.legacyScaleChanges > 0, true);
      if (expectReproduction) {
        check(`${size}-legacy-load-leaves-settings-without-interface`,
          {menu: entry.legacyLoad.menu, interfacePresent: entry.legacyLoad.interfacePresent, keys: entry.legacyLoad.settingsKeys},
          {menu: true, interfacePresent: false, keys: ['isOnline']});
        check(`${size}-legacy-new-game-settings-without-interface`, entry.legacyLaunched.interfacePresent, false);
        check(`${size}-legacy-new-game-target-failure`, entry.reproduced, true);
        check(`${size}-legacy-board-frozen-while-scale-changes`, entry.legacyBoard.frozen, true);
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
