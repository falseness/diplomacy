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
  `Play AI invalid command reproduction requires Node.js 20 or newer; found ${process.version}`);

const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..');
const artifactDir = process.env.DIPLOMACY_PLAY_AI_INVALID_COMMAND_ARTIFACT_DIR ||
  '/mnt/storage/diplomacy/browser-play-ai-invalid-command';

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
window.__playAiInvalidCommandPredictionCalls = 0;
window.tf = {
  async loadLayersModel(source) {
    window.__playAiInvalidCommandModelSource = source;
    return {
      inputs: [{ shape: [null, null, null, 78] }],
      predict(inputs) {
        window.__playAiInvalidCommandPredictionCalls += 1;
        return {
          arraySync() {
            return inputs[0].values.map(function(unused, index) {
              return [0.1 + index / 1000];
            });
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

async function hideTurnPauseOverlayAndDrawGrid(page) {
  await page.evaluate(() => {
    nextTurnPauseInterface.hideButDontUpdateTimer();
    drawAll();
  });
  await page.waitForFunction(() => !nextTurnPauseInterface.visible,
    null, { timeout: 5000 });
}

async function injectInvalidBlueCommandSource(page) {
  return await page.evaluate(() => {
    const actingUnit = players[2].units.find(unit => !unit.killed && unit.moves > 0);
    if (!actingUnit) {
      return { injected: false, reason: 'blue AIPlayer has no movable units' };
    }

    let invalidCoord = null;
    let destinationCoord = null;
    for (let x = 0; x < grid.arr.length && !invalidCoord; ++x) {
      for (let y = 0; y < grid.arr[x].length && !invalidCoord; ++y) {
        const coord = { x, y };
        const cell = grid.getCell(coord);
        const neighbourCommands = actingUnit.createCommandsFromDestinations([coord]);
        if (cell.unit.notEmpty && cell.unit.notEmpty()) {
          continue;
        }
        if (cell.building.notEmpty && cell.building.notEmpty()) {
          continue;
        }
        if (!neighbourCommands.length) {
          continue;
        }
        invalidCoord = coord;
      }
    }
    if (!invalidCoord) {
      return { injected: false, reason: 'no empty invalid command source cell found' };
    }

    const sourceCell = grid.getCell(invalidCoord);
    const originalSourceUnit = sourceCell.unit;
    sourceCell.unit = {
      constructor: { name: 'InvalidCommandSourceWithoutSendInstructions' },
      playerColor: 2,
      coord: invalidCoord,
      moves: 1,
      killed: false,
      notEmpty() {
        return true;
      },
      isEmpty() {
        return false;
      },
      select() {
        window.__playAiInvalidCommandSourceSelected = true;
      },
      draw() {
      },
      drawBars() {
      }
    };

    destinationCoord = { x: actingUnit.coord.x, y: actingUnit.coord.y };
    actingUnit.getAvailableCommands = function getAvailableCommands() {
      return [{
        type: 'unit',
        whoDoCommandCoord: { x: invalidCoord.x, y: invalidCoord.y },
        destinationCoord: { x: destinationCoord.x, y: destinationCoord.y }
      }];
    };

    window.__playAiInvalidCommandEvidence = {
      injected: true,
      playerClasses: players.map(player => player.constructor.name),
      whooseTurn,
      actingUnit: {
        name: actingUnit.constructor.name,
        coord: { x: actingUnit.coord.x, y: actingUnit.coord.y },
        moves: actingUnit.moves
      },
      invalidSource: {
        coord: invalidCoord,
        name: sourceCell.unit.constructor.name,
        hasSelect: typeof sourceCell.unit.select == 'function',
        hasSendInstructions: typeof sourceCell.unit.sendInstructions == 'function',
        originalSourceName: originalSourceUnit.constructor.name
      },
      destinationCoord
    };
    return window.__playAiInvalidCommandEvidence;
  });
}

function isExpectedCrash(error) {
  const text = `${error.message}\n${error.stack || ''}`;
  return text.includes('unit.sendInstructions is not a function') &&
    text.includes('AIPlayer.selectBestCommand') &&
    text.includes('AIPlayer.doActions') &&
    text.includes('AIPlayer.nextTurn') &&
    text.includes('offlineNextTurn');
}

function isSendInstructionsTypeError(error) {
  const text = `${error.message}\n${error.stack || ''}`;
  return text.includes('unit.sendInstructions is not a function');
}

(async function main() {
  fs.mkdirSync(artifactDir, { recursive: true });

  const served = await serveRepo();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  const consoleMessages = [];
  const pageErrors = [];
  page.on('console', message => {
    consoleMessages.push(`${message.type()}: ${message.text()}`);
  });
  page.on('pageerror', error => {
    pageErrors.push({
      message: error.message,
      stack: error.stack || ''
    });
  });

  try {
    await installRoutes(page);
    await page.goto(served.url, { waitUntil: 'load' });
    await waitForGameReady(page);
    await clickPlayAi(page);
    await hideTurnPauseOverlayAndDrawGrid(page);

    const evidence = await injectInvalidBlueCommandSource(page);
    check(evidence.injected, 'could not inject invalid blue AI command source', evidence);
    check(evidence.playerClasses[2] == 'AIPlayer',
      'Play AI did not start the blue learned AIPlayer path', evidence);
    check(evidence.invalidSource.hasSelect === true &&
        evidence.invalidSource.hasSendInstructions === false,
      'invalid command source does not match the reported failure shape', evidence);

    await clickNextTurn(page);
    await page.waitForTimeout(1000);

    const expectedError = pageErrors.find(isExpectedCrash);
    const sendInstructionsTypeError = pageErrors.find(isSendInstructionsTypeError);
    const postTurnEvidence = await page.evaluate(() => ({
      invalidSourceSelected: Boolean(window.__playAiInvalidCommandSourceSelected),
      whooseTurn,
      predictionCount: window.__aiPlayerPredictionCount || 0
    }));
    const report = {
      status: sendInstructionsTypeError ? 'failed' : 'passed',
      url: served.url,
      reproductionCommand: 'npm run test-play-ai-invalid-command',
      reportedStacktrace: [
        'Uncaught TypeError: unit.sendInstructions is not a function',
        '    at AIPlayer.selectBestCommand (players.js:660:26)',
        '    at AIPlayer.doActions (players.js:690:46)',
        '    at AIPlayer.nextTurn (players.js:713:18)',
        '    at offlineNextTurn (nextTurn.js:60:25)',
        '    at gameLogicButtons.nextTurn [as clickFunc] (nextTurn.js:89:9)',
        '    at gameLogicButtons.click (button.js:97:22)',
        '    at gameLogicButtons.click (nextTurn.js:137:22)',
        '    at Events.click (events.js:311:28)',
        '    at HTMLDocument.click (events.js:57:15)'
      ].join('\n'),
      observedError: expectedError || null,
      evidence,
      postTurnEvidence,
      fixedExpectation: 'Invalid command sources are skipped without calling sendInstructions.',
      pageErrors,
      browserConsole: consoleMessages.slice(-50)
    };
    const reportPath = path.join(artifactDir, 'task085-invalid-command-report.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    report.report = reportPath;

    check(!sendInstructionsTypeError,
      'Play AI invalid command regression still observed unit.sendInstructions TypeError',
      report);
    check(postTurnEvidence.invalidSourceSelected === false,
      'AI selected the invalid command source instead of skipping it',
      report);

    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    console.error(error.stack || error.message);
    if (error.details) {
      console.error(JSON.stringify(error.details, null, 2));
    }
    process.exitCode = 1;
  } finally {
    await browser.close();
    await new Promise(resolve => served.server.close(resolve));
  }
})();
