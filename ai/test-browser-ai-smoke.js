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
  `browser AI smoke requires Node.js 20 or newer for jsdom 24; found ${process.version}`);

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

function createBrowserSmokeDom() {
  const dom = new JSDOM(
    '<!doctype html><html><body>' +
      '<canvas id="canvas"></canvas><canvas id="interface"></canvas>' +
    '</body></html>',
    {
      url: 'http://localhost/?aiModelUrl=models/smoke/model.json',
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

  let predictionCalls = 0;
  let loadedModelSource;
  function tensor(value) {
    return {
      value,
      dispose() {}
    };
  }
  window.__browserSmokeModel = {
    inputs: [{ shape: [null, null, null, 78] }],
    predict(inputs) {
      predictionCalls += 1;
      return {
        arraySync() {
          return inputs[0].values.map((unused, index) => [0.1 + index / 1000]);
        },
        dispose() {}
      };
    }
  };
  window.tf = {
    async loadLayersModel(source) {
      loadedModelSource = source;
      return window.__browserSmokeModel;
    },
    tensor3d: tensor,
    tensor,
    stack(values) {
      return {
        values,
        dispose() {}
      };
    },
    tidy(callback) {
      return callback();
    }
  };

  return {
    dom,
    getModelEvidence() {
      return {
        loadedModelSource,
        predictionCalls
      };
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

async function runTinyAiGame(context) {
  return await vm.runInContext(`(async function runBrowserAiSmoke() {
    gameSettings.aiModelUrl = 'models/smoke/model.json';
    ai_model = await loadModel();

    border = new Border();
    attackBorder = new Border();
    entityInterface = { visible: false, change() {} };
    nextTurnButton = { highlightButton: false, setNextPlayerColor() {} };
    nextTurnPauseInterface = { visible: false };
    gameEvent = {
      selected: undefined,
      screen: { stop() {}, moveToPlayer() {} },
      hideAll() {},
      nextTurn() {}
    };
    saveManager = { save() {} };
    menu = { visible: false };
    mainCtx = document.getElementById('canvas').getContext('2d');

    const map = new GameMap(
      { x: 9, y: 7 },
      [
        {
          rgb: { r: 208, g: 208, b: 208 },
          towns: []
        },
        {
          rgb: { r: 255, g: 0, b: 0 },
          playerType: 'AIPlayerWithEconomy',
          gold: 200,
          towns: [{ x: 1, y: 3 }],
          units: [{ x: 2, y: 3 }],
          suburbs: [{
            town: { x: 1, y: 3 },
            cells: [{ x: 1, y: 3 }, { x: 1, y: 2 }, { x: 1, y: 4 }],
            expansionCells: [{ x: 2, y: 2 }]
          }],
          barracks: [{ x: 1, y: 2, town: { x: 1, y: 3 } }]
        },
        {
          rgb: { r: 98, g: 168, b: 222 },
          playerType: 'SimpleAiPlayerWithEconomy',
          gold: 90,
          towns: [{ x: 7, y: 3 }],
          units: [{ x: 6, y: 3 }]
        }
      ],
      [],
      [],
      []
    );

    map.start({
      clearValues() {
        external = [];
        externalProduction = [];
        nature = [];
        goldmines = [];
        gameRound = 0;
      }
    }, false);

    whooseTurn = 1;
    gameSettings.testAI = false;
    isFogOfWar = false;

    for (const unit of players[1].units) {
      unit.moves = 0;
    }

    const learned = players[1];
    const beforeGold = learned.gold;
    const beforeVectors = learned.chosenGrids.length;
    const commands = learned.getActionCommands();
    learned.doActions();

    return {
      playerClass: learned.constructor.name,
      opponentClass: players[2].constructor.name,
      playerIsAiPlayerWithEconomy: learned instanceof AIPlayerWithEconomy,
      commandCount: commands.length,
      categories: Array.from(new Set(commands.map(command =>
        command.type == 'economy' ? command.category : 'unit-command'))),
      beforeGold,
      afterGold: learned.gold,
      chosenGridDelta: learned.chosenGrids.length - beforeVectors,
      winningChanceCount: learned.winningChances.length,
      townCount: learned.towns.length,
      unitCount: learned.units.length
    };
  })()`, context);
}

(async function main() {
  const html = readRepoFile('index.html');
  const scriptPaths = getLocalBrowserScripts(html);
  check(scriptPaths.length > 0, 'index.html did not expose local browser scripts');
  check(scriptPaths.includes('ai/players.js'),
    'index.html browser script path does not include ai/players.js');
  check(!scriptPaths.some(scriptPath => scriptPath.includes('benchmark')),
    'browser entrypoint loaded benchmark-only scripts', scriptPaths);

  const browser = createBrowserSmokeDom();
  const context = loadIndexScripts(browser.dom, scriptPaths);
  const gameEvidence = await runTinyAiGame(context);
  const modelEvidence = browser.getModelEvidence();

  check(gameEvidence.playerClass == 'AIPlayerWithEconomy',
    'tiny game did not select AIPlayerWithEconomy', gameEvidence);
  check(gameEvidence.playerIsAiPlayerWithEconomy,
    'selected player is not an AIPlayerWithEconomy instance', gameEvidence);
  check(gameEvidence.opponentClass == 'SimpleAiPlayerWithEconomy',
    'smoke opponent did not use the configured runtime class', gameEvidence);
  check(gameEvidence.commandCount > 0,
    'AIPlayerWithEconomy did not enumerate any legal action', gameEvidence);
  check(gameEvidence.categories.length > 0,
    'AIPlayerWithEconomy did not record legal action categories', gameEvidence);
  check(modelEvidence.loadedModelSource == 'models/smoke/model.json',
    'browser smoke did not load the configured browser-safe model URL',
    modelEvidence);
  check(modelEvidence.predictionCalls > 0,
    'AIPlayerWithEconomy did not call the browser model prediction path',
    modelEvidence);
  check(gameEvidence.chosenGridDelta > 0 && gameEvidence.winningChanceCount > 0,
    'AIPlayerWithEconomy did not record model-backed action evidence',
    gameEvidence);
  check(gameEvidence.afterGold < gameEvidence.beforeGold,
    'AIPlayerWithEconomy did not apply a legal economy action', gameEvidence);

  console.log(JSON.stringify({
    status: 'passed',
    loadedScriptCount: scriptPaths.length,
    model: modelEvidence,
    game: gameEvidence
  }, null, 2));
})().catch(error => {
  console.error(error.stack || error.message);
  if (error.details) {
    console.error(JSON.stringify(error.details, null, 2));
  }
  process.exitCode = 1;
});
