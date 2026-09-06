const path = require('path');
const tf = require('@tensorflow/tfjs-node');
const {
  createPredictor,
  createRuntimeContext,
  loadBrowserScripts,
  loadCheckpoint
} = require('./benchmark-gamestart-trained-model');
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

const CHECKPOINT =
  process.env.DIPLOMACY_ECONOMY_CHECKPOINT ||
  '/mnt/storage/diplomacy/checkpoints/task045-replay-corrected/step-00000005';

function runScenario(group, seed, model, inference) {
  const mapEntry = firstMapForGroup(group);
  const predictor = createPredictor(model, inference);
  const context = createRuntimeContext(seed, predictor, model);
  loadBrowserScripts(context);
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
    whooseTurn = 1
    let candidateVector = vectoriseGrid()[0]
    let candidateUnit = candidate.units.filter(function(unit) {
      return !unit.killed
    })[0]
    let candidateOwnedCell = candidateUnit.coord
    let candidateOwnership = candidateVector[candidateOwnedCell.x][candidateOwnedCell.y][
      CELL_VECTOR_INDEX.unitOwner]
    whooseTurn = 2
    let opponentOwnership = vectoriseGrid()[0][candidateOwnedCell.x][candidateOwnedCell.y][
      CELL_VECTOR_INDEX.unitOwner]
    whooseTurn = 1
    let strongestGoldBefore = vectoriseGrid()[0][0][0][
      CELL_VECTOR_INDEX.strongestOpponentGold]
    let lastOpponent = players[players.length - 1]
    let lastOpponentGold = lastOpponent.gold
    lastOpponent.gold = Math.max.apply(null, players.slice(1).map(function(player) {
      return player.gold
    })) + 1000
    let strongestGoldAfter = vectoriseGrid()[0][0][0][
      CELL_VECTOR_INDEX.strongestOpponentGold]
    lastOpponent.gold = lastOpponentGold
    whooseTurn = 0
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
      scoreFingerprint: candidate.winningChances.slice(0, 8),
      candidateRelativeOwnership: {
        candidate: candidateOwnership,
        opponent: opponentOwnership
      },
      allOpponentAggregation: {
        strongestGoldBefore: strongestGoldBefore,
        strongestGoldAfter: strongestGoldAfter,
        changedByLastOpponent: strongestGoldAfter > strongestGoldBefore
      }
    }
  })()`, { filename: 'task059-ai-economy-multiplayer.js' })
    .runInContext(context);
}

function inferenceStats() {
  return {
    calls: 0,
    positions: 0,
    resizedInputs: 0,
    channelAdaptations: 0,
    modelProbe: null
  };
}

function assertScenario(result, scenario, inference) {
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
  check(result.chosenGrids > 0 && result.winningChances > 0 && inference.calls > 0,
    scenario.group + ' turn did not use model-backed AIPlayerWithEconomy inference',
    result);
  check(inference.calls > 0 && inference.positions > 0,
    scenario.group + ' did not use checkpoint-backed inference', inference);
  check(result.candidateRelativeOwnership.candidate === 1 &&
      result.candidateRelativeOwnership.opponent === -1,
    scenario.group + ' ownership features are not candidate-relative', result);
  check(result.allOpponentAggregation.changedByLastOpponent,
    scenario.group + ' vector aggregation ignored the last opponent', result);
}

function scoresDiffer(left, right) {
  return left.length === right.length && left.some(function(value, index) {
    return Math.abs(value - right[index]) > 1e-7;
  });
}

async function main() {
  let missingCheckpointRejected = false;
  try {
    await loadCheckpoint(path.join(__dirname, 'missing-task059-checkpoint'));
  } catch (error) {
    missingCheckpointRejected = /checkpoint model is missing/.test(error.message);
  }
  check(missingCheckpointRejected, 'missing-checkpoint control was not rejected');

  const checkpoint = await loadCheckpoint(CHECKPOINT);
  const originalWeights = checkpoint.model.getWeights();
  try {
    const scenarios = [
      { group: '1v1', seed: 59002, expectedOpponents: [2] },
      { group: '3-player', seed: 59003, expectedOpponents: [2, 3] },
      { group: '4-player', seed: 59004, expectedOpponents: [2, 3, 4] }
    ];
    const realResults = [];
    for (const scenario of scenarios) {
      const inference = inferenceStats();
      const result = runScenario(
        scenario.group, scenario.seed, checkpoint.model, inference);
      result.inference = inference;
      assertScenario(result, scenario, inference);
      realResults.push(result);
    }

    const zeroWeights = originalWeights.map(weight => tf.zeros(weight.shape));
    checkpoint.model.setWeights(zeroWeights);
    zeroWeights.forEach(weight => weight.dispose());
    const zeroInference = inferenceStats();
    const zeroResult = runScenario(
      '4-player', 59004, checkpoint.model, zeroInference);

    const randomWeights = originalWeights.map(function(weight, index) {
      return tf.randomNormal(weight.shape, 0, 0.05, 'float32', 59040 + index);
    });
    checkpoint.model.setWeights(randomWeights);
    randomWeights.forEach(weight => weight.dispose());
    const randomInference = inferenceStats();
    const randomResult = runScenario(
      '4-player', 59004, checkpoint.model, randomInference);

    const realFourPlayer = realResults[2];
    check(scoresDiffer(realFourPlayer.scoreFingerprint, zeroResult.scoreFingerprint),
      'real checkpoint scores did not differ from zeroed-model control');
    check(scoresDiffer(realFourPlayer.scoreFingerprint, randomResult.scoreFingerprint),
      'real checkpoint scores did not differ from randomized-model control');

    const trainingSeeds = checkpoint.report.trainingEvidence &&
      checkpoint.report.trainingEvidence.losses ?
      checkpoint.report.trainingEvidence.losses.map(loss => loss.seed) : [];
    const testSeeds = scenarios.map(scenario => scenario.seed);
    console.log(JSON.stringify({
      checkpoint: checkpoint.report,
      seeds: testSeeds,
      trainingSeeds,
      validationSeeds: [],
      testSeeds,
      seedIntersections: {
        trainingValidation: [],
        trainingTest: trainingSeeds.filter(seed => testSeeds.includes(seed)),
        validationTest: []
      },
      controls: {
        missingCheckpointRejected,
        zeroedModelScoresDiffer: true,
        randomizedModelScoresDiffer: true,
        zeroedInference: zeroInference,
        randomizedInference: randomInference
      },
      scenarios: realResults
    }, null, 2));
    console.log('AIPlayerWithEconomy multiplayer real-checkpoint inference smoke passed');
  } finally {
    checkpoint.model.setWeights(originalWeights);
    checkpoint.model.dispose();
  }
}

main().catch(function(error) {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
