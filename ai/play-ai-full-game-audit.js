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
  `full Play AI browser audit requires Node.js 20 or newer; found ${process.version}`);

const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..');
const artifactDir = process.env.DIPLOMACY_PLAY_AI_ARTIFACT_DIR ||
  '/mnt/storage/diplomacy/browser-play-ai';
const maxNextTurnClicks = Number(process.env.DIPLOMACY_PLAY_AI_MAX_NEXT_TURNS || 80);

function contentType(filePath) {
  const ext = path.extname(filePath);
  if (ext == '.html') return 'text/html; charset=utf-8';
  if (ext == '.js') return 'application/javascript; charset=utf-8';
  if (ext == '.css') return 'text/css; charset=utf-8';
  if (ext == '.svg') return 'image/svg+xml';
  if (ext == '.json') return 'application/json; charset=utf-8';
  if (ext == '.png') return 'image/png';
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
  },
  train: {
    adam() {
      return {};
    }
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

async function waitForImages(page) {
  await page.waitForFunction(() => {
    return typeof images != 'undefined' &&
      typeof cachedImages != 'undefined' &&
      images.every(name => assets[name] && assets[name].complete &&
        assets[name].naturalWidth > 0);
  }, null, { timeout: 10000 });
}

async function hideTurnPauseOverlayAndDrawGrid(page) {
  await waitForImages(page);
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

function snapshotInBrowser(args) {
  const label = args.label;
  const sequence = args.sequence;
  function liveUnits(player) {
    return player.units.map((unit, index) => ({
      index,
      id: `${unit.constructor.name}-${index}`,
      name: unit.constructor.name,
      x: unit.coord.x,
      y: unit.coord.y,
      moves: unit.moves,
      hp: unit.hp,
      killed: unit.killed
    }));
  }

  function liveTowns(player) {
    return player.towns.map((town, index) => ({
      index,
      x: town.coord.x,
      y: town.coord.y,
      hp: town.hp,
      killed: town.killed
    }));
  }

  return {
    label,
    sequence,
    whooseTurn,
    currentPlayerClass: players[whooseTurn].constructor.name,
    gameRound,
    suddenDeathRound,
    pauseOverlayVisible: nextTurnPauseInterface.visible,
    withAI: gameSettings.withAI,
    testAI: gameSettings.testAI,
    modelSource: window.__playAiBrowserModelSource,
    predictionCalls: window.__playAiBrowserPredictionCalls,
    playerClasses: players.map(player => player.constructor.name),
    players: players.map((player, index) => ({
      index,
      type: player.constructor.name,
      lost: player.isLost,
      gold: player.gold,
      income: player.income,
      units: liveUnits(player),
      towns: liveTowns(player)
    }))
  };
}

async function captureTurnStart(page, label, sequence) {
  const snapshot = await page.evaluate(snapshotInBrowser, { label, sequence });
  const base = `${String(sequence).padStart(3, '0')}-${label}`;
  const snapshotPath = path.join(artifactDir, `${base}.json`);
  const screenshotPath = path.join(artifactDir, `${base}.png`);
  await hideTurnPauseOverlayAndDrawGrid(page);
  await page.screenshot({ path: screenshotPath });
  snapshot.screenshot = screenshotPath;
  snapshot.snapshot = snapshotPath;
  fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2));
  return snapshot;
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

async function gameStatus(page) {
  return await page.evaluate(() => {
    const active = [];
    for (let index = 1; index < players.length; ++index) {
      if (!players[index].isNeutral && !players[index].isLost) {
        active.push(index);
      }
    }
    return {
      whooseTurn,
      gameRound,
      suddenDeathRound,
      redLost: players[1].isLost,
      blueLost: players[2].isLost,
      active,
      winner: active.length == 1 ? active[0] : null,
      ended: players[1].isLost || players[2].isLost || active.length <= 1
    };
  });
}

async function automateRedTurn(page) {
  return await page.evaluate(() => {
    whooseTurn = 1;
    const actions = [];
    const maxActions = 80;

    function commandKey(command) {
      return [
        command.whoDoCommandCoord.x,
        command.whoDoCommandCoord.y,
        command.destinationCoord.x,
        command.destinationCoord.y
      ].join(':');
    }

    function distanceToBlue(cell) {
      let best = Infinity;
      for (let i = 0; i < players[2].units.length; ++i) {
        const unit = players[2].units[i];
        if (unit.killed) {
          continue;
        }
        best = Math.min(best,
          Math.abs(unit.coord.x - cell.coord.x) +
          Math.abs(unit.coord.y - cell.coord.y));
      }
      for (let i = 0; i < players[2].towns.length; ++i) {
        const town = players[2].towns[i];
        if (town.killed) {
          continue;
        }
        best = Math.min(best,
          Math.abs(town.coord.x - cell.coord.x) +
          Math.abs(town.coord.y - cell.coord.y));
      }
      return best;
    }

    function isAttackCommand(unit, command) {
      const cell = grid.getCell(command.destinationCoord);
      if (!cell) {
        return false;
      }
      return cell.unit && cell.unit.notEmpty && cell.unit.notEmpty() &&
        cell.unit.playerColor != 1 ||
        cell.building && cell.building.notEmpty && cell.building.notEmpty() &&
        cell.building.playerColor != 1;
    }

    function stateSignature() {
      return JSON.stringify(players.slice(1).map(function(player) {
        return {
          lost: player.isLost,
          units: player.units.map(function(unit) {
            return {
              name: unit.constructor.name,
              x: unit.coord.x,
              y: unit.coord.y,
              moves: unit.moves,
              hp: unit.hp,
              killed: unit.killed
            };
          })
        };
      }));
    }

    const ineffectiveCommands = new Set();

    function chooseCommand() {
      const candidates = [];
      for (let i = 0; i < players[1].units.length; ++i) {
        const unit = players[1].units[i];
        if (unit.killed || unit.moves <= 0) {
          continue;
        }
        const commands = unit.getAvailableCommands();
        for (let j = 0; j < commands.length; ++j) {
          const command = commands[j];
          const key = commandKey(command);
          if (ineffectiveCommands.has(key)) {
            continue;
          }
          if (coordsEqually(command.whoDoCommandCoord, command.destinationCoord)) {
            continue;
          }
          const cell = grid.getCell(command.destinationCoord);
          if (!cell) {
            continue;
          }
          candidates.push({
            unit,
            unitIndex: i,
            command,
            attack: isAttackCommand(unit, command),
            distance: distanceToBlue(cell),
            key
          });
        }
      }
      candidates.sort((left, right) =>
        Number(right.attack) - Number(left.attack) ||
        left.distance - right.distance ||
        left.unitIndex - right.unitIndex ||
        left.key.localeCompare(right.key));
      return candidates[0] || null;
    }

    for (let step = 0; step < maxActions; ++step) {
      if (players[1].isLost || players[2].isLost) {
        break;
      }
      const choice = chooseCommand();
      if (!choice) {
        break;
      }
      if (ineffectiveCommands.has(choice.key)) {
        break;
      }
      const before = {
        x: choice.unit.coord.x,
        y: choice.unit.coord.y,
        moves: choice.unit.moves
      };
      const beforeSignature = stateSignature();
      choice.unit.select();
      choice.unit.sendInstructions(grid.getCell(choice.command.destinationCoord));
      const afterSignature = stateSignature();
      const effective = beforeSignature != afterSignature;
      if (!effective) {
        ineffectiveCommands.add(choice.key);
        continue;
      }
      actions.push({
        unitIndex: choice.unitIndex,
        unitName: choice.unit.constructor.name,
        attack: choice.attack,
        from: before,
        to: {
          x: choice.unit.coord.x,
          y: choice.unit.coord.y,
          moves: choice.unit.moves
        },
        destination: {
          x: choice.command.destinationCoord.x,
          y: choice.command.destinationCoord.y
        }
      });
    }
    drawAll();
    return {
      appliedActions: actions.length,
      actions,
      redLost: players[1].isLost,
      blueLost: players[2].isLost
    };
  });
}

function liveUnitKey(unit) {
  return `${unit.name}-${unit.index}`;
}

function analyzeMovement(turns, finalStatus) {
  const observations = [];
  const failures = [];
  const staleByPlayer = { 1: 0, 2: 0 };
  const movedByPlayer = { 1: 0, 2: 0 };

  for (const turn of turns) {
    for (const player of turn.players.slice(1)) {
      const positions = new Set();
      for (const unit of player.units) {
        if (unit.killed) {
          continue;
        }
        const inBounds = unit.x >= 0 && unit.y >= 0 &&
          unit.x < turn.gridWidth && unit.y < turn.gridHeight;
        if (!inBounds) {
          failures.push(
            `${turn.label}: ${player.type} unit ${unit.name} has out-of-bounds coord ${unit.x},${unit.y}`);
        }
        const positionKey = `${unit.x}:${unit.y}`;
        if (positions.has(positionKey)) {
          failures.push(
            `${turn.label}: multiple live units for player ${player.index} share ${positionKey}`);
        }
        positions.add(positionKey);
      }
    }
  }

  for (let i = 1; i < turns.length; ++i) {
    const previous = turns[i - 1];
    const current = turns[i];
    for (let playerIndex = 1; playerIndex <= 2; ++playerIndex) {
      const previousPlayer = previous.players[playerIndex];
      const currentPlayer = current.players[playerIndex];
      const previousUnits = new Map(previousPlayer.units
        .filter(unit => !unit.killed)
        .map(unit => [liveUnitKey(unit), unit]));
      let changed = false;
      for (const unit of currentPlayer.units) {
        if (unit.killed) {
          continue;
        }
        const before = previousUnits.get(liveUnitKey(unit));
        if (!before || before.x != unit.x || before.y != unit.y ||
            before.hp != unit.hp || before.moves != unit.moves) {
          changed = true;
          break;
        }
      }
      if (changed) {
        movedByPlayer[playerIndex] += 1;
      }
      else {
        staleByPlayer[playerIndex] += 1;
      }
    }
  }

  const blueTurns = turns.filter(turn => turn.whooseTurn == 2);
  for (let i = 1; i < blueTurns.length; ++i) {
    if (blueTurns[i].predictionCalls <= blueTurns[i - 1].predictionCalls) {
      failures.push(
        `${blueTurns[i].label}: blue turn did not increase AI prediction calls`);
    }
  }

  if (finalStatus.winner == null) {
    failures.push('game did not reach a red/blue win-loss state');
  }
  if (movedByPlayer[1] == 0) {
    failures.push('red automated player never produced an observable position/state change');
  }
  if (movedByPlayer[2] == 0) {
    failures.push('blue AI player never produced an observable position/state change');
  }

  observations.push(`winner=${finalStatus.winner}`);
  observations.push(`red observable state changes=${movedByPlayer[1]}, stale transitions=${staleByPlayer[1]}`);
  observations.push(`blue observable state changes=${movedByPlayer[2]}, stale transitions=${staleByPlayer[2]}`);
  observations.push(failures.length ?
    `implausible movement findings=${failures.length}` :
    'movement audit passed: no out-of-bounds, stacked live units, skipped AI turns, or stalled win/loss state observed');

  return {
    passed: failures.length == 0,
    observations,
    failures,
    movedByPlayer,
    staleByPlayer
  };
}

async function enrichGridSize(page, snapshot) {
  const gridSize = await page.evaluate(() => ({
    gridWidth: grid.arr.length,
    gridHeight: grid.arr[0].length
  }));
  snapshot.gridWidth = gridSize.gridWidth;
  snapshot.gridHeight = gridSize.gridHeight;
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

  const turns = [];
  const redActions = [];

  try {
    await installRoutes(page);
    await page.goto(served.url, { waitUntil: 'load' });
    await waitForGameReady(page);
    await clickPlayAi(page);

    let sequence = 0;
    let status = await gameStatus(page);
    check(status.whooseTurn == 1, 'Play AI did not start on red player turn', status);

    while (!status.ended && sequence < maxNextTurnClicks) {
      if (status.whooseTurn == 1) {
        const redSnapshot = await captureTurnStart(
          page, `red-start-round-${status.gameRound}`, sequence++);
        await enrichGridSize(page, redSnapshot);
        turns.push(redSnapshot);

        const redTurn = await automateRedTurn(page);
        redActions.push({
          afterTurnLabel: redSnapshot.label,
          ...redTurn
        });
        status = await gameStatus(page);
        if (status.ended) {
          break;
        }

        await clickNextTurn(page);
        await page.waitForFunction(() => whooseTurn == 2 ||
          players[1].isLost || players[2].isLost, null, { timeout: 15000 });
        status = await gameStatus(page);
        if (status.ended) {
          break;
        }
      }

      if (status.whooseTurn == 2) {
        const blueSnapshot = await captureTurnStart(
          page, `blue-start-round-${status.gameRound}`, sequence++);
        await enrichGridSize(page, blueSnapshot);
        turns.push(blueSnapshot);

        await clickNextTurn(page);
        await page.waitForFunction(() => whooseTurn == 1 ||
          players[1].isLost || players[2].isLost, null, { timeout: 15000 });
        status = await gameStatus(page);
      }
    }

    if (!status.ended) {
      status = await gameStatus(page);
    }

    const finalSnapshot = await captureTurnStart(
      page, `final-round-${status.gameRound}`, sequence++);
    await enrichGridSize(page, finalSnapshot);
    turns.push(finalSnapshot);

    const audit = analyzeMovement(turns, status);
    const reportPath = path.join(artifactDir, 'task083-play-ai-full-game-report.json');
    const report = {
      status: audit.passed ? 'passed' : 'failed',
      url: served.url,
      artifactDir,
      maxNextTurnClicks,
      turnSnapshots: turns.map(turn => ({
        label: turn.label,
        whooseTurn: turn.whooseTurn,
        gameRound: turn.gameRound,
        screenshot: turn.screenshot,
        snapshot: turn.snapshot
      })),
      redActions,
      finalStatus: status,
      audit,
      browserConsole: consoleMessages.slice(-50)
    };
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    report.report = reportPath;

    check(report.turnSnapshots.some(turn => turn.whooseTurn == 1),
      'no red start-of-turn screenshot was captured', report);
    check(report.turnSnapshots.some(turn => turn.whooseTurn == 2),
      'no blue start-of-turn screenshot was captured', report);
    check(status.winner !== null, 'Play AI full-game run did not reach win/loss', report);
    check(audit.passed, 'Play AI movement audit found implausible movement', report);

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
