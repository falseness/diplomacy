// Co-op: bushes and hills on a teammate's hex are walkable like empty teammate hexes,
// while teammate towns and goldmines stay blocked. Competitive moves are unchanged.
const {isDeepStrictEqual} = require('util');
const {createFixture, defaultFixture} = require('./test-coop-harness');

// Pre-fix TASK-014 guards: every non-empty building on an ally hex counts as a teammate's.
const PRE_FIX_GUARDS = `
  Unit.prototype.cellHasTeammate = function(cell) {
    return [cell.unit, cell.building].some(entity => entity.notEmpty() &&
      entity.playerColor !== this.playerColor && this.player.isAlliedWith(entity.player))
  }
  Way.prototype.isCellImpassable = function(neighbour, v0, arr, player) {
    let cell = arr[neighbour.x][neighbour.y]
    let ourUnit = cell.unit.notEmpty() && cell.unit.playerColor == player && !coordsEqually(neighbour, v0)
    let teammateBuilding = cell.building.notEmpty() && cell.building.playerColor != player &&
      players[player].isAlliedWith(cell.building.player)
    let teammateUnit = cell.unit.notEmpty() && cell.unit.playerColor != player &&
      players[player].isAlliedWith(cell.unit.player)
    let buildingObstacle = cell.building.isObstacle(player) || teammateBuilding || teammateUnit
    let fogged = isFogOfWar && players[player].role !== 'DEMONS' && !grid.fogOfWar[neighbour.x][neighbour.y]
    return (players[player].ignoresCell(cell) || ourUnit || buildingObstacle || fogged)
  }; undefined`;

function setup(fault, coop, source) {
  const config = defaultFixture();
  config.coop = coop;
  config.actors[1].units = [];
  const f = createFixture(config, () => {});
  if (fault) f.evaluate(PRE_FIX_GUARDS);
  f.evaluate(source + '; undefined');
  return f;
}

const listed = (f, x, y) => f.evaluate(`(() => { mover.select()
  const has = list => list.some(c => c.destinationCoord.x === ${x} && c.destinationCoord.y === ${y})
  return {move: has(mover.getAvailableMoveCommands()), any: has(mover.getAvailableCommands())} })()`);
const send = (f, x, y) => f.evaluate(`mover.sendInstructions(grid.getCell({x:${x},y:${y}}));
  ({coord: {x: mover.coord.x, y: mover.coord.y}, hex: grid.getHexagon({x:${x},y:${y}}).playerColor,
    building: grid.getBuilding({x:${x},y:${y}}).name})`);

// (a)/(b): move onto a passable nature building on an ally (player 2) hex.
function natureCase(fault, unitType, natureType) {
  const f = setup(fault, true, `grid.getHexagon({x:5,y:3}).playerColor=1; globalThis.mover=new ${unitType}(5,3);
    grid.getHexagon({x:6,y:3}).playerColor=2; new ${natureType}(6,3)`);
  const before = listed(f, 6, 3);
  const after = send(f, 6, 3);
  return {observed: {before, after},
    expected: {before: {move: true, any: true},
      after: {coord: {x: 6, y: 3}, hex: 1, building: natureType === 'Hill' ? 'mountain' : 'bush'}}};
}

// (c): the only exit from the start hex is an ally bush; the destination lies beyond it.
function pathThroughCase(fault) {
  const f = setup(fault, true, `grid.getHexagon({x:5,y:3}).playerColor=1; globalThis.mover=new Noob(5,3);
    grid.getHexagon({x:6,y:3}).playerColor=2; new Bush(6,3);
    mover.select()
    for (const c of mover.getAvailableMoveCommands().map(c => c.destinationCoord))
      if (mover.interaction.way.getDistance(c) === 1 && !(c.x === 6 && c.y === 3)) new Mountain(c.x, c.y)
    grid.getHexagon({x:7,y:3}).playerColor=0`);
  const before = {...listed(f, 7, 3), distance: f.evaluate('mover.interaction.way.getDistance({x:7,y:3})')};
  const after = send(f, 7, 3);
  return {observed: {before, after},
    expected: {before: {move: true, any: true, distance: 2}, after: {coord: {x: 7, y: 3}, hex: 1, building: undefined}}};
}

// (d): ally goldmine and ally town (player 2's town at 7,1) stay blocked.
function blockedCase(fault, kind) {
  const target = kind === 'goldmine' ? {x: 6, y: 2} : {x: 7, y: 1};
  const source = `grid.getHexagon({x:6,y:1}).playerColor=1; globalThis.mover=new Noob(6,1);
    grid.getHexagon({x:6,y:2}).playerColor=2; new Goldmine(6,2,50)`;
  // Control: the same target is within reach when player 2 is not an ally.
  const reachableCompetitive = listed(setup(fault, false, source), target.x, target.y).move;
  const f = setup(fault, true, source);
  const before = listed(f, target.x, target.y);
  const after = send(f, target.x, target.y);
  return {observed: {reachableCompetitive, before: before.move, coord: after.coord, hex: after.hex},
    expected: {reachableCompetitive: true, before: false, coord: {x: 6, y: 1}, hex: 2}};
}

// (e): competitive, a bush on another player's hex is reachable and entered as before.
function competitiveCase(fault) {
  const f = setup(fault, false, `grid.getHexagon({x:5,y:3}).playerColor=1; globalThis.mover=new Noob(5,3);
    grid.getHexagon({x:6,y:3}).playerColor=2; new Bush(6,3)`);
  const before = listed(f, 6, 3);
  const after = send(f, 6, 3);
  return {observed: {before, after},
    expected: {before: {move: true, any: true}, after: {coord: {x: 6, y: 3}, hex: 1, building: 'bush'}}};
}

function run(fault) {
  const cases = [
    ['archer-bush', () => natureCase(fault, 'Archer', 'Bush')],
    ['noob-bush', () => natureCase(fault, 'Noob', 'Bush')],
    ['archer-hill', () => natureCase(fault, 'Archer', 'Hill')],
    ['noob-hill', () => natureCase(fault, 'Noob', 'Hill')],
    ['path-through-bush', () => pathThroughCase(fault)],
    ['ally-goldmine-blocked', () => blockedCase(fault, 'goldmine')],
    ['ally-town-blocked', () => blockedCase(fault, 'town')],
    ['competitive-bush', () => competitiveCase(fault)]
  ];
  let failed = 0;
  for (const [name, fn] of cases) {
    const {observed, expected} = fn();
    if (isDeepStrictEqual(observed, expected)) console.log(`PASS ${name} ${JSON.stringify(observed)}`);
    else {
      failed++;
      console.log(`FAIL ${name} observed=${JSON.stringify(observed)} expected=${JSON.stringify(expected)}`);
    }
  }
  console.log(`${failed ? 'FAILED' : 'PASSED'} ally-nature-movement cases=${cases.length} failed=${failed}` +
    (fault ? ` fault=${fault}` : ''));
  return failed;
}

if (require.main === module) {
  const i = process.argv.indexOf('--fault');
  const fault = i >= 0 ? process.argv[i + 1] : undefined;
  if (fault !== undefined && fault !== 'no-nature-exception') {
    console.error(`unknown fault: ${fault}`);
    process.exit(2);
  }
  process.exit(run(fault) ? 1 : 0);
}
