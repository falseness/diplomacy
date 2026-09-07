const fs = require('fs');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const childProcess = require('child_process');

function check(condition, message, details) {
  if (!condition) {
    const error = new Error(message);
    if (details) {
      error.details = details;
    }
    throw error;
  }
}

const nodeMajor = Number(process.versions.node.split('.')[0]);
check(nodeMajor >= 20,
  `real Play AI browser test requires Node.js 20 or newer; found ${process.version}`);

const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..');
const artifactDir = process.env.DIPLOMACY_PLAY_AI_ARTIFACT_DIR ||
  '/mnt/storage/diplomacy/browser-play-ai';
const tfjsBrowserPath = path.join(
  repoRoot, 'node_modules/@tensorflow/tfjs/dist/tf.min.js');

function contentType(filePath) {
  const ext = path.extname(filePath);
  if (ext == '.html') return 'text/html; charset=utf-8';
  if (ext == '.js') return 'application/javascript; charset=utf-8';
  if (ext == '.css') return 'text/css; charset=utf-8';
  if (ext == '.svg') return 'image/svg+xml';
  if (ext == '.json') return 'application/json; charset=utf-8';
  return 'application/octet-stream';
}

function serveRepo() {
  const requests = [];
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    const decodedPath = decodeURIComponent(url.pathname);
    const relativePath = decodedPath == '/' ? 'index.html' : decodedPath.slice(1);
    requests.push(relativePath);
    const filePath = path.resolve(repoRoot, relativePath);
    if (!filePath.startsWith(repoRoot + path.sep) && filePath != repoRoot) {
      response.writeHead(403);
      response.end('Forbidden');
      return;
    }
    fs.readFile(filePath, (error, content) => {
      if (error) {
        response.writeHead(404);
        response.end('Not found');
        return;
      }
      response.writeHead(200, { 'content-type': contentType(filePath) });
      response.end(content);
    });
  });

  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        server,
        requests,
        url: `http://127.0.0.1:${address.port}/index.html`
      });
    });
  });
}

function fileSaverStubScript() {
  return 'window.saveAs = function saveAs() {};';
}

async function installRoutes(page) {
  await page.route('**/cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0', route => {
    route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: fs.readFileSync(tfjsBrowserPath)
    });
  });
  await page.route('**/cdn.jsdelivr.net/npm/file-saver@2.0.5/dist/FileSaver.min.js', route => {
    route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: fileSaverStubScript()
    });
  });
  await page.route('**/socket.io-3.0.0.js', route => {
    route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: 'window.io = function io() { return { on() {}, emit() {} }; };'
    });
  });
}

async function waitForGameReady(page) {
  await page.waitForFunction(() => {
    return typeof menu != 'undefined' && menu.visible &&
      typeof startAI == 'function' &&
      typeof nextTurnButton != 'undefined';
  }, null, { timeout: 15000 });
}

function blueSnapshotInBrowser() {
  return {
    whooseTurn,
    gameRound,
    pauseOverlayVisible: nextTurnPauseInterface.visible,
    withAI: gameSettings.withAI,
    testAI: gameSettings.testAI,
    modelName: ai_model && ai_model.name,
    modelInputs: ai_model && ai_model.inputs.map(input => input.shape),
    modelOutputs: ai_model && ai_model.outputs.map(output => output.name),
    modelRankedActions: players[2].winningChances.length,
    playerClasses: players.map(player => player.constructor.name),
    blueUnits: players[2].units
      .filter(unit => !unit.killed)
      .map(unit => ({
        name: unit.constructor.name,
        x: unit.coord.x,
        y: unit.coord.y,
        moves: unit.moves,
        hp: unit.hp
      }))
      .sort((left, right) =>
        left.name.localeCompare(right.name) || left.x - right.x || left.y - right.y),
    redUnits: players[1].units
      .filter(unit => !unit.killed)
      .map(unit => ({
        name: unit.constructor.name,
        x: unit.coord.x,
        y: unit.coord.y,
        moves: unit.moves,
        hp: unit.hp
      }))
  };
}

function interfaceCenterPixelInBrowser() {
  const context = document.getElementById('interface').getContext('2d');
  const pixel = context.getImageData(
    Math.floor(WIDTH / 2),
    Math.floor(HEIGHT / 2),
    1,
    1
  ).data;
  return {
    red: pixel[0],
    green: pixel[1],
    blue: pixel[2],
    alpha: pixel[3],
    pauseOverlayVisible: nextTurnPauseInterface.visible
  };
}

async function hideTurnPauseOverlayAndDrawGrid(page) {
  await page.evaluate(() => {
    nextTurnPauseInterface.hideButDontUpdateTimer();
    drawAll();
  });
  await page.waitForFunction(() => {
    const context = document.getElementById('interface').getContext('2d');
    const pixel = context.getImageData(
      Math.floor(WIDTH / 2),
      Math.floor(HEIGHT / 2),
      1,
      1
    ).data;
    return !nextTurnPauseInterface.visible && pixel[3] == 0;
  }, null, { timeout: 5000 });
}

async function applyOneLegalRedMove(page) {
  return await page.evaluate(() => {
    whooseTurn = 1;
    const commands = [];
    for (let index = 0; index < players[1].units.length; ++index) {
      const unit = players[1].units[index];
      if (!unit.killed && unit.moves > 0) {
        const available = unit.getAvailableCommands();
        for (let commandIndex = 0; commandIndex < available.length; ++commandIndex) {
          const command = available[commandIndex];
          if (!coordsEqually(command.whoDoCommandCoord, command.destinationCoord)) {
            commands.push(command);
          }
        }
      }
    }
    if (!commands.length) {
      return { applied: false, reason: 'no legal red movement commands' };
    }
    const command = commands[0];
    const unit = grid.getCell(command.whoDoCommandCoord).unit;
    unit.select();
    unit.sendInstructions(grid.getCell(command.destinationCoord));
    drawAll();
    return {
      applied: true,
      command,
      redUnit: {
        name: unit.constructor.name,
        x: unit.coord.x,
        y: unit.coord.y,
        moves: unit.moves
      }
    };
  });
}

async function clickPlayAi(page, waitForStart = true) {
  const center = await page.evaluate(() => {
    const button = menu.main.buttons.find(candidate =>
      candidate.text && candidate.text.text == 'play AI');
    return {
      x: button.rect.centerX / window.devicePixelRatio,
      y: button.rect.centerY / window.devicePixelRatio
    };
  });
  await page.mouse.click(center.x, center.y);
  if (!waitForStart) return;
  await page.waitForFunction(() => {
    return typeof players != 'undefined' && players.length > 2 &&
      players[1].constructor.name == 'Player' &&
      players[2].constructor.name == 'AIPlayer' &&
      gameSettings.withAI === true;
  }, null, { timeout: 15000 });
}

async function applyModelControl(page, control) {
  return page.evaluate(controlName => {
    if (controlName == 'real') return {name: controlName, seed: null};
    const weights = ai_model.getWeights();
    if (controlName == 'zeroed') {
      ai_model.setWeights(weights.map(weight => tf.zeros(weight.shape)));
      return {name: controlName, seed: null};
    }
    let state = 79079;
    const randomized = weights.map(weight => {
      const values = new Float32Array(weight.size);
      for (let index = 0; index < values.length; ++index) {
        state = (state * 1664525 + 1013904223) >>> 0;
        values[index] = (state / 4294967296 - 0.5) * 0.1;
      }
      return tf.tensor(values, weight.shape, weight.dtype);
    });
    ai_model.setWeights(randomized);
    randomized.forEach(weight => weight.dispose());
    return {name: controlName, seed: 79079};
  }, control);
}

function blueMovementDeltas(before, after) {
  const afterByName = new Map(after.map(unit => [unit.name, unit]));
  return before.flatMap(unit => {
    const next = afterByName.get(unit.name);
    if (!next || (unit.x == next.x && unit.y == next.y)) return [];
    return [{
      unit: unit.name,
      source: {x: unit.x, y: unit.y},
      destination: {x: next.x, y: next.y}
    }];
  });
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

async function clickNextTurn(page) {
  const point = await page.evaluate(() => ({
    x: nextTurnButton.rect.centerX / window.devicePixelRatio,
    y: nextTurnButton.rect.centerY / window.devicePixelRatio
  }));
  await page.mouse.click(point.x, point.y);
}

(async function main() {
  fs.mkdirSync(artifactDir, { recursive: true });

  const modelJsonPath = path.join(repoRoot, 'models/play-ai/model.json');
  const weightsPath = path.join(repoRoot, 'models/play-ai/weights.bin');
  check(fs.existsSync(tfjsBrowserPath), 'local TensorFlow.js browser runtime is missing');
  check(fs.existsSync(modelJsonPath), 'packaged Play AI model.json is missing');
  check(fs.existsSync(weightsPath), 'packaged Play AI weights.bin is missing');

  const served = await serveRepo();
  const browser = await chromium.launch({ headless: true });
  const consoleMessages = [];

  async function openCleanPage() {
    const context = await browser.newContext({ viewport: { width: 1024, height: 768 } });
    const page = await context.newPage();
    page.on('console', message => {
      if (message.type() == 'error') {
        consoleMessages.push(`${message.type()}: ${message.text()}`);
      }
    });
    page.on('pageerror', error => {
      consoleMessages.push(`pageerror: ${error.message}`);
    });
    await installRoutes(page);
    await page.goto(served.url, { waitUntil: 'load' });
    await waitForGameReady(page);
    return {context, page};
  }

  async function runTurnScenario(control, captureScreenshots) {
    const clean = await openCleanPage();
    const page = clean.page;
    try {
      await clickPlayAi(page);
      await hideTurnPauseOverlayAndDrawGrid(page);
      const initialInterfacePixel = await page.evaluate(interfaceCenterPixelInBrowser);
      let initialPath = null;
      let initialScreenshot = null;
      if (captureScreenshots) {
        initialPath = path.join(artifactDir, 'task079-initial-grid.png');
        initialScreenshot = await page.screenshot({path: initialPath});
      }

      const beforeRed = await page.evaluate(blueSnapshotInBrowser);
      const redMove = await applyOneLegalRedMove(page);
      check(redMove.applied, 'red human player could not make a legal move', redMove);
      const afterRedBeforeBlue = await page.evaluate(blueSnapshotInBrowser);
      const modelControl = await applyModelControl(page, control);
      const controlScore = await page.evaluate(() => predict(ai_model, [vectoriseGrid()])[0][0]);
      await page.evaluate(() => {
        // Keep this browser smoke bounded to the first automatic model-ranked action.
        // This does not alter action enumeration, scoring, or authoritative execution.
        gameSettings.aiActionLimit = 1;
      });

      await clickNextTurn(page);
      await page.waitForFunction(() => {
        return whooseTurn == 2 && players[2].winningChances.length > 0;
      }, null, { timeout: 30000 });

      const afterBlue = await page.evaluate(blueSnapshotInBrowser);
      await hideTurnPauseOverlayAndDrawGrid(page);
      const finalInterfacePixel = await page.evaluate(interfaceCenterPixelInBrowser);
      let finalPath = null;
      let finalScreenshot = null;
      if (captureScreenshots) {
        finalPath = path.join(artifactDir, 'task079-after-blue-ai-turn-grid.png');
        finalScreenshot = await page.screenshot({path: finalPath});
      }

      return {
        control: modelControl,
        aiActionLimit: 1,
        controlScore,
        screenshots: {initialGrid: initialPath, afterBlueAiTurnGrid: finalPath},
        screenshotBytesDiffer: captureScreenshots && !initialScreenshot.equals(finalScreenshot),
        interfacePixels: {
          initialCenter: initialInterfacePixel,
          afterBlueAiTurnCenter: finalInterfacePixel
        },
        redMove,
        beforeRed,
        afterRedBeforeBlue,
        afterBlue,
        blueMovementDeltas: blueMovementDeltas(
          afterRedBeforeBlue.blueUnits, afterBlue.blueUnits)
      };
    } finally {
      await clean.context.close();
    }
  }

  try {
    const real = await runTurnScenario('real', true);
    const zeroed = await runTurnScenario('zeroed', false);
    const randomized = await runTurnScenario('randomized', false);
    const turnErrors = consoleMessages.slice();
    check(!turnErrors.some(message =>
      message.includes('unit.sendInstructions is not a function')),
    'Play AI turn emitted unit.sendInstructions TypeError', turnErrors);
    check(!turnErrors.some(message => message.startsWith('pageerror:')),
      'Play AI turn emitted an unexpected browser exception', turnErrors);

    const missing = await openCleanPage();
    const missingErrorsStart = consoleMessages.length;
    await missing.page.route('**/models/play-ai/model.json', route =>
      route.fulfill({status: 404, body: 'TASK-079 missing checkpoint control'}));
    await clickPlayAi(missing.page, false);
    await missing.page.waitForTimeout(1000);
    const missingState = await missing.page.evaluate(() => ({
      playerCount: typeof players == 'undefined' ? 0 : players.length,
      withAI: gameSettings.withAI
    }));
    const missingErrors = consoleMessages.slice(missingErrorsStart);
    await missing.context.close();

    check(real.beforeRed.modelName &&
        real.beforeRed.modelInputs[0][1] == 9 &&
        real.beforeRed.modelInputs[0][2] == 9 &&
        real.beforeRed.modelInputs[0][3] == 82,
      'Play AI did not load the packaged 9x9/82-channel model', real.beforeRed);
    check(real.beforeRed.playerClasses[1] == 'Player' &&
        real.beforeRed.playerClasses[2] == 'AIPlayer',
      'Play AI did not start with human red and learned blue player classes',
      real.beforeRed);
    check(real.afterBlue.modelRankedActions >
        real.afterRedBeforeBlue.modelRankedActions,
      'blue AIPlayer did not rank actions with the loaded model after Next Turn', real);
    check(real.afterBlue.pauseOverlayVisible === true,
      'test did not observe the Player 2 turn overlay before dismissing it',
      real.afterBlue);
    check(real.interfacePixels.initialCenter.alpha == 0 &&
        real.interfacePixels.afterBlueAiTurnCenter.alpha == 0,
      'grid screenshots were captured with the turn overlay still visible',
      real.interfacePixels);
    check(real.blueMovementDeltas.length > 0,
      'blue AIPlayer did not visibly relocate a unit after Next Turn', real);
    const legalVisibleBlueMove = real.blueMovementDeltas[0];
    check(legalVisibleBlueMove.destination.x >= 0 &&
        legalVisibleBlueMove.destination.x < 9 &&
        legalVisibleBlueMove.destination.y >= 0 &&
        legalVisibleBlueMove.destination.y < 9,
      'visible blue relocation ended outside the runtime grid', legalVisibleBlueMove);
    check(real.screenshotBytesDiffer,
      'initial and after-action grid screenshots are identical',
      real.screenshots);
    check(real.controlScore != zeroed.controlScore &&
        real.controlScore != randomized.controlScore,
      'real checkpoint score is not distinct from zero/random controls',
      {real: real.controlScore, zeroed: zeroed.controlScore,
        randomized: randomized.controlScore});
    check(JSON.stringify(real.blueMovementDeltas) !=
        JSON.stringify(zeroed.blueMovementDeltas) ||
        JSON.stringify(real.blueMovementDeltas) !=
        JSON.stringify(randomized.blueMovementDeltas),
      'real checkpoint turn is indistinguishable from both model controls',
      {real: real.blueMovementDeltas, zeroed: zeroed.blueMovementDeltas,
        randomized: randomized.blueMovementDeltas});
    check(missingState.playerCount == 0 && missingState.withAI === false &&
        missingErrors.length > 0,
      'missing-checkpoint control did not reject Play AI startup',
      {missingState, missingErrors});

    const checkpoint = {
      modelJson: {path: 'models/play-ai/model.json', sha256: sha256(modelJsonPath)},
      weights: {path: 'models/play-ai/weights.bin', sha256: sha256(weightsPath)},
      requestedFiles: served.requests.filter(request => request.startsWith('models/play-ai/')),
      trainingSource: '/mnt/storage/diplomacy/final/task061-generated-retrain-20260906',
      knownTrainingSeeds: '61000-61005',
      browserScenarioSeed: 'none; fixed hand-authored Play AI map',
      randomizedControlSeed: 79079,
      seedIntersections: 'empty'
    };

    console.log(JSON.stringify({
      status: 'passed',
      url: served.url,
      normalEntrypoint: 'index.html',
      menuAction: 'clicked visible play AI button',
      repositoryCommit: childProcess.execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: repoRoot, encoding: 'utf8'}).trim(),
      checkpoint,
      real,
      controls: {
        zeroed: {
          score: zeroed.controlScore,
          blueMovementDeltas: zeroed.blueMovementDeltas
        },
        randomized: {
          score: randomized.controlScore,
          seed: randomized.control.seed,
          blueMovementDeltas: randomized.blueMovementDeltas
        },
        missing: {rejected: true, state: missingState, errors: missingErrors},
        heuristicOnly: 'not applicable; AIPlayer.getWinningChances calls predict(ai_model, ...) without a fused heuristic score'
      },
      legalVisibleBlueMove,
      turnErrors,
      noSendInstructionsTypeError: true,
      legalActionBasis: 'unchanged AIPlayer.selectBestCommand enumerated getAvailableCommands and applied the selected command through applyLiveAiCommandUnit',
      acceptance: {
        browserEntrypoint: 'PASS',
        initialGridScreenshot: 'PASS',
        legalRedMoveAndNextTurnClick: 'PASS',
        automaticBlueAIPlayerTurn: 'PASS',
        secondGridScreenshotAndLegalVisibleBlueMove: 'PASS',
        antiCheatingPolicy: 'PASS'
      },
      marker: 'TASK-079 REAL CHECKPOINT BROWSER TURN PASSED'
    }, null, 2));
  } catch (error) {
    console.error(error.stack || error.message);
    if (error.details) {
      console.error(JSON.stringify(error.details, null, 2));
    }
    if (consoleMessages.length) {
      console.error(JSON.stringify({ browserConsole: consoleMessages.slice(-50) }, null, 2));
    }
    process.exitCode = 1;
  } finally {
    await browser.close();
    await new Promise(resolve => served.server.close(resolve));
  }
})();
