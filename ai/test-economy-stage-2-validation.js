const { loadAiScripts } = require('./smokeHarness');
const { runCheckpointSmoke } = require('./tests/checkpoint-smoke.cjs');

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? '\n' + JSON.stringify(details, null, 2) : '';
    throw new Error(message + suffix);
  }
}

function unitTypeName(unit) {
  return unit.type && unit.type.name ? unit.type.name : String(unit.type);
}

function selectedBuildings(player, buildingType) {
  return buildingType === 'tower' ? (player.towers || []) : (player.bastions || []);
}

function unselectedBuildings(player, buildingType) {
  return buildingType === 'tower' ? (player.bastions || []) : (player.towers || []);
}

function normalizedMap(map) {
  return JSON.stringify({
    mapSize: map.mapSize,
    suddenDeathRound: map.suddenDeathRound,
    economyStage: map.economyStage,
    economyGenerator: map.economyGenerator,
    economyObjects: map.economyObjects,
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
    goldmines: map.goldmines || [],
    lakes: map.lakes || [],
    mountains: map.mountains || []
  });
}

function validateStage2Map(map, stage1Map, seed) {
  assert(map.mapSize.x > stage1Map.mapSize.x && map.mapSize.y > stage1Map.mapSize.y,
    'stage 2 validation expected dimensions larger than stage 1',
    { seed, stage1: stage1Map.mapSize, stage2: map.mapSize });
  assert(map.mapSize.x === 9 && map.mapSize.y === 7,
    'stage 2 validation expected the documented 9x7 dimensions',
    { seed, mapSize: map.mapSize });
  assert(map.players.length === 3,
    'stage 2 validation expected neutral plus two players',
    { seed, players: map.players.length });
  assert(map.players[1].playerType === 'AIPlayerWithEconomy',
    'stage 2 player 1 should be the learned economy AI',
    { seed, playerType: map.players[1].playerType });
  assert(map.players[2].playerType === 'SimpleAiPlayerWithEconomy',
    'stage 2 player 2 should be the simple economy baseline',
    { seed, playerType: map.players[2].playerType });

  const metadata = map.economyGenerator;
  assert(map.economyStage === 2 && metadata && metadata.stage === 2,
    'stage 2 validation requires stage 2 economy generator metadata',
    { seed, economyStage: map.economyStage, metadata });
  assert(['tower', 'bastion'].includes(metadata.buildingType),
    'stage 2 validation expected a tower or bastion selection',
    { seed, metadata });
  assert(metadata.hpMin === 2 && metadata.hpMax === 5,
    'stage 2 validation expected documented HP bounds of 2-5',
    { seed, metadata });
  assert(metadata.hp >= metadata.hpMin && metadata.hp <= metadata.hpMax,
    'stage 2 validation found randomized HP outside the documented range',
    { seed, metadata });

  for (let playerIndex = 1; playerIndex <= 2; playerIndex += 1) {
    const player = map.players[playerIndex];
    assert((player.towns || []).length === 1,
      'stage 2 player should have exactly one town',
      { seed, playerIndex, towns: player.towns });
    assert((player.units || []).length === 2 &&
      player.units.every((unit) => unitTypeName(unit) === 'Noob'),
      'stage 2 player should keep a valid 1v1 noob setup',
      { seed, playerIndex, units: player.units });
    assert((player.suburbs || []).length === 1 && player.suburbs[0].cells.length > 1,
      'stage 2 player should have usable economy suburb access',
      { seed, playerIndex, suburbs: player.suburbs });

    const intended = selectedBuildings(player, metadata.buildingType);
    const unintended = unselectedBuildings(player, metadata.buildingType);
    assert(intended.length === 1,
      'stage 2 player should have exactly one selected defensive building',
      { seed, playerIndex, buildingType: metadata.buildingType, intended });
    assert(unintended.length === 0,
      'stage 2 player should not have the unselected defensive building type',
      { seed, playerIndex, buildingType: metadata.buildingType, unintended });
    assert(intended[0].hp === metadata.hp,
      'stage 2 building HP should match generator metadata',
      { seed, playerIndex, building: intended[0], metadata });
  }
}

const { context } = loadAiScripts();
const api = new Function('context', `return {
  generateEconomyStage1TrainingMap: context.generateEconomyStage1TrainingMap,
  generateEconomyStage2TrainingMap: context.generateEconomyStage2TrainingMap
};`)(context);

async function main() {
  assert(typeof api.generateEconomyStage1TrainingMap === 'function',
    'generateEconomyStage1TrainingMap must be exported for stage-size comparison');
  assert(typeof api.generateEconomyStage2TrainingMap === 'function',
    'generateEconomyStage2TrainingMap must be exported');

  const stage1Map = api.generateEconomyStage1TrainingMap({ seed: 12100 });
  const seeds = [12100, 12101, 12102, 12103, 12104, 12105, 12106, 12107, 12108, 12109];
  const hpValues = new Set();
  const buildingTypes = new Set();

  for (const seed of seeds) {
    const map = api.generateEconomyStage2TrainingMap({ seed });
    validateStage2Map(map, stage1Map, seed);
    hpValues.add(map.economyGenerator.hp);
    buildingTypes.add(map.economyGenerator.buildingType);
  }

  assert(hpValues.size >= 2,
    'stage 2 validation should observe randomized HP across several seeds',
    { seeds, hpValues: Array.from(hpValues) });
  assert(buildingTypes.has('tower') && buildingTypes.has('bastion'),
    'stage 2 validation should observe both tower and bastion setups',
    { seeds, buildingTypes: Array.from(buildingTypes) });

  const replaySeed = seeds[4];
  const first = api.generateEconomyStage2TrainingMap({ seed: replaySeed });
  const second = api.generateEconomyStage2TrainingMap({ seed: replaySeed });
  assert(normalizedMap(first) === normalizedMap(second),
    'stage 2 validation expected deterministic replay for seed ' + replaySeed);

  const harnessMap = api.generateEconomyStage2TrainingMap({
    seed: replaySeed,
    suddenDeathRound: 12
  });
  const result = await runCheckpointSmoke({
    gameMap: harnessMap,
    playerA: 'AIPlayerWithEconomy',
    playerB: 'SimpleAiPlayerWithEconomy',
    seed: replaySeed,
    roundLimit: 4,
    actionLimit: 3,
    commandLimit: 20
  }, process.env.AI_MAP_SMOKE_CHECKPOINT);

  assert(!result.crash, 'benchmark harness initialization crashed', result);
  assert(result.runtimePlayerA === 'AIPlayerWithEconomy',
    'benchmark harness did not instantiate AIPlayerWithEconomy', result);
  assert(result.runtimePlayerB === 'SimpleAiPlayerWithEconomy',
    'benchmark harness did not instantiate SimpleAiPlayerWithEconomy', result);
  assert(result.turnCount > 0,
    'benchmark harness did not advance the stage 2 validation game', result);

  console.log('Economy stage 2 validation test passed');

}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
