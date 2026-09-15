// Interface settings reach Grid.draw and input after startup and restore.
// Ten-human Tiny co-op games are started through GameMap.start and restored
// through loadFromJson (current format and the legacy slot without settings).
// For each settings variant the test draws real frames with a selected unit,
// fills the combat overlay, zooms with ComputerScreen.scale and presses I.
//   --output-dir DIR   evidence directory (settings-cases.json, checkpoints.json,
//                      source-identities.json, negative-control/)
//   --fault skip-normalization   negative control: normalizeInterfaceSettings is
//                      replaced by identity; must exit 1 on the frame assertion
const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {spawnSync} = require('child_process');
const {createFixture} = require('./test-coop-harness');

const root = path.resolve(__dirname, '..');
const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : process.argv[index + 1];
};
const out = path.resolve(arg('--output-dir', path.join(root, 'artifacts/TASK-148')));
const fault = arg('--fault', null);
assert.ok(fault === null || fault === 'skip-normalization', 'unknown fault ' + fault);
const HUMANS = 10, SIZE = 'tiny', SEED = 1;
const TARGET = "Cannot read properties of undefined (reading 'drawChanceOfWinningText')";
const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');
const copy = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));

const checkpoints = [];
function check(checkpoint, observed, expected) {
  const passed = JSON.stringify(observed) === JSON.stringify(expected);
  checkpoints.push({checkpoint, expected, observed, passed});
  console.log(`${passed ? 'PASS' : 'MISMATCH'} ${checkpoint} expected=${JSON.stringify(expected)} observed=${JSON.stringify(observed)}`);
  return passed;
}

// Other interface options must survive; only the missing flag is defaulted.
const VARIANTS = [
  {name: 'absent', interface: undefined},
  {name: 'empty', interface: {}},
  {name: 'explicit-true', interface: {drawChanceOfWinningText: true, drawChanceOfWinning: false, legendScale: 2}},
  {name: 'explicit-false', interface: {drawChanceOfWinningText: false, drawChanceOfWinning: true, legendScale: 3}},
];
const expectedInterface = variant => ({...(variant.interface || {}),
  drawChanceOfWinningText: variant.interface && variant.interface.drawChanceOfWinningText !== undefined ?
    variant.interface.drawChanceOfWinningText : false});

function runtime() {
  const f = createFixture(undefined, () => {});
  f.evaluate(`(() => {
    // index.html creates the rendering context and map depth inline; the harness
    // loads only script files, so provide inert canvas APIs and a real MapDepth.
    // Every call returns another inert object (gradients, patterns, paths).
    globalThis.inert = () => {
      const store = {}
      return new Proxy(function() {}, {
        get(target, key) {
          if (key in store) return store[key]
          if (key === 'measureText') return text => ({width: String(text).length * 8})
          if (key === 'then' || typeof key === 'symbol') return undefined
          return () => inert()
        },
        set(target, key, value) { store[key] = value; return true },
        apply() { return inert() },
        construct() { return inert() }
      })
    }
    const inertCanvas = () => ({width: WIDTH, height: HEIGHT, style: {}, getContext: () => inert(),
      addEventListener() {}, removeEventListener() {}, toDataURL: () => ''})
    document.createElement = inertCanvas
    document.getElementById = inertCanvas
    Path2D = function() { return inert() }
    mainCtx = inert()
    width = WIDTH / canvas.scale; height = HEIGHT / canvas.scale
    mapDepth = new MapDepth()
    globalThis.fixtureManager = {
      clearValues() { external = []; externalProduction = []; nature = []; goldmines = []; gameRound = 0; gameExit = false },
      updateCameraBorders() { GameManager.updateCameraBorders() }
    }
    globalThis.startCoop = () => {
      generateCoopGame(${HUMANS}, {size: '${SIZE}', seed: ${SEED}}).start(fixtureManager, false, false)
      whooseTurn = 1; gameRound = 0; actionManager.clear()
    }
    globalThis.errorOf = fn => { try { fn(); return null } catch (error) { return error.message } }
    // One real frame through drawMain -> Grid.draw; counts overlay/selection drawing.
    globalThis.frame = () => {
      const counts = {overlayCalls: 0, overlayCells: 0, borderDraws: 0, attackBorderDraws: 0}
      const overlay = grid.drawChanceOfWinningText, borderDraw = border.draw, attackDraw = attackBorder.draw
      grid.drawChanceOfWinningText = function(ctx) {
        counts.overlayCalls++
        counts.overlayCells += this.chanceOfWinning.flat().filter(cell => cell.text !== '').length
        return overlay.call(this, ctx)
      }
      border.draw = function(ctx) { counts.borderDraws++; return borderDraw.call(this, ctx) }
      attackBorder.draw = function(ctx) { counts.attackBorderDraws++; return attackDraw.call(this, ctx) }
      try { counts.error = errorOf(() => drawMain()) }
      finally { delete grid.drawChanceOfWinningText; border.draw = borderDraw; attackBorder.draw = attackDraw }
      return counts
    }
  })()`);
  if (fault === 'skip-normalization') f.evaluate('normalizeInterfaceSettings = settings => settings; undefined');
  return f;
}

// Selection, overlay fill, frames, wheel zoom in/out and the I key on one board.
function exercise(f, label, expected, cases) {
  const observed = {settings: f.evaluate('JSON.parse(JSON.stringify(gameSettings))')};
  check(`${label}-interface`, observed.settings.interface, expected);
  observed.firstFrame = f.evaluate('frame()');
  check(`${label}-first-frame-error`, observed.firstFrame.error, null);
  const selection = f.evaluate(`(() => {
    const unit = players[1].units.find(u => !u.killed && u.notEmpty())
    const error = errorOf(() => { gameEvent.selected = unit; unit.select(); grid.fillChancesOfWinning(unit) })
    const destinations = new Set(unit.getAvailableCommands().map(c => c.destinationCoord.x + ',' + c.destinationCoord.y))
    return {unit: {x: unit.coord.x, y: unit.coord.y}, error, borderVisible: border.visible, eligible: destinations.size}
  })()`);
  observed.selection = selection;
  check(`${label}-selection`, {error: selection.error, borderVisible: selection.borderVisible,
    hasEligibleTargets: selection.eligible > 0}, {error: null, borderVisible: true, hasEligibleTargets: true});
  const flag = expected.drawChanceOfWinningText;
  observed.selectedFrame = f.evaluate('frame()');
  check(`${label}-selected-frame`, observed.selectedFrame, {overlayCalls: flag ? 1 : 0,
    overlayCells: flag ? selection.eligible : 0, borderDraws: 1, attackBorderDraws: 1, error: null});
  observed.zoom = f.evaluate(`(() => {
    const screen = new ComputerScreen(0.002 * HEIGHT, 0.04 * HEIGHT), pos = {x: 400, y: 300}, scales = [canvas.scale]
    const errors = [], frames = []
    for (const delta of [-400, -400, -400, 400, 400, 400, 400]) {
      errors.push(errorOf(() => screen.scale(pos, delta)))
      scales.push(canvas.scale)
      frames.push(frame())
    }
    return {bounds: typeof mapBorder === 'object' && mapBorder ? mapBorder.scale : {min: NaN, max: NaN}, scales, errors, frames}
  })()`);
  const {scales, bounds} = observed.zoom;
  check(`${label}-zoom-no-error`, observed.zoom.errors.filter(Boolean), []);
  check(`${label}-zoom-scale-changed`, new Set(scales).size > 1 && scales.every(s => s >= bounds.min - 1e-9 && s <= bounds.max + 1e-9), true);
  check(`${label}-zoom-frames`, observed.zoom.frames.map(frame => [frame.error, frame.overlayCalls, frame.borderDraws]),
    scales.slice(1).map(() => [null, flag ? 1 : 0, 1]));
  observed.key = f.evaluate(`(() => {
    const events = Object.create(Events.prototype)
    events.selected = gameEvent.selected; events.waitingMode = false
    const error = errorOf(() => events.keyboard(Events.kILetterKeycode, false))
    return {error, interface: gameSettings.interface === undefined ? null : JSON.parse(JSON.stringify(gameSettings.interface)), frame: frame()}
  })()`);
  check(`${label}-overlay-key`, {error: observed.key.error, interface: observed.key.interface},
    {error: null, interface: {...expected, drawChanceOfWinningText: true}});
  check(`${label}-overlay-key-frame`, observed.key.frame, {overlayCalls: 1, overlayCells: selection.eligible,
    borderDraws: 1, attackBorderDraws: 1, error: null});
  cases.push({label, expectedInterface: expected, ...observed});
}

function run() {
  const cases = [];
  for (const variant of VARIANTS) {
    // Startup: the global settings object is whatever the previous game or restore left.
    const f = runtime();
    f.context.variantSettings = variant.interface === undefined ? {isOnline: false} :
      {isOnline: false, interface: copy(variant.interface)};
    const startup = f.evaluate('gameSettings = JSON.parse(JSON.stringify(variantSettings)); errorOf(startCoop)');
    const label = `startup-${variant.name}`;
    check(`${label}-start-error`, startup, null);
    check(`${label}-coop-roster`, f.evaluate('({roles: players.map(p => p.role), playerCount: gameSettings.coop.generation.playerCount})'),
      {roles: ['NEUTRAL', ...Array(HUMANS).fill('HUMAN'), 'DEMONS'], playerCount: HUMANS});
    exercise(f, label, expectedInterface(variant), cases);
    cases[cases.length - 1].input = {boundary: 'GameMap.start', settings: f.context.variantSettings};
    // Starting the next game on the same settings object keeps the options.
    check(`${label}-restart-keeps-interface`, f.evaluate('errorOf(startCoop) || (gameSettings.interface === undefined ? null : JSON.parse(JSON.stringify(gameSettings.interface)))'),
      {...expectedInterface(variant), drawChanceOfWinningText: true});
  }
  for (const variant of VARIANTS) {
    // Current-format restore over a stale settings object without interface.
    const f = runtime();
    f.evaluate('errorOf(startCoop)');
    const packed = JSON.parse(f.evaluate('JSON.stringify(getGameObject())'));
    if (variant.interface === undefined) delete packed.gameSettings.interface;
    else packed.gameSettings.interface = copy(variant.interface);
    f.context.savedInput = JSON.stringify(packed);
    const label = `restore-${variant.name}`;
    check(`${label}-restore-error`, f.evaluate('gameSettings = {isOnline: false}; errorOf(() => loadFromJson(savedInput))'), null);
    const {interface: _, ...otherSaved} = packed.gameSettings;
    check(`${label}-other-settings-preserved`, f.evaluate(`(() => { const {interface: _, ...rest} = JSON.parse(JSON.stringify(gameSettings)); return rest })()`), otherSaved);
    exercise(f, label, expectedInterface(variant), cases);
    cases[cases.length - 1].input = {boundary: 'loadFromJson', savedGameSettings: packed.gameSettings};
  }
  {
    // TASK-147 chain: a slot saved before settings persistence fails its co-op
    // restore; the next co-op game on that settings object must still draw.
    const f = runtime();
    f.evaluate('errorOf(startCoop)');
    const packed = JSON.parse(f.evaluate('JSON.stringify(getGameObject())'));
    delete packed.gameSettings;
    f.context.savedInput = JSON.stringify(packed);
    const label = 'legacy-slot';
    check(`${label}-restore-error`, f.evaluate('errorOf(() => loadFromJson(savedInput))'), 'portal requires demon ownership');
    check(`${label}-settings-after-failed-restore`, f.evaluate('JSON.parse(JSON.stringify(gameSettings))'),
      {isOnline: false, interface: {drawChanceOfWinningText: false}});
    check(`${label}-new-game-start-error`, f.evaluate('errorOf(startCoop)'), null);
    exercise(f, `${label}-new-game`, {drawChanceOfWinningText: false}, cases);
    cases[cases.length - 1].input = {boundary: 'loadFromJson without gameSettings, then GameMap.start', savedGameSettings: null};
  }
  return cases;
}

function writeEvidence(cases) {
  fs.mkdirSync(out, {recursive: true});
  fs.writeFileSync(path.join(out, 'settings-cases.json'), JSON.stringify({humans: HUMANS, size: SIZE, seed: SEED,
    fault, node: process.version, cases}, null, 2) + '\n');
  fs.writeFileSync(path.join(out, 'checkpoints.json'), JSON.stringify({fault, checkpoints}, null, 2) + '\n');
  const scripts = [...fs.readFileSync(path.join(root, 'index.html'), 'utf8').matchAll(/<script[^>]+src=['"]([^'"]+)['"]/g)]
    .map(match => match[1]).filter(src => !/^https?:/.test(src));
  const files = [path.relative(root, __filename), 'ai/test-coop-harness.js', 'ai/browserScriptCache.js',
    'ai/test-coop-zoom.js', 'ai/test-coop-serialization.js', 'gameObjectSerialization.js', 'index.html', ...scripts];
  fs.writeFileSync(path.join(out, 'source-identities.json'), JSON.stringify([...new Set(files)].map(file =>
    ({file, sha256: sha256(fs.readFileSync(path.join(root, file)))})), null, 2) + '\n');
}

if (fault) {
  let cases = [];
  try { cases = run(); } finally { writeEvidence(cases); }
  const failed = checkpoints.filter(c => !c.passed);
  if (failed.length) {
    console.error('FAIL checkpoints: ' + failed.map(c => c.checkpoint).join(', '));
    process.exitCode = 1;
  } else console.log(`PASS fault=${fault} (unexpected)`);
} else {
  const cases = run();
  // Negative control: without the fix the first frame throws the reported error.
  const controlDir = path.join(out, 'negative-control');
  const child = spawnSync(process.execPath, [__filename, '--output-dir', controlDir, '--fault', 'skip-normalization'],
    {encoding: 'utf8', maxBuffer: 64 * 1024 * 1024});
  fs.mkdirSync(controlDir, {recursive: true});
  fs.writeFileSync(path.join(controlDir, 'output.log'), `$ ${process.execPath} ${path.relative(root, __filename)} --output-dir ${path.relative(root, controlDir)} --fault skip-normalization\n` +
    `--- stdout ---\n${child.stdout}--- stderr ---\n${child.stderr}EXIT_STATUS ${child.status}\n`);
  const targetLine = `MISMATCH startup-absent-first-frame-error expected=null observed=${JSON.stringify(TARGET)}`;
  check('negative-control-skip-normalization-exit', child.status, 1);
  check('negative-control-target-frame-assertion', child.stdout.includes(targetLine), true);
  check('negative-control-explicit-flag-still-passes', child.stdout.includes('PASS startup-explicit-true-selected-frame'), true);
  writeEvidence(cases);
  const failed = checkpoints.filter(c => !c.passed);
  if (failed.length) {
    console.error('FAIL checkpoints: ' + failed.map(c => c.checkpoint).join(', '));
    process.exitCode = 1;
  } else console.log(`PASS co-op interface defaults cases=${cases.length} checkpoints=${checkpoints.length} humans=${HUMANS} size=${SIZE}`);
}
