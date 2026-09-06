const fs = require('fs');
const http = require('http');
const path = require('path');

function check(condition, message, details) {
  if (!condition) {
    const error = new Error(message);
    error.details = details;
    throw error;
  }
}

const nodeMajor = Number(process.versions.node.split('.')[0]);
check(nodeMajor >= 20,
  `play AI real-browser smoke requires Node.js 20 or newer; found ${process.version}`);

const { chromium } = require('playwright');
const repoRoot = path.resolve(__dirname, '..');
const tfjsBrowserPath = path.join(
  repoRoot, 'node_modules/@tensorflow/tfjs/dist/tf.min.js');

function contentType(filePath) {
  const extension = path.extname(filePath);
  if (extension == '.html') return 'text/html; charset=utf-8';
  if (extension == '.js') return 'application/javascript; charset=utf-8';
  if (extension == '.css') return 'text/css; charset=utf-8';
  if (extension == '.json') return 'application/json; charset=utf-8';
  if (extension == '.svg') return 'image/svg+xml';
  return 'application/octet-stream';
}

function serveRepo() {
  const requests = [];
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    const relativePath = decodeURIComponent(url.pathname) == '/' ?
      'index.html' : decodeURIComponent(url.pathname).slice(1);
    const filePath = path.resolve(repoRoot, relativePath);
    requests.push(relativePath);
    if (!filePath.startsWith(repoRoot + path.sep) && filePath != repoRoot) {
      response.writeHead(403);
      response.end('Forbidden');
      return;
    }
    fs.readFile(filePath, (error, bytes) => {
      if (error) {
        response.writeHead(404);
        response.end('Not found');
        return;
      }
      response.writeHead(200, {'content-type': contentType(filePath)});
      response.end(bytes);
    });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({
    server,
    requests,
    url: `http://127.0.0.1:${server.address().port}/index.html`
  })));
}

async function installOfflineDependencyRoutes(page) {
  await page.route('**/cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0', route => {
    route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: fs.readFileSync(tfjsBrowserPath)
    });
  });
  await page.route('**/cdn.jsdelivr.net/npm/file-saver@2.0.5/dist/FileSaver.min.js',
    route => route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: 'window.saveAs = function saveAs() {};'
    }));
  await page.route('**/socket.io-3.0.0.js', route => route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: 'window.io = function io() { return { on() {}, emit() {} }; };'
  }));
}

async function openCleanPage(browser, url) {
  const context = await browser.newContext({viewport: {width: 1024, height: 768}});
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() == 'error') errors.push(message.text());
  });
  await installOfflineDependencyRoutes(page);
  await page.goto(url, {waitUntil: 'load'});
  await page.waitForFunction(() => typeof menu != 'undefined' && menu.visible &&
    typeof startAI == 'function', null, {timeout: 15000});
  return {context, page, errors};
}

async function clickVisiblePlayAi(page) {
  const center = await page.evaluate(() => {
    const button = menu.main.buttons.find(candidate =>
      candidate.text && candidate.text.text == 'play AI');
    return {
      x: button.rect.centerX / window.devicePixelRatio,
      y: button.rect.centerY / window.devicePixelRatio
    };
  });
  await page.mouse.click(center.x, center.y);
}

function runtimeEvidence() {
  const unitNames = player => player.units.map(unit => unit.constructor.name).sort();
  return {
    configuredModelUrl: gameSettings.aiModelUrl,
    modelName: ai_model.name,
    modelInputs: ai_model.inputs.map(input => input.shape),
    modelOutputs: ai_model.outputs.map(output => output.name),
    mapSize: {x: grid.arr.length, y: grid.arr[0].length},
    playerClasses: players.map(player => player.constructor.name),
    playerOneUnits: unitNames(players[1]),
    playerTwoUnits: unitNames(players[2]),
    towns: players.reduce((sum, player) => sum + player.towns.length, 0),
    goldmines: goldmines.length,
    external: external.length,
    externalProduction: externalProduction.length,
    nature: nature.length,
    withAI: gameSettings.withAI
  };
}

async function scoreModelControls(page) {
  return await page.evaluate(() => {
    const score = () => predict(ai_model, [vectoriseGrid()])[0][0];
    const originalWeights = ai_model.getWeights().map(weight => weight.clone());
    const real = score();
    ai_model.setWeights(originalWeights.map(weight => tf.zeros(weight.shape)));
    const zeroed = score();
    let state = 77077;
    const randomWeights = originalWeights.map(weight => {
      const values = new Float32Array(weight.size);
      for (let index = 0; index < values.length; ++index) {
        state = (state * 1664525 + 1013904223) >>> 0;
        values[index] = (state / 4294967296 - 0.5) * 0.1;
      }
      return tf.tensor(values, weight.shape, weight.dtype);
    });
    ai_model.setWeights(randomWeights);
    const randomized = score();
    ai_model.setWeights(originalWeights);
    originalWeights.forEach(weight => weight.dispose());
    randomWeights.forEach(weight => weight.dispose());
    return {real, zeroed, randomized, randomSeed: 77077};
  });
}

async function runOneModelBackedAction(page) {
  return await page.evaluate(() => {
    whooseTurn = 2;
    players[2].updateUnits();
    const before = players[2].units.map(unit => ({
      type: unit.constructor.name, x: unit.coord.x, y: unit.coord.y,
      hp: unit.hp, moves: unit.moves
    }));
    const result = players[2].selectBestCommand();
    const command = result[0];
    const chance = result[1];
    if (!command || !applyLiveAiCommandUnit(players[2], command)) {
      return {applied: false, chance};
    }
    const after = players[2].units.map(unit => ({
      type: unit.constructor.name, x: unit.coord.x, y: unit.coord.y,
      hp: unit.hp, moves: unit.moves
    }));
    return {
      applied: true,
      chance,
      command: {
        source: command.whoDoCommandCoord,
        destination: command.destinationCoord
      },
      before,
      after
    };
  });
}

(async function main() {
  check(fs.existsSync(path.join(repoRoot, 'models/play-ai/model.json')),
    'packaged Play AI model.json is missing');
  check(fs.existsSync(path.join(repoRoot, 'models/play-ai/weights.bin')),
    'packaged Play AI weights.bin is missing');
  const served = await serveRepo();
  const browser = await chromium.launch({headless: true});
  try {
    const realPage = await openCleanPage(browser, served.url);
    await clickVisiblePlayAi(realPage.page);
    await realPage.page.waitForFunction(() => typeof players != 'undefined' &&
      players.length == 3 && gameSettings.withAI === true,
      null, {timeout: 30000});
    const runtime = await realPage.page.evaluate(runtimeEvidence);
    const controls = await scoreModelControls(realPage.page);
    const action = await runOneModelBackedAction(realPage.page);

    const required = ['Archer', 'Catapult', 'KOHb', 'Noob', 'Normchel'];
    check(runtime.configuredModelUrl == 'models/play-ai/model.json',
      'normal browser flow did not select the packaged checkpoint', runtime);
    check(runtime.mapSize.x == 9 && runtime.mapSize.y == 9,
      'Play AI map is not 9x9', runtime);
    check(runtime.playerClasses[1] == 'Player' &&
      runtime.playerClasses[2] == 'AIPlayer',
      'Play AI classes are not Player versus learned AIPlayer', runtime);
    check(JSON.stringify(runtime.playerOneUnits) == JSON.stringify(required) &&
      JSON.stringify(runtime.playerTwoUnits) == JSON.stringify(required),
      'Play AI map is missing required combat unit types', runtime);
    check(runtime.towns == 0 && runtime.goldmines == 0 &&
      runtime.external == 0 && runtime.externalProduction == 0,
      'Play AI map contains economy objects', runtime);
    check(served.requests.includes('models/play-ai/model.json') &&
      served.requests.includes('models/play-ai/weights.bin'),
      'browser did not request both real checkpoint files', served.requests);
    check(Number.isFinite(controls.real) && controls.real != controls.zeroed &&
      controls.real != controls.randomized,
      'real checkpoint output is not distinct from model controls', controls);
    check(action.applied && JSON.stringify(action.before) != JSON.stringify(action.after),
      'learned AIPlayer did not apply a model-ranked legal action', action);
    await realPage.context.close();

    const missingPage = await openCleanPage(browser, served.url);
    await missingPage.page.route('**/models/play-ai/model.json', route =>
      route.fulfill({status: 404, body: 'missing checkpoint control'}));
    await clickVisiblePlayAi(missingPage.page);
    await missingPage.page.waitForTimeout(1000);
    const missing = await missingPage.page.evaluate(() => ({
      playerCount: typeof players == 'undefined' ? 0 : players.length,
      withAI: gameSettings.withAI
    }));
    check(missing.playerCount == 0 && missing.withAI === false &&
      missingPage.errors.length > 0,
      'missing-checkpoint control did not reject Play AI startup',
      {missing, errors: missingPage.errors});
    await missingPage.context.close();

    console.log(JSON.stringify({
      status: 'passed',
      cleanProfileMenuClick: true,
      checkpointRequests: served.requests.filter(request =>
        request.startsWith('models/play-ai/')),
      runtime,
      learnedAction: action,
      modelControls: {
        missing: {rejected: true, errors: missingPage.errors},
        zeroedScore: controls.zeroed,
        randomizedScore: controls.randomized,
        randomizedSeed: controls.randomSeed,
        realScore: controls.real,
        heuristicOnly: 'not present; AIPlayer.getWinningChances requires predict(ai_model, ...)'
      }
    }, null, 2));
    console.log('TASK-077 real browser Play AI combat map smoke passed');
  } finally {
    await browser.close();
    await new Promise(resolve => served.server.close(resolve));
  }
})().catch(error => {
  console.error(error.stack || error.message);
  if (error.details) console.error(JSON.stringify(error.details, null, 2));
  process.exitCode = 1;
});
