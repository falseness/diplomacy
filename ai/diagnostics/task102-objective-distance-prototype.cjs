// Explicit diagnostic preload; production never imports this module.
const assert = require('assert');
const vm = require('vm');
const OriginalScript = vm.Script;
const replacement = `function relativeUnitObjectiveDistance(cell) {
    if (typeof players == 'undefined' || typeof grid == 'undefined') {
        return 0
    }
    let owner = cell.playerColor
    let nearestUnit = Infinity
    let nearestTown = Infinity
    let hasUnit = false
    let hasTown = false
    for (let playerIndex = 1; playerIndex < players.length; ++playerIndex) {
        let player = players[playerIndex]
        if (!player || player.isNeutral || playerIndex == owner) {
            continue
        }
        for (let unit of player.units) {
            if (!unit.killed) {
                hasUnit = true
                nearestUnit = Math.min(nearestUnit,
                    vectorHexDistance(cell.coord, unit.coord))
            }
        }
        for (let town of player.towns) {
            if (!town.killed) {
                hasTown = true
                nearestTown = Math.min(nearestTown,
                    vectorHexDistance(cell.coord, town.coord))
            }
        }
    }
    if (!hasUnit && !hasTown) {
        return 0
    }
    let nearest = hasUnit ? nearestUnit : nearestTown
    let scale = Math.max(grid.arr.length, grid.arr[0].length)
    return -relativePlayerValue(owner) * nearest / scale
}

`;
vm.Script = class ObjectiveDistancePrototypeScript extends OriginalScript {
  constructor(source, options) {
    if (options && options.filename === 'ai/vectorizeContent.js') {
      const begin = source.indexOf('function relativeUnitObjectiveDistance(cell) {');
      const end = source.indexOf('function currentTownDefenseMargin()', begin);
      assert(begin >= 0 && end > begin, 'exact objective-distance replacement boundaries');
      assert(source.slice(begin, end).includes('enemyUnits.push('), 'original allocation site');
      source = source.slice(0, begin) + replacement + source.slice(end);
    }
    super(source, options);
  }
};
