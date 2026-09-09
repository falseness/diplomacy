const { loadAiScripts } = require('./smokeHarness');
const { runGame } = require('./benchmarkHarness');

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? '\n' + JSON.stringify(details, null, 2) : '';
    throw new Error(message + suffix);
  }
}

function unitTypeName(unit) {
  return unit.type && unit.type.name ? unit.type.name : String(unit.type);
}

function normalizeStage1Map(map) {
  return JSON.stringify({
    mapSize: map.mapSize,
    suddenDeathRound: map.suddenDeathRound,
    economyGenerator: map.economyGenerator,
    players: map.players.map((player) => ({
      playerType: player.playerType,
      gold: player.gold,
      towns: player.towns || [],
      units: (player.units || []).map((unit) => ({
        type: unitTypeName(unit),
        x: unit.x,
        y: unit.y,
        hp: unit.hp
      })),
      suburbs: player.suburbs || [],
      towers: player.towers || [],
      bastions: player.bastions || []
    })),
    goldmines: map.goldmines,
    lakes: map.lakes,
    mountains: map.mountains
  });
}

function buildingList(player, type) {
  return type === 'tower' ? (player.towers || []) : (player.bastions || []);
}

function validateStage1Map(map, seed) {
  assert(map.mapSize.x === 7 && map.mapSize.y === 5,
    'stage 1 map is not the expected small 7x5 map', { seed, mapSize: map.mapSize });
  assert(map.players.length === 3,
    'stage 1 map should include neutral plus two players', { seed });
  assert(map.economyStage === 1, 'stage 1 map missing economyStage metadata', { seed });
  assert(map.economyGenerator && map.economyGenerator.stage === 1,
    'stage 1 map missing generator metadata', { seed });
  assert(map.economyGenerator.hpMin === 2 && map.economyGenerator.hpMax === 5,
    'stage 1 HP bounds changed without test update', map.economyGenerator);
  assert(map.economyGenerator.hp >= map.economyGenerator.hpMin &&
    map.economyGenerator.hp <= map.economyGenerator.hpMax,
    'stage 1 building HP is outside documented bounds', map.economyGenerator);
  assert(['tower', 'bastion'].includes(map.economyGenerator.buildingType),
    'stage 1 building type should be tower or bastion', map.economyGenerator);

  for (let playerIndex = 1; playerIndex <= 2; playerIndex += 1) {
    const player = map.players[playerIndex];
    assert(player.towns.length === 1,
      'stage 1 player should have exactly one town', { seed, playerIndex });
    assert(player.units.length === 2,
      'stage 1 player should have two noob units', { seed, playerIndex });
    assert(player.units.every((unit) => unitTypeName(unit) === 'Noob'),
      'stage 1 player has a non-Noob unit', { seed, playerIndex, units: player.units });
    assert(player.suburbs.length === 1 && player.suburbs[0].cells.length >= 4,
      'stage 1 player lacks economy suburb access', { seed, playerIndex });
    assert(player.playerType === (playerIndex === 1 ?
      'AIPlayerWithEconomy' : 'SimpleAiPlayerWithEconomy'),
      'stage 1 player class assignment changed', { seed, playerIndex, playerType: player.playerType });

    const expectedBuildings = buildingList(player, map.economyGenerator.buildingType);
    const unexpectedBuildings = buildingList(
      player,
      map.economyGenerator.buildingType === 'tower' ? 'bastion' : 'tower');
    assert(expectedBuildings.length === 1,
      'stage 1 player should have one selected defensive building',
      { seed, playerIndex, type: map.economyGenerator.buildingType });
    assert(unexpectedBuildings.length === 0,
      'stage 1 player should not have the unselected defensive building type',
      { seed, playerIndex, type: map.economyGenerator.buildingType });
    assert(expectedBuildings[0].hp === map.economyGenerator.hp,
      'stage 1 building HP does not match metadata',
      { seed, playerIndex, building: expectedBuildings[0], metadata: map.economyGenerator });
  }

  const left = map.players[1];
  const right = map.players[2];
  assert(left.towns[0].x === 1 && right.towns[0].x === 5,
    'stage 1 towns are not mirrored horizontally', { seed });
  assert(left.units[0].x + right.units[0].x === 6 &&
    left.units[1].x + right.units[1].x === 6,
    'stage 1 noob access is not mirrored', { seed, left: left.units, right: right.units });
  assert(buildingList(left, map.economyGenerator.buildingType)[0].x +
    buildingList(right, map.economyGenerator.buildingType)[0].x === 6,
    'stage 1 defensive building access is not mirrored', { seed });
}

const { context } = loadAiScripts();
const api = new Function('context', `return {
  generateEconomyStage1TrainingMap: context.generateEconomyStage1TrainingMap
};`)(context);

assert(api.generateEconomyStage1TrainingMap,
  'generateEconomyStage1TrainingMap is not exported to the AI script context');

const hpValues = new Set();
const buildingTypes = new Set();
for (let seed = 11800; seed < 11820; seed += 1) {
  const map = api.generateEconomyStage1TrainingMap({ seed });
  validateStage1Map(map, seed);
  hpValues.add(map.economyGenerator.hp);
  buildingTypes.add(map.economyGenerator.buildingType);

  const repeated = api.generateEconomyStage1TrainingMap({ seed });
  assert(normalizeStage1Map(map) === normalizeStage1Map(repeated),
    'stage 1 map generation is not deterministic for seed ' + seed);

  const runtime = map.start();
  assert(runtime.players[1].towers.length + runtime.players[1].bastions.length === 1,
    'stage 1 headless runtime did not create player 1 building');
  assert(runtime.players[2].towers.length + runtime.players[2].bastions.length === 1,
    'stage 1 headless runtime did not create player 2 building');
  map.advanceTurns(1);
  assert(runtime.turn === 1, 'stage 1 headless runtime did not advance');
}

assert(hpValues.size >= 2,
  'stage 1 tower/bastion HP did not vary across fixed seeds',
  { hpValues: Array.from(hpValues) });
assert(buildingTypes.size >= 2,
  'stage 1 did not produce both tower and bastion variants across fixed seeds',
  { buildingTypes: Array.from(buildingTypes) });

async function runGameplaySmoke() {
  // A caller-supplied checkpoint must match this unchanged map exactly. Never
  // restore the old harness's synthetic predictor or resize the smoke map.
  const checkpointPath = process.env.AI_STAGE1_SMOKE_CHECKPOINT;
  let checkpoint;
  let checkpointOptions = {};
  if (checkpointPath) {
    const { loadCheckpoint, createPredictor } = require('./benchmark-trained-model');
    checkpoint = await loadCheckpoint(checkpointPath);
    const predict = createPredictor(checkpoint.model, checkpoint.inference);
    checkpointOptions = {
      checkpointIdentifier: checkpointPath,
      predictFunction: (_model, vectors) => predict(checkpoint.model, vectors)
    };
    console.log('STAGE1_CHECKPOINT: ' + JSON.stringify(checkpoint.report));
  }
  try {
    const smokeMap = api.generateEconomyStage1TrainingMap({ seed: 11842, suddenDeathRound: 12 });
    const smokeResult = runGame({
      gameMap: smokeMap,
      playerA: 'AIPlayerWithEconomy',
      playerB: 'SimpleAiPlayerWithEconomy',
      seed: 11842,
      roundLimit: 4,
      actionLimit: 3,
      commandLimit: 20,
      ...checkpointOptions
    });

    assert(smokeResult.runtimePlayerA === 'AIPlayerWithEconomy',
      'short smoke did not run AIPlayerWithEconomy', smokeResult);
    assert(smokeResult.runtimePlayerB === 'SimpleAiPlayerWithEconomy',
      'short smoke did not run SimpleAiPlayerWithEconomy', smokeResult);
    assert(smokeResult.turnCount > 0 && !smokeResult.players.some((player) => player.type === undefined),
      'short smoke game did not run with runtime players', smokeResult);

    if (checkpoint) {
      assert(checkpoint.inference.calls > 0 && checkpoint.inference.positions > 0,
        'stage 1 checkpoint did not score runtime candidates', checkpoint.inference);
      console.log('STAGE1_INFERENCE: ' + JSON.stringify(checkpoint.inference));
    }
    console.log('Economy stage 1 map generation smoke passed');
  } finally {
    if (checkpoint) checkpoint.model.dispose();
  }
}

runGameplaySmoke().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
