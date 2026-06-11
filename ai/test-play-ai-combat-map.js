const fs = require('fs');
const path = require('path');
const vm = require('vm');

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
  `play AI combat map smoke requires Node.js 20 or newer for jsdom 24; found ${process.version}`);

const { JSDOM } = require('jsdom');
const repoRoot = path.resolve(__dirname, '..');

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function getLocalBrowserScripts(html) {
  return Array.from(html.matchAll(/<script[^>]+src=['"]([^'"]+)['"]/g))
    .map(match => match[1])
    .filter(src => !/^https?:\/\//.test(src));
}

function createCanvasContext(canvas) {
  return {
    canvas,
    setTransform() {},
    clearRect() {},
    fillRect() {},
    drawImage() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    closePath() {},
    fill() {},
    stroke() {},
    arc() {},
    save() {},
    restore() {},
    translate() {},
    rotate() {},
    scale() {},
    measureText(text) {
      return { width: String(text).length * 8 };
    },
    fillText() {},
    strokeText() {},
    setLineDash() {},
    rect() {},
    clip() {},
    quadraticCurveTo() {},
    bezierCurveTo() {}
  };
}

function createBrowserDom() {
  const dom = new JSDOM(
    '<!doctype html><html><body>' +
      '<canvas id="canvas"></canvas><canvas id="interface"></canvas>' +
    '</body></html>',
    {
      url: 'http://localhost/?aiModelUrl=models/play-ai/model.json',
      runScripts: 'outside-only',
      pretendToBeVisual: true
    }
  );
  const window = dom.window;
  window.innerWidth = 1024;
  window.innerHeight = 768;
  window.devicePixelRatio = 1;
  window.console = console;
  window.saveAs = function saveAs() {};
  window.io = function io() {
    return {
      on() {},
      emit() {}
    };
  };
  window.requestAnimationFrame = function requestAnimationFrame() {
    return 0;
  };
  window.cancelAnimationFrame = function cancelAnimationFrame() {};
  window.Image = class SmokeImage {
    constructor() {
      this.complete = true;
      setTimeout(() => {
        if (this.onload) {
          this.onload();
        }
      }, 0);
    }
    set src(value) {
      this._src = value;
    }
    get src() {
      return this._src;
    }
  };
  window.HTMLCanvasElement.prototype.getContext = function getContext() {
    return createCanvasContext(this);
  };

  let loadedModelSource;
  window.tf = {
    async loadLayersModel(source) {
      loadedModelSource = source;
      return {
        inputs: [{ shape: [null, null, null, 78] }],
        predict(inputs) {
          return {
            arraySync() {
              return inputs[0].values.map((unused, index) => [0.1 + index / 1000]);
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

  return {
    dom,
    getLoadedModelSource() {
      return loadedModelSource;
    }
  };
}

function loadIndexScripts(dom, scriptPaths) {
  const context = dom.getInternalVMContext();
  for (const scriptPath of scriptPaths) {
    const source = readRepoFile(scriptPath);
    new vm.Script(source, { filename: scriptPath }).runInContext(context);
  }
  return context;
}

async function startPlayAiMode(context) {
  return await vm.runInContext(`(async function runPlayAiSmoke() {
    gameSettings.aiModelUrl = 'models/play-ai/model.json';
    gameEvent = {
      selected: undefined,
      screen: { stop() {}, moveToPlayer() {} },
      hideAll() {},
      nextTurn() {}
    };
    entityInterface = { visible: false, change() {} };
    nextTurnButton = { highlightButton: false, setNextPlayerColor() {} };
    nextTurnPauseInterface = { visible: false };
    saveManager = { save() {} };
    mainCtx = document.getElementById('canvas').getContext('2d');

    await startAI(0);

    function unitNames(player) {
      return player.units.map(function(unit) {
        return unit.constructor.name;
      }).sort();
    }

    return {
      gameSlot: gameSlot,
      withAI: gameSettings.withAI,
      isFogOfWar: isFogOfWar,
      suddenDeathRound: suddenDeathRound,
      gridSize: { x: grid.arr.length, y: grid.arr[0].length },
      playerClasses: players.map(function(player) {
        return player.constructor.name;
      }),
      playerOneUnits: unitNames(players[1]),
      playerTwoUnits: unitNames(players[2]),
      playerOneTownCount: players[1].towns.length,
      playerTwoTownCount: players[2].towns.length,
      goldmineCount: goldmines.length,
      externalCount: external.length,
      externalProductionCount: externalProduction.length,
      natureCount: nature.length
    };
  })()`, context);
}

(async function main() {
  const html = readRepoFile('index.html');
  const scriptPaths = getLocalBrowserScripts(html);
  check(scriptPaths.includes('menu/menu.js'),
    'index.html browser script path does not include menu/menu.js');
  check(scriptPaths.includes('ai/gameManagerTraining.js'),
    'index.html browser script path does not include ai/gameManagerTraining.js');
  check(scriptPaths.includes('ai/generateMap.js'),
    'index.html browser script path does not include ai/generateMap.js');

  const browser = createBrowserDom();
  const context = loadIndexScripts(browser.dom, scriptPaths);
  const result = await startPlayAiMode(context);
  const requiredUnitTypes = ['Archer', 'Catapult', 'KOHb', 'Noob', 'Normchel'];

  check(browser.getLoadedModelSource() == 'models/play-ai/model.json',
    'play AI mode did not load the configured browser-safe learned model');
  check(result.gameSlot === 0,
    'play AI mode did not use the requested slot', result);
  check(result.withAI === true,
    'play AI mode did not enable gameSettings.withAI', result);
  check(result.isFogOfWar === false,
    'play AI mode should start without fog of war for manual AI testing', result);
  check(result.gridSize.x == 9 && result.gridSize.y == 9,
    'play AI mode did not start a 9x9 map', result);
  check(result.playerClasses[1] == 'Player',
    'human side is not the normal Player class', result);
  check(result.playerClasses[2] == 'AIPlayer',
    'opponent is not the learned combat AIPlayer', result);
  check(JSON.stringify(result.playerOneUnits) == JSON.stringify(requiredUnitTypes),
    'human side does not include every required combat unit type', result);
  check(JSON.stringify(result.playerTwoUnits) == JSON.stringify(requiredUnitTypes),
    'AI side does not include every required combat unit type', result);
  check(result.playerOneTownCount == 0 && result.playerTwoTownCount == 0,
    'play AI combat map should not include towns', result);
  check(result.goldmineCount == 0 && result.externalCount == 0 &&
      result.externalProductionCount == 0,
    'play AI combat map should not include economy objects', result);

  console.log(JSON.stringify({
    status: 'passed',
    loadedScriptCount: scriptPaths.length,
    loadedModelSource: browser.getLoadedModelSource(),
    game: result
  }, null, 2));
})().catch(error => {
  console.error(error.stack || error.message);
  if (error.details) {
    console.error(JSON.stringify(error.details, null, 2));
  }
  process.exitCode = 1;
});
