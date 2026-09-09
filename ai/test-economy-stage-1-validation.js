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

function validateStage1Map(map, seed) {
  assert(map.mapSize.x === 7 && map.mapSize.y === 5,
    'stage 1 validation expected a small 7x5 map', { seed, mapSize: map.mapSize });
  assert(map.players.length === 3,
    'stage 1 validation expected neutral plus two players', { seed, players: map.players.length });
  assert(map.players[1].playerType === 'AIPlayerWithEconomy',
    'player 1 should be the learned economy AI', { seed, playerType: map.players[1].playerType });
  assert(map.players[2].playerType === 'SimpleAiPlayerWithEconomy',
    'player 2 should be the simple economy baseline', { seed, playerType: map.players[2].playerType });

  const metadata = map.economyGenerator;
  assert(metadata && metadata.stage === 1,
    'stage 1 validation requires economy generator metadata', { seed, metadata });
  assert(['tower', 'bastion'].includes(metadata.buildingType),
    'stage 1 should select only tower or bastion', { seed, metadata });
  assert(metadata.hpMin === 2 && metadata.hpMax === 5,
    'stage 1 HP bounds should remain 2-5', { seed, metadata });
  assert(metadata.hp >= metadata.hpMin && metadata.hp <= metadata.hpMax,
    'stage 1 randomized HP is outside the documented range', { seed, metadata });

  for (let playerIndex = 1; playerIndex <= 2; playerIndex += 1) {
    const player = map.players[playerIndex];
    assert((player.towns || []).length === 1,
      'stage 1 player should have exactly one town', { seed, playerIndex });
    assert((player.units || []).length === 2,
      'stage 1 player should have exactly two units', { seed, playerIndex, units: player.units });
    assert(player.units.every((unit) => unitTypeName(unit) === 'Noob'),
      'stage 1 units should all be Noobs', { seed, playerIndex, units: player.units });

    const intended = selectedBuildings(player, metadata.buildingType);
    const unintended = unselectedBuildings(player, metadata.buildingType);
    assert(intended.length === 1,
      'stage 1 player should have exactly one selected defensive building',
      { seed, playerIndex, buildingType: metadata.buildingType, intended });
    assert(unintended.length === 0,
      'stage 1 player should not have the unselected defensive building type',
      { seed, playerIndex, buildingType: metadata.buildingType, unintended });
    assert(intended[0].hp === metadata.hp,
      'stage 1 building HP should match generator metadata',
      { seed, playerIndex, building: intended[0], metadata });
  }

  const left = map.players[1];
  const right = map.players[2];
  assert(left.towns[0].x + right.towns[0].x === 6 && left.towns[0].y === right.towns[0].y,
    'stage 1 towns should be mirrored across the 7x5 map', { seed, left: left.towns, right: right.towns });
  assert(map.economyObjects.towers + map.economyObjects.bastions === 2,
    'stage 1 economy object summary should record exactly two defensive buildings',
    { seed, economyObjects: map.economyObjects });
}

const { context } = loadAiScripts();
const api = new Function('context', `return {
  generateEconomyStage1TrainingMap: context.generateEconomyStage1TrainingMap
};`)(context);

async function main() {
  assert(typeof api.generateEconomyStage1TrainingMap === 'function',
    'generateEconomyStage1TrainingMap must be exported');

  const seeds = [11900, 11901, 11902, 11903, 11904, 11905, 11906, 11907];
  const hpValues = new Set();
  const buildingTypes = new Set();

  for (const seed of seeds) {
    const map = api.generateEconomyStage1TrainingMap({ seed });
    validateStage1Map(map, seed);
    hpValues.add(map.economyGenerator.hp);
    buildingTypes.add(map.economyGenerator.buildingType);
  }

  assert(hpValues.size >= 2,
    'stage 1 validation should observe randomized HP across fixed seeds',
    { seeds, hpValues: Array.from(hpValues) });
  assert(buildingTypes.has('tower') && buildingTypes.has('bastion'),
    'stage 1 validation should observe both tower and bastion setups',
    { seeds, buildingTypes: Array.from(buildingTypes) });

  const replaySeed = seeds[3];
  const first = api.generateEconomyStage1TrainingMap({ seed: replaySeed });
  const second = api.generateEconomyStage1TrainingMap({ seed: replaySeed });
  assert(normalizedMap(first) === normalizedMap(second),
    'stage 1 validation expected deterministic replay for seed ' + replaySeed);

  const harnessMap = api.generateEconomyStage1TrainingMap({
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
    'benchmark harness did not advance the stage 1 validation game', result);

  console.log('Economy stage 1 validation test passed');

}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
