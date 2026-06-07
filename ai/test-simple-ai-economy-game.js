const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { runGame } = require('./benchmarkHarness');

const repoRoot = path.resolve(__dirname, '..');
const failurePath = path.join(
  repoRoot, 'artifacts', 'task-033', 'tiny-economy-ai-failure.json');

function assert(condition, message, state) {
  if (condition) {
    return;
  }
  fs.mkdirSync(path.dirname(failurePath), { recursive: true });
  fs.writeFileSync(failurePath, JSON.stringify(state, null, 2) + '\n');
  throw new Error(message + '; state saved to ' + failurePath);
}

function loadTinyGameMap() {
  const source = fs.readFileSync(
    path.join(repoRoot, 'options/gamestart.js'), 'utf8');
  const mapTableStart = source.indexOf('\nmaps = {');
  if (mapTableStart < 0) {
    throw new Error('options/gamestart.js map table boundary not found');
  }
  const context = vm.createContext({
    console,
    SimpleAiPlayer: class SimpleAiPlayer {},
    SimpleAiPlayerWithEconomy: class SimpleAiPlayerWithEconomy {},
    AIPlayer: class AIPlayer {},
    Player: class Player {}
  });
  new vm.Script(source.slice(0, mapTableStart), {
    filename: 'options/gamestart.js'
  }).runInContext(context);
  return new vm.Script('createTinyEconomyAiTestMap()', {
    filename: 'tiny-economy-ai-map.js'
  }).runInContext(context);
}

const gameMap = loadTinyGameMap();
const playerSettings = gameMap.players.slice(1);
const seed = 32032;
const result = runGame({
  gameMap,
  playerA: 'SimpleAiPlayerWithEconomy',
  playerB: 'SimpleAiPlayerWithEconomy',
  seed,
  roundLimit: gameMap.suddenDeathRound
});
const diagnostic = {
  seed,
  map: gameMap,
  result
};

assert(
  playerSettings.every(player =>
    player.playerType === 'SimpleAiPlayerWithEconomy'),
  'tiny map is not configured with two economy AI players',
  diagnostic
);
assert(
  gameMap.mapSize.x <= 9 && gameMap.mapSize.y <= 7,
  'economy AI scenario is not a tiny map',
  diagnostic
);
assert(
  gameMap.suddenDeathRound === 2000,
  'suddenDeathRound is not 2000',
  diagnostic
);
assert(
  result.runtimePlayerA === 'SimpleAiPlayerWithEconomy' &&
    result.runtimePlayerB === 'SimpleAiPlayerWithEconomy',
  'game runner did not instantiate both economy AI classes',
  diagnostic
);
assert(result.winnerSide !== null, 'game ended without a winner', diagnostic);
assert(!result.timeout, 'game reached the round limit', diagnostic);
assert(!result.suddenDeath, 'game reached sudden death', diagnostic);
assert(
  result.roundCount < gameMap.suddenDeathRound,
  'game did not end before round 2000',
  diagnostic
);

console.log(
  'Economy AI tiny game passed: winner ' + result.winnerSide +
  ' in round ' + result.roundCount + ' before sudden death');
