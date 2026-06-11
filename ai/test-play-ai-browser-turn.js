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
  `real Play AI browser test requires Node.js 20 or newer; found ${process.version}`);

const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..');
const artifactDir = process.env.DIPLOMACY_PLAY_AI_ARTIFACT_DIR ||
  '/mnt/storage/diplomacy/browser-play-ai';

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

function fileSaverStubScript() {
  return 'window.saveAs = function saveAs() {};';
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
    modelSource: window.__playAiBrowserModelSource,
    predictionCalls: window.__playAiBrowserPredictionCalls,
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
    await hideTurnPauseOverlayAndDrawGrid(page);
    const initialInterfacePixel = await page.evaluate(interfaceCenterPixelInBrowser);
    const initialPath = path.join(artifactDir, 'task079-initial-grid.png');
    const initialScreenshot = await page.screenshot({ path: initialPath });

    const beforeMove = await page.evaluate(blueSnapshotInBrowser);
    const redMove = await applyOneLegalRedMove(page);
    check(redMove.applied, 'red human player could not make a legal move', redMove);

    await clickNextTurn(page);
    await page.waitForFunction(() => {
      return whooseTurn == 2 && window.__playAiBrowserPredictionCalls > 0;
    }, null, { timeout: 15000 });

    const afterMove = await page.evaluate(blueSnapshotInBrowser);
    await hideTurnPauseOverlayAndDrawGrid(page);
    const finalInterfacePixel = await page.evaluate(interfaceCenterPixelInBrowser);
    const finalPath = path.join(artifactDir, 'task079-after-blue-ai-turn-grid.png');
    const finalScreenshot = await page.screenshot({ path: finalPath });

    check(beforeMove.modelSource == 'models/play-ai/model.json',
      'Play AI did not load the configured browser model', beforeMove);
    check(beforeMove.playerClasses[1] == 'Player' &&
        beforeMove.playerClasses[2] == 'AIPlayer',
      'Play AI did not start with human red and learned blue player classes',
      beforeMove);
    check(afterMove.predictionCalls > beforeMove.predictionCalls,
      'blue AIPlayer did not run model-backed predictions after Next Turn',
      { beforeMove, afterMove });
    check(afterMove.pauseOverlayVisible === true,
      'test did not observe the Player 2 turn overlay before dismissing it',
      afterMove);
    check(initialInterfacePixel.alpha == 0 && finalInterfacePixel.alpha == 0,
      'grid screenshots were captured with the turn overlay still visible',
      { initialInterfacePixel, finalInterfacePixel });

    const beforeBlue = JSON.stringify(beforeMove.blueUnits);
    const afterBlue = JSON.stringify(afterMove.blueUnits);
    check(beforeBlue != afterBlue,
      'blue AIPlayer unit state did not visibly change after Next Turn',
      { beforeMove, afterMove, redMove });
    check(!initialScreenshot.equals(finalScreenshot),
      'initial and after-action grid screenshots are identical',
      { initialPath, finalPath, beforeMove, afterMove });

    console.log(JSON.stringify({
      status: 'passed',
      url: served.url,
      screenshots: {
        initialGrid: initialPath,
        afterBlueAiTurnGrid: finalPath
      },
      interfacePixels: {
        initialCenter: initialInterfacePixel,
        afterBlueAiTurnCenter: finalInterfacePixel
      },
      redMove,
      beforeMove,
      afterMove
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
