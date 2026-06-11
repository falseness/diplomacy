const fs = require('fs');
const http = require('http');
const path = require('path');

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
  `Play AI snapback reproduction requires Node.js 20 or newer; found ${process.version}`);

const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..');
const artifactDir = process.env.DIPLOMACY_PLAY_AI_SNAPBACK_ARTIFACT_DIR ||
  '/mnt/storage/diplomacy/browser-play-ai-snapback';
const regressionMode = process.argv.includes('--regression') ||
  process.env.DIPLOMACY_PLAY_AI_SNAPBACK_REGRESSION == '1';
const forceRedRestore = process.argv.includes('--force-red-restore') ||
  process.env.DIPLOMACY_PLAY_AI_FORCE_RED_RESTORE == '1';
const artifactPrefix = regressionMode ? 'task082' : 'task080';

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
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    const decodedPath = decodeURIComponent(url.pathname);
    const relativePath = decodedPath == '/' ? 'index.html' : decodedPath.slice(1);
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
        url: `http://127.0.0.1:${address.port}/index.html?aiModelUrl=models/play-ai/model.json`
      });
    });
  });
}

function tfStubScript() {
  return `
window.__playAiBrowserModelSource = undefined;
window.__playAiBrowserPredictionCalls = 0;
window.tf = {
  async loadLayersModel(source) {
    window.__playAiBrowserModelSource = source;
    return {
      inputs: [{ shape: [null, null, null, 78] }],
      predict(inputs) {
        window.__playAiBrowserPredictionCalls += 1;
        const count = inputs[0].values ? inputs[0].values.length : 1;
        return {
          arraySync() {
            const result = [];
            for (let index = 0; index < count; ++index) {
              result.push([0.1 + index / 1000]);
            }
            return result;
          },
          dispose() {}
        };
      }
    };
  },
  tensor3d(value) {
    return { value, dispose() {} };
  },
  tensor(value) {
    return { value, dispose() {} };
  },
  stack(values) {
    return { values, dispose() {} };
  },
  tidy(callback) {
    return callback();
  }
};
`;
}

async function installRoutes(page) {
  await page.route('**/cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0', route => {
    route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: tfStubScript()
    });
  });
  await page.route('**/cdn.jsdelivr.net/npm/file-saver@2.0.5/dist/FileSaver.min.js', route => {
    route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: 'window.saveAs = function saveAs() {};'
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

function redBlueSnapshotInBrowser(label) {
  return {
    label,
    whooseTurn,
    gameRound,
    pauseOverlayVisible: nextTurnPauseInterface.visible,
    withAI: gameSettings.withAI,
    modelSource: window.__playAiBrowserModelSource,
    predictionCalls: window.__playAiBrowserPredictionCalls,
    playerClasses: players.map(player => player.constructor.name),
    redUnits: players[1].units.map((unit, index) => ({
      index,
      name: unit.constructor.name,
      x: unit.coord.x,
      y: unit.coord.y,
      moves: unit.moves,
      hp: unit.hp,
      killed: unit.killed
    })),
    blueUnits: players[2].units.map((unit, index) => ({
      index,
      name: unit.constructor.name,
      x: unit.coord.x,
      y: unit.coord.y,
      moves: unit.moves,
      hp: unit.hp,
      killed: unit.killed
    }))
  };
}

async function hideTurnPauseOverlayAndDrawGrid(page) {
  await page.waitForFunction(() => {
    return typeof images != 'undefined' &&
      typeof cachedImages != 'undefined' &&
      images.every(name => assets[name] && assets[name].complete &&
        assets[name].naturalWidth > 0);
  }, null, { timeout: 10000 });
  await page.evaluate(() => {
    cacheAllImages();
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

async function captureState(page, label, fileName) {
  const snapshot = await page.evaluate(redBlueSnapshotInBrowser, label);
  await hideTurnPauseOverlayAndDrawGrid(page);
  const screenshotPath = path.join(artifactDir, fileName);
  await page.screenshot({ path: screenshotPath });
  snapshot.screenshot = screenshotPath;
  return snapshot;
}

async function applyOneLegalRedMove(page) {
  return await page.evaluate(() => {
    whooseTurn = 1;
    for (let index = 0; index < players[1].units.length; ++index) {
      const unit = players[1].units[index];
      if (unit.killed || unit.moves <= 0) {
        continue;
      }
      const available = unit.getAvailableCommands();
      for (let commandIndex = 0; commandIndex < available.length; ++commandIndex) {
        const command = available[commandIndex];
        if (coordsEqually(command.whoDoCommandCoord, command.destinationCoord)) {
          continue;
        }
        unit.select();
        unit.sendInstructions(grid.getCell(command.destinationCoord));
        drawAll();
        return {
          applied: true,
          unitIndex: index,
          unitName: unit.constructor.name,
          from: {
            x: command.whoDoCommandCoord.x,
            y: command.whoDoCommandCoord.y
          },
          to: {
            x: command.destinationCoord.x,
            y: command.destinationCoord.y
          },
          afterMove: {
            x: unit.coord.x,
            y: unit.coord.y,
            moves: unit.moves
          }
        };
      }
    }
    return { applied: false, reason: 'no legal red movement commands' };
  });
}

async function clickPlayAi(page) {
  await page.mouse.click(512, 540);
  await page.waitForFunction(() => {
    return typeof players != 'undefined' && players.length > 2 &&
      players[1].constructor.name == 'Player' &&
      players[2].constructor.name == 'AIPlayer' &&
      gameSettings.withAI === true;
  }, null, { timeout: 15000 });
}

async function clickNextTurn(page) {
  const point = await page.evaluate(() => ({
    x: nextTurnButton.rect.centerX / window.devicePixelRatio,
    y: nextTurnButton.rect.centerY / window.devicePixelRatio
  }));
  await page.mouse.click(point.x, point.y);
}

function findMovedUnit(snapshot, redMove) {
  return snapshot.redUnits.find(unit => unit.name == redMove.unitName);
}

async function forceRestoreMovedRedUnit(page, redMove, startMovedUnit) {
  return await page.evaluate(({ redMove, startMovedUnit }) => {
    const unit = players[1].units[redMove.unitIndex];
    const beforeRestore = {
      x: unit.coord.x,
      y: unit.coord.y,
      moves: unit.moves
    };
    grid.setUnit(new Empty(), unit.coord);
    unit.coord = {
      x: startMovedUnit.x,
      y: startMovedUnit.y
    };
    grid.setUnit(unit, unit.coord);
    drawAll();
    return {
      forced: true,
      unitIndex: redMove.unitIndex,
      unitName: unit.constructor.name,
      beforeRestore,
      afterRestore: {
        x: unit.coord.x,
        y: unit.coord.y,
        moves: unit.moves
      }
    };
  }, { redMove, startMovedUnit });
}

(async function main() {
  fs.mkdirSync(artifactDir, { recursive: true });

  const served = await serveRepo();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  const consoleMessages = [];
  page.on('console', message => {
    consoleMessages.push(`${message.type()}: ${message.text()}`);
  });
  page.on('pageerror', error => {
    consoleMessages.push(`pageerror: ${error.message}`);
  });

  try {
    await installRoutes(page);
    await page.goto(served.url, { waitUntil: 'load' });
    await waitForGameReady(page);

    await clickPlayAi(page);
    const redStart = await captureState(page, 'red-start', `${artifactPrefix}-red-start.png`);

    const redMove = await applyOneLegalRedMove(page);
    check(redMove.applied, 'red human player could not make a legal move', redMove);
    const afterRedMove = await captureState(page, 'after-red-move', `${artifactPrefix}-after-red-move.png`);

    await clickNextTurn(page);
    await page.waitForFunction(() => {
      return whooseTurn == 2 && window.__playAiBrowserPredictionCalls > 0;
    }, null, { timeout: 15000 });
    const blueComplete = await captureState(page, 'blue-complete', `${artifactPrefix}-blue-complete.png`);

    await clickNextTurn(page);
    await page.waitForFunction(() => whooseTurn == 1, null, { timeout: 15000 });

    check(redStart.modelSource == 'models/play-ai/model.json',
      'Play AI did not load the configured browser model', redStart);
    check(redStart.playerClasses[1] == 'Player' &&
        redStart.playerClasses[2] == 'AIPlayer',
      'Play AI did not start with human red and learned blue player classes',
      redStart);
    check(blueComplete.predictionCalls > redStart.predictionCalls,
      'blue AIPlayer did not run model-backed predictions after red clicked Next Turn',
      { redStart, blueComplete });

    const startMovedUnit = findMovedUnit(redStart, redMove);
    const afterMovedUnit = findMovedUnit(afterRedMove, redMove);
    const blueCompleteMovedUnit = findMovedUnit(blueComplete, redMove);
    check(startMovedUnit && afterMovedUnit && blueCompleteMovedUnit,
      'moved red unit could not be tracked before returning to red',
      { redMove, redStart, afterRedMove, blueComplete });

    const movedAwayFromStart = afterMovedUnit.x != startMovedUnit.x ||
      afterMovedUnit.y != startMovedUnit.y;
    check(movedAwayFromStart,
      'the selected legal red move did not change the tracked red unit position',
      { redMove, startMovedUnit, afterMovedUnit });

    const forcedRestore = forceRedRestore ?
      await forceRestoreMovedRedUnit(page, redMove, startMovedUnit) :
      null;
    const returnedRed = await captureState(page, 'returned-red', `${artifactPrefix}-returned-red.png`);
    const returnedMovedUnit = findMovedUnit(returnedRed, redMove);
    check(returnedMovedUnit,
      'moved red unit could not be tracked after returning to red',
      { redMove, returnedRed });

    const persistedAfterReturn = returnedMovedUnit.x == afterMovedUnit.x &&
      returnedMovedUnit.y == afterMovedUnit.y;
    const revertedAtBlueComplete = blueCompleteMovedUnit.x == startMovedUnit.x &&
      blueCompleteMovedUnit.y == startMovedUnit.y;
    const revertedAtReturnedRed = returnedMovedUnit.x == startMovedUnit.x &&
      returnedMovedUnit.y == startMovedUnit.y;
    const snapbackDetected = movedAwayFromStart &&
      (revertedAtBlueComplete || revertedAtReturnedRed);

    const report = {
      status: 'passed',
      url: served.url,
      mode: regressionMode ? 'regression' : 'reproduction',
      faultInjection: {
        forceRedRestore,
        forcedRestore
      },
      result: snapbackDetected ? 'snapback-detected' : 'red-position-persisted',
      snapbackDetected,
      redMove,
      trackedRedUnit: {
        start: startMovedUnit,
        afterRedMove: afterMovedUnit,
        blueComplete: blueCompleteMovedUnit,
        returnedRed: returnedMovedUnit,
        movedAwayFromStart,
        persistedAfterReturn,
        revertedAtBlueComplete,
        revertedAtReturnedRed
      },
      screenshots: {
        redStart: redStart.screenshot,
        afterRedMove: afterRedMove.screenshot,
        blueComplete: blueComplete.screenshot,
        returnedRed: returnedRed.screenshot
      },
      snapshots: {
        redStart,
        afterRedMove,
        blueComplete,
        returnedRed
      }
    };
    if (regressionMode) {
      report.status = persistedAfterReturn && !snapbackDetected ? 'passed' : 'failed';
    }
    const reportPath = path.join(artifactDir, `${artifactPrefix}-snapback-report.json`);
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    report.report = reportPath;
    if (regressionMode) {
      check(persistedAfterReturn,
        'Play AI snapback regression failed: red moved unit reverted before returning to red',
        report);
      check(!snapbackDetected,
        'Play AI snapback regression failed: snapback was detected in the red-blue-red cycle',
        report);
    }
    console.log(JSON.stringify(report, null, 2));
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
