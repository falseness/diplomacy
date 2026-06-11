const {
  createRuntimeContext,
  disableHeadlessBorderDrawing,
  loadBrowserScripts
} = require('./gamestart-simple-economy-completion');
const {
  enumerateGamestartMapCoverage
} = require('./gamestart-map-coverage');

function check(condition, message, details) {
  if (!condition) {
    const suffix = details ? '\n' + JSON.stringify(details, null, 2) : '';
    throw new Error(message + suffix);
  }
}

function firstMapForGroup(group) {
  const coverage = enumerateGamestartMapCoverage();
  const map = coverage.maps.find(candidate => candidate.playerGroup === group);
  check(map, 'missing gamestart map group ' + group);
  return map;
}

function runScenario(group, seed) {
  const mapEntry = firstMapForGroup(group);
  const context = createRuntimeContext(seed);
  loadBrowserScripts(context);
  disableHeadlessBorderDrawing(context);
  context.__task059MapEntry = mapEntry;
  context.__task059Seed = seed;
  const vm = require('vm');
  return new vm.Script(`(() => {
    isFogOfWar = false
    gameSettings.testAI = true
    gameSettings.isOnline = false
    gameSettings.aiActionLimit = 3
    gameSettings.aiCommandLimit = 24
    entityInterface = {change() {}, hide() {}}
    townInterface = {change() {}, hide() {}}
    barrackInterface = {change() {}, hide() {}}
    statisticsInterface = {}
    gameEvent = {
      nextTurn() {},
      selected: new Empty(),
      hideAll() {},
      removeSelection() { this.selected = new Empty() },
      screen: {moveTo() {}, moveToPlayer() {}, stop() {}}
    }
    nextTurnButton = {
      setNextPlayerColor() {},
      highlightButton: false,
      enableClick() {},
      disableClick() {}
    }
    nextTurnPauseInterface = {visible: false}
    saveManager = {save() {}}
    AiRuntime.trainFromHumanCommands = function() {}
    ai_model = {}
    let predictCalls = 0
    predict = function(model, vectorisedGrids) {
      ++predictCalls
      return vectorisedGrids.map(function(vectorisedGrid, index) {
        return [0.5 + index / Math.max(1, vectorisedGrids.length * 100)]
      })
    }
    border = new Border()
    attackBorder = new Border()
    let manager = {
      clearValues() {
        external = []
        externalProduction = []
        nature = []
        goldmines = []
        gameRound = 0
        gameExit = false
      }
    }
    let map = __task059MapEntry.sourceType == 'standalone-factory' ?
      globalThis[__task059MapEntry.sourceName]() :
      maps[__task059MapEntry.groupName][__task059MapEntry.variantIndex]
    for (let index = 1; index < map.players.length; ++index) {
      map.players[index].playerType =
        index == 1 ? 'AIPlayerWithEconomy' : 'SimpleAiPlayerWithEconomy'
    }
    map.suddenDeathRound = 500
    map.start(manager, false)
    suddenDeathRound = 500
    whooseTurn = 0
    let candidate = players[1]
    let actionTargets = candidate.getEnemyTargetsForActionRanking()
    let movementTargets = candidate.getEnemyTargetsForMovement()
    let commandsBeforeTurn = candidate.getActionCommands()
    nextTurn()
    return {
      mapName: __task059MapEntry.name,
      group: ${JSON.stringify(group)},
      playerCount: __task059MapEntry.nonNeutralPlayerCount,
      runtimePlayers: players.slice(1).map(function(player) {
        return player.constructor.name
      }),
      candidateIsAiPlayerWithEconomy: candidate instanceof AIPlayerWithEconomy,
      opponentIndexesFromActionRanking: Array.from(new Set(actionTargets.map(function(target) {
        return target.opponentIndex
      }))).sort(),
      opponentIndexesFromMovement: Array.from(new Set(movementTargets
        .filter(function(target) { return target.kind != 'neutralTown' })
        .map(function(target) { return target.opponentIndex }))).sort(),
      actionTargetKinds: Array.from(new Set(actionTargets.map(function(target) {
        return target.kind
      }))).sort(),
      movementTargetKinds: Array.from(new Set(movementTargets.map(function(target) {
        return target.kind
      }))).sort(),
      commandsBeforeTurn: commandsBeforeTurn.length,
      chosenGrids: candidate.chosenGrids.length,
      winningChances: candidate.winningChances.length,
      predictCalls
    }
  })()`, { filename: 'task059-ai-economy-multiplayer.js' })
    .runInContext(context);
}

for (const scenario of [
  { group: '3-player', seed: 59003, expectedOpponents: [2, 3] },
  { group: '4-player', seed: 59004, expectedOpponents: [2, 3, 4] }
]) {
  const result = runScenario(scenario.group, scenario.seed);
  check(result.candidateIsAiPlayerWithEconomy,
    scenario.group + ' did not instantiate AIPlayerWithEconomy', result);
  check(result.runtimePlayers[0] === 'AIPlayerWithEconomy',
    scenario.group + ' candidate used wrong runtime class', result);
  check(result.runtimePlayers.slice(1).every(name => name === 'SimpleAiPlayerWithEconomy'),
    scenario.group + ' opponents used wrong runtime classes', result);
  check(result.commandsBeforeTurn > 0,
    scenario.group + ' did not enumerate legal actions', result);
  for (const opponent of scenario.expectedOpponents) {
    check(result.opponentIndexesFromActionRanking.includes(opponent),
      scenario.group + ' action ranking ignored opponent ' + opponent, result);
    check(result.opponentIndexesFromMovement.includes(opponent),
      scenario.group + ' movement targeting ignored opponent ' + opponent, result);
  }
  check(result.chosenGrids > 0 && result.winningChances > 0 && result.predictCalls > 0,
    scenario.group + ' turn did not use model-backed AIPlayerWithEconomy inference',
    result);
}

console.log('AIPlayerWithEconomy multiplayer inference smoke passed');
