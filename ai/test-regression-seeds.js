const fs = require('fs');
const path = require('path');
const vm = require('vm');

const { loadAiScripts } = require('./smokeHarness');
const { createTrainingBatch, run: runEconomyTraining } = require('./economy-training');
const { runGame, writeResult } = require('./benchmarkHarness');

const repoRoot = path.resolve(__dirname, '..');
const failureRoot = path.join(repoRoot, 'artifacts', 'task-039');
const storageRoot = process.env.DIPLOMACY_STORAGE_DIR || '/mnt/storage/diplomacy';

function check(condition, message, detail) {
  if (!condition) {
    const error = new Error(message);
    error.detail = detail;
    throw error;
  }
}

function writeFailureArtifact(suite, seed, detail) {
  fs.mkdirSync(failureRoot, { recursive: true });
  const artifactPath = path.join(failureRoot, `${suite}-seed-${seed}.json`);
  fs.writeFileSync(artifactPath, `${JSON.stringify({
    suite,
    seed,
    detail
  }, null, 2)}\n`);
  return artifactPath;
}

function removeDirectory(directory) {
  if (fs.existsSync(directory)) {
    fs.rmdirSync(directory, { recursive: true });
  }
}

async function runSeededCase(suite, seed, fn) {
  try {
    return await fn(seed);
  } catch (error) {
    const artifactPath = writeFailureArtifact(suite, seed, {
      message: error.message,
      detail: error.detail || null,
      stack: error.stack
    });
    throw new Error(`${suite} seed ${seed} failed; state saved to ${artifactPath}: ${error.message}`);
  }
}

function serializeMap(map) {
  return {
    mapSize: map.mapSize,
    players: map.players.map(player => ({
      gold: player.gold || 0,
      towns: player.towns || [],
      suburbs: player.suburbs || [],
      units: (player.units || []).map(unit => ({
        type: unit.type && unit.type.name ? unit.type.name : String(unit.type),
        x: unit.x,
        y: unit.y
      })),
      barracks: player.barracks || [],
      pendingBarracks: player.pendingBarracks || [],
      farms: player.farms || [],
      pendingFarms: player.pendingFarms || [],
      walls: player.walls || [],
      bastions: player.bastions || [],
      towers: player.towers || []
    })),
    goldmines: map.goldmines || [],
    lakes: map.lakes || [],
    mountains: map.mountains || []
  };
}

function countPlayerFeatures(player) {
  return {
    towns: (player.towns || []).length,
    suburbs: (player.suburbs || []).reduce((total, layout) =>
      total + (layout.cells || []).length, 0),
    expansionCells: (player.suburbs || []).reduce((total, layout) =>
      total + (layout.expansionCells || []).length, 0),
    units: (player.units || []).length,
    barracks: (player.barracks || []).length,
    pendingBarracks: (player.pendingBarracks || []).length,
    farms: (player.farms || []).length,
    pendingFarms: (player.pendingFarms || []).length,
    walls: (player.walls || []).length,
    bastions: (player.bastions || []).length,
    towers: (player.towers || []).length
  };
}

async function runMapGenerationSuite() {
  const { context } = loadAiScripts();
  const api = new Function('context', `return {
    generateTownTrainingMap: context.generateTownTrainingMap
  };`)(context);
  const seeds = [39001, 39002, 39003, 39004, 39005, 39006];
  const coverage = {
    farms: 0,
    barracks: 0,
    externalBuildings: 0,
    goldmines: 0,
    suburbs: 0,
    expansionCells: 0,
    units: 0
  };

  for (const seed of seeds) {
    await runSeededCase('map-generation', seed, () => {
      const options = {
        size: seed % 2 === 0 ? 'big' : 'medium',
        seed,
        buildingDensity: 'dense',
        barrackDensity: 0.35,
        pendingBarrackProbability: seed % 2,
        farmDensity: 0.45,
        pendingFarmProbability: (seed + 1) % 2,
        externalDensity: 0.5,
        suburbDensity: 1,
        suburbDistance: 1,
        unitComposition: 'balanced',
        unitsPerPlayer: 2,
        goldmineCount: 6,
        startingGoldMin: 500,
        startingGoldMax: 500
      };
      const map = api.generateTownTrainingMap(options);
      const repeated = api.generateTownTrainingMap(options);
      const serialized = serializeMap(map);
      check(
        JSON.stringify(serialized) === JSON.stringify(serializeMap(repeated)),
        'seeded map generation is not reproducible',
        serialized
      );
      check(map.players.length === 3, 'generated map must include neutral plus two players', serialized);
      check(map.goldmines.length === 6, 'generated map missing fixed goldmine count', serialized);
      coverage.goldmines += map.goldmines.length;
      for (const playerIndex of [1, 2]) {
        const features = countPlayerFeatures(map.players[playerIndex]);
        check(features.towns > 0, 'generated map missing owned town', { playerIndex, features, serialized });
        check(features.suburbs > features.towns, 'generated map missing owned suburbs', { playerIndex, features, serialized });
        check(features.expansionCells > 0, 'generated map missing expansion choices', { playerIndex, features, serialized });
        check(features.units === 2, 'generated map missing configured unit count', { playerIndex, features, serialized });
        coverage.suburbs += features.suburbs;
        coverage.expansionCells += features.expansionCells;
        coverage.units += features.units;
        coverage.farms += features.farms + features.pendingFarms;
        coverage.barracks += features.barracks + features.pendingBarracks;
        coverage.externalBuildings += features.walls + features.bastions + features.towers;
      }
    });
  }
  for (const [feature, count] of Object.entries(coverage)) {
    check(count > 0, `map generation seed suite did not cover ${feature}`, coverage);
  }
  console.log(`Map generation regression seeds passed (${seeds.join(', ')})`);
}

function runVectorScenario(context, seed) {
  return new vm.Script(`
(() => {
  function assert(condition, message) {
    if (!condition) throw new Error(message)
  }
  function emptyUnit() {
    return { isEmpty() { return true }, isMyTurn: false }
  }
  function emptyBuilding() {
    return { isEmpty() { return true }, isTown() { return false } }
  }
  function makeCell(building, unit, owner, suburb) {
    return {
      coord: {x: 0, y: 0},
      building: building || emptyBuilding(),
      unit: unit || emptyUnit(),
      playerColor: owner || 0,
      hexagon: { isSuburb: !!suburb }
    }
  }
  function completeBuilding(name, owner) {
    return {
      name,
      playerColor: owner,
      hp: name == 'town' ? 10 : 5,
      maxHP: name == 'town' ? 10 : 5,
      income: name == 'farm' ? 4 : (name == 'barrack' ? -2 : 0),
      potentialIncome: name == 'goldmine' ? 80 : 0,
      rangeIncrease: name == 'tower' ? 1 : 0,
      isEmpty() { return false },
      isTown() { return name == 'town' },
      isBuildingProduction() { return false },
      isObstacle(color) { return name == 'wall' && color == owner },
      isBarrier() { return name == 'wall' || name == 'bastion' || name == 'tower' },
      get income() { return name == 'goldmine' ? 80 : (name == 'farm' ? 4 : (name == 'barrack' ? -2 : 0)) },
      activeProduction: { notEmpty() { return false } },
      buildingProduction: [],
      suburbs: [{isSuburb: true, playerColor: owner}, {isSuburb: true, playerColor: owner}]
    }
  }
  function pendingBuilding(name, owner) {
    return {
      name,
      playerColor: owner,
      turns: 3,
      isEmpty() { return false },
      isTown() { return false },
      isBuildingProduction() { return true }
    }
  }
  function unit(name, owner) {
    let stats = {
      noob: [1, 2, 1, 1, 2, 2, 0],
      archer: [2, 2, 2, 2, 1, 1, 0],
      KOHb: [3, 4, 1, 1, 2, 3, 0],
      normchel: [1, 2, 1, 1, 4, 5, 0],
      catapult: [2, 2, 0, 5, 1, 1, 4]
    }[name]
    return {
      name,
      playerColor: owner,
      moves: stats[0],
      speed: stats[1],
      dmg: stats[2],
      range: stats[3],
      hp: stats[4],
      maxHP: stats[5],
      buildingDMG: stats[6],
      killed: false,
      isEmpty() { return false },
      isMyTurn: owner == whooseTurn
    }
  }

  whooseTurn = ${seed % 2 ? 1 : 2}
  players = [
    {gold: 0, income: 0, towns: []},
    {gold: 300, income: 24, towns: []},
    {gold: 120, income: 10, towns: []}
  ]
  suddenDeathRound = 2000
  gameRound = 10

  let town = completeBuilding('town', whooseTurn)
  players[whooseTurn].towns = [town]
  let vectors = {
    town: vectorizeCell(makeCell(town, null, whooseTurn)),
    barrack: vectorizeCell(makeCell(completeBuilding('barrack', whooseTurn), null, whooseTurn)),
    pendingBarrack: vectorizeCell(makeCell(pendingBuilding('barrack', whooseTurn), null, whooseTurn)),
    farm: vectorizeCell(makeCell(completeBuilding('farm', whooseTurn), null, whooseTurn)),
    pendingFarm: vectorizeCell(makeCell(pendingBuilding('farm', whooseTurn), null, whooseTurn)),
    goldmine: vectorizeCell(makeCell(completeBuilding('goldmine', whooseTurn), null, whooseTurn)),
    wall: vectorizeCell(makeCell(completeBuilding('wall', whooseTurn), null, whooseTurn)),
    bastion: vectorizeCell(makeCell(completeBuilding('bastion', whooseTurn), null, whooseTurn)),
    tower: vectorizeCell(makeCell(completeBuilding('tower', whooseTurn), null, whooseTurn)),
    pendingWall: vectorizeCell(makeCell(pendingBuilding('wall', whooseTurn), null, whooseTurn)),
    suburb: vectorizeCell(makeCell(null, null, whooseTurn, true)),
    enemyTown: vectorizeCell(makeCell(completeBuilding('town', whooseTurn == 1 ? 2 : 1), null, whooseTurn == 1 ? 2 : 1))
  }
  let units = ['noob', 'archer', 'KOHb', 'normchel', 'catapult'].map((name, index) =>
    vectorizeCell(makeCell(null, unit(name, whooseTurn), whooseTurn))[CELL_VECTOR_INDEX.unitTypeStart + index])

  assert(vectors.town[CELL_VECTOR_INDEX.isTown] == 1, 'town channel missing')
  assert(vectors.enemyTown[CELL_VECTOR_INDEX.townOwner] == -1, 'relative enemy town owner missing')
  assert(vectors.barrack[CELL_VECTOR_INDEX.isBarrack] == 1, 'barrack channel missing')
  assert(vectors.pendingBarrack[CELL_VECTOR_INDEX.isPendingBarrack] == 1, 'pending barrack channel missing')
  assert(vectors.farm[CELL_VECTOR_INDEX.isFarm] == 1, 'farm channel missing')
  assert(vectors.pendingFarm[CELL_VECTOR_INDEX.isPendingFarm] == 1, 'pending farm channel missing')
  assert(vectors.goldmine[CELL_VECTOR_INDEX.isGoldmine] == 1, 'goldmine channel missing')
  assert(vectors.goldmine[CELL_VECTOR_INDEX.goldminePotentialIncome] > 0, 'goldmine income channel missing')
  assert(vectors.wall[CELL_VECTOR_INDEX.isWall] == 1, 'wall channel missing')
  assert(vectors.bastion[CELL_VECTOR_INDEX.isBastion] == 1, 'bastion channel missing')
  assert(vectors.tower[CELL_VECTOR_INDEX.isTower] == 1, 'tower channel missing')
  assert(vectors.pendingWall[CELL_VECTOR_INDEX.isPendingWall] == 1, 'pending wall channel missing')
  assert(vectors.suburb[CELL_VECTOR_INDEX.isSuburb] == 1, 'suburb channel missing')
  assert(vectors.town[CELL_VECTOR_INDEX.currentPlayerGold] > 0,
    'current player gold channel missing')
  assert(vectors.town[CELL_VECTOR_INDEX.strongestOpponentGold] > 0,
    'opponent gold channel missing')
  assert(vectors.town[CELL_VECTOR_INDEX.relativeGoldAdvantage] != 0,
    'relative gold channel missing')
  assert(units.every(value => value == 1), 'one or more unit type channels missing: ' + units.join(','))
  return {
    seed: ${seed},
    whooseTurn,
    covered: Object.keys(vectors).concat(['noob', 'archer', 'KOHb', 'normchel', 'catapult'])
  }
})()
`, { filename: `task-039-vector-seed-${seed}.js` }).runInContext(context);
}

async function runVectorizationSuite() {
  const { context } = loadAiScripts();
  const seeds = [39101, 39102, 39103, 39104];
  for (const seed of seeds) {
    await runSeededCase('vectorization', seed, () => runVectorScenario(context, seed));
  }
  console.log(`Vectorization regression seeds passed (${seeds.join(', ')})`);
}

async function runAiTurnSuite() {
  const seeds = [39201, 39202, 39203];
  for (const seed of seeds) {
    await runSeededCase('ai-turn', seed, () => {
      const simple = runGame({
        mapName: 'tiny-duel',
        playerA: 'SimpleAiPlayerWithEconomy',
        playerB: 'SimpleAiPlayerWithEconomy',
        seed,
        roundLimit: 20
      });
      check(
        simple.runtimePlayerA === 'SimpleAiPlayerWithEconomy' &&
          simple.runtimePlayerB === 'SimpleAiPlayerWithEconomy',
        'SimpleAiPlayerWithEconomy turn suite used wrong players',
        simple
      );
      check(simple.roundCount > 0 && !simple.crash, 'SimpleAiPlayerWithEconomy turn suite did not advance', simple);

      const learned = createTrainingBatch(seed);
      check(
        learned.actionCounts['unit-command'] > 0 &&
          learned.actionCounts['unit-training'] > 0 &&
          learned.actionCounts['suburb-expansion'] > 0 &&
          learned.actionCounts['building-placement'] > 0,
        'AIPlayerWithEconomy turn suite did not apply every action category',
        learned
      );
      check(learned.appliedActions.length > 0, 'AIPlayerWithEconomy did not apply actions', learned);
      return { simple, learnedSummary: {
        actionCounts: learned.actionCounts,
        turnsPlayed: learned.turnsPlayed,
        examples: learned.labels.length
      }};
    });
  }
  const reportPath = path.join(storageRoot, 'benchmarks', 'task039-ai-turn-seeds.json');
  const report = {
    config: {
      mapName: 'tiny-duel',
      playerA: 'SimpleAiPlayerWithEconomy',
      playerB: 'SimpleAiPlayerWithEconomy',
      seed: seeds[0],
      repeat: seeds.length
    },
    games: seeds.map(seed => runGame({
      mapName: 'tiny-duel',
      playerA: 'SimpleAiPlayerWithEconomy',
      playerB: 'SimpleAiPlayerWithEconomy',
      seed,
      roundLimit: 20
    })),
    summary: { attemptedGames: seeds.length },
    failedSeeds: [],
    crashes: [],
    artifacts: {}
  };
  writeResult(report, reportPath);
  console.log(`AI turn regression seeds passed (${seeds.join(', ')}); report ${reportPath}`);
}

async function runTrainingSmokeSuite() {
  const seed = 39301;
  const runId = 'task039-regression-seed';
  const taskStorage = path.join(storageRoot, `task039-${process.pid}`);
  await runSeededCase('training-smoke', seed, async () => {
    removeDirectory(taskStorage);
    const result = await runEconomyTraining({
      storageDir: taskStorage,
      runId,
      games: 1,
      epochs: 1,
      seed,
      checkpointInterval: 1
    });
    const expectedPaths = [
      path.join(taskStorage, 'metrics', `${runId}.jsonl`),
      path.join(taskStorage, 'benchmarks', `${runId}.json`),
      path.join(taskStorage, 'checkpoints', runId, 'candidate.json'),
      path.join(taskStorage, 'checkpoints', runId, 'step-00000001', 'model.json'),
      path.join(taskStorage, 'final', runId, 'model.json'),
      path.join(taskStorage, 'runs', runId, 'manifest.json')
    ];
    for (const expectedPath of expectedPaths) {
      check(fs.existsSync(expectedPath), `expected training artifact missing: ${expectedPath}`, {
        result,
        expectedPaths
      });
    }
    check(result.metrics.length === 1, 'training smoke did not complete exactly one game', result);
    check(result.metrics[0].seed === seed, 'training smoke used an unexpected seed', result.metrics[0]);
    check(result.metrics[0].dataSource === 'real-runtime-self-play', 'training smoke used wrong data source', result.metrics[0]);
    return result;
  });
  removeDirectory(taskStorage);
  console.log(`Training smoke regression seed passed (${seed})`);
}

async function main() {
  const suite = process.argv[2] || 'all';
  const suites = {
    'map-generation': runMapGenerationSuite,
    vectorization: runVectorizationSuite,
    'ai-turn': runAiTurnSuite,
    'training-smoke': runTrainingSmokeSuite
  };
  if (suite === 'all') {
    for (const name of Object.keys(suites)) {
      await suites[name]();
    }
    return;
  }
  if (!suites[suite]) {
    throw new Error(`unknown regression seed suite "${suite}"`);
  }
  await suites[suite]();
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
