const { loadAiScripts } = require('./smokeHarness');
const vm = require('vm');

const { context } = loadAiScripts();

new vm.Script(`
function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(label + ': expected ' + expected + ', got ' + actual);
  }
}

function assertClose(actual, expected, label) {
  if (Math.abs(actual - expected) > 0.000001) {
    throw new Error(label + ': expected ' + expected + ', got ' + actual);
  }
}

function emptyEntity() {
  return {
    isEmpty: function() { return true },
    isTown: function() { return false }
  };
}

function hexagon(x, y, playerColor, isSuburb) {
  return {
    coord: {x: x, y: y},
    playerColor: playerColor,
    isSuburb: isSuburb,
    neighbours: []
  };
}

function cell(hex, building) {
  return {
    hexagon: hex,
    coord: hex.coord,
    playerColor: hex.playerColor,
    building: building || emptyEntity(),
    unit: emptyEntity()
  };
}

function town(playerColor, suburbs, hp) {
  return {
    playerColor: playerColor,
    suburbs: suburbs,
    hp: hp,
    maxHP: 10,
    killed: false,
    income: 4 + suburbs.filter(function(suburb) {
      return suburb.isSuburb && suburb.playerColor == playerColor;
    }).length,
    activeProduction: {notEmpty: function() { return false; }},
    buildingProduction: [],
    isBadlyDamaged: hp === 0,
    isEmpty: function() { return false; },
    isTown: function() { return true; }
  };
}

whooseTurn = 1;
suddenDeathRound = 20;
gameRound = 0;

let townHex = hexagon(1, 1, 1, true);
let suburbHex = hexagon(1, 2, 1, true);
let expansionHex = hexagon(2, 2, 1, false);
townHex.neighbours = [{x: 1, y: 2}];
suburbHex.neighbours = [{x: 1, y: 1}, {x: 2, y: 2}];
expansionHex.neighbours = [{x: 1, y: 2}];

let friendlyTown = town(1, [townHex, suburbHex], 10);
let enemyTownHex = hexagon(3, 3, 2, true);
let enemyTown = town(2, [enemyTownHex], 10);
players = [
  {},
  {towns: [friendlyTown], gold: 100, income: 6},
  {towns: [enemyTown], gold: 100, income: 5}
];

let townCell = cell(townHex, friendlyTown);
let suburbCell = cell(suburbHex);
let expansionCell = cell(expansionHex);
let suburbVector = vectorizeCell(suburbCell);
let expansionVector = vectorizeCell(expansionCell);
let townVector = vectorizeCell(townCell);

assertEqual(suburbVector[CELL_VECTOR_INDEX.isSuburb], 1, 'suburb marker');
assertEqual(suburbVector[CELL_VECTOR_INDEX.suburbOwner], 1, 'friendly suburb owner');
assertClose(suburbVector[CELL_VECTOR_INDEX.suburbIncome], 1 / SUBURB_INCOME_VECTOR_SCALE, 'suburb income');
assertEqual(expansionVector[CELL_VECTOR_INDEX.suburbExpansionAvailable], 1, 'expansion opportunity');
assertEqual(expansionVector[CELL_VECTOR_INDEX.suburbExpansionOwner], 1, 'expansion owner');
assertClose(townVector[CELL_VECTOR_INDEX.townSuburbCount], 2 / SUBURB_COUNT_VECTOR_SCALE, 'initial town suburb count');
assertClose(townVector[CELL_VECTOR_INDEX.townSuburbIncome], 2 / SUBURB_INCOME_VECTOR_SCALE, 'initial town suburb income');
assertClose(townVector[CELL_VECTOR_INDEX.currentPlayerSuburbIncome], 2 / SUBURB_INCOME_VECTOR_SCALE, 'initial player suburb income');

expansionHex.isSuburb = true;
friendlyTown.suburbs.push(expansionHex);
friendlyTown.income = 7;
let expandedTownVector = vectorizeCell(townCell);
let expandedSuburbVector = vectorizeCell(expansionCell);
assertEqual(expandedSuburbVector[CELL_VECTOR_INDEX.isSuburb], 1, 'new suburb marker');
assertEqual(expandedSuburbVector[CELL_VECTOR_INDEX.suburbExpansionAvailable], 0, 'new suburb is no longer expansion');
assertClose(expandedTownVector[CELL_VECTOR_INDEX.townSuburbCount], 3 / SUBURB_COUNT_VECTOR_SCALE, 'expanded suburb count');
assertClose(expandedTownVector[CELL_VECTOR_INDEX.currentPlayerIncome], 6 / PLAYER_INCOME_VECTOR_SCALE, 'player income feature');
players[1].income = 7;
expandedTownVector = vectorizeCell(townCell);
assertClose(expandedTownVector[CELL_VECTOR_INDEX.currentPlayerIncome], 7 / PLAYER_INCOME_VECTOR_SCALE, 'income updates after suburb');
assertClose(expandedTownVector[CELL_VECTOR_INDEX.currentPlayerSuburbIncome], 3 / SUBURB_INCOME_VECTOR_SCALE, 'suburb income updates after expansion');

suburbHex.playerColor = 2;
suburbHex.isSuburb = false;
let capturedSuburbVector = vectorizeCell(suburbCell);
let capturedTownVector = vectorizeCell(townCell);
assertEqual(capturedSuburbVector[CELL_VECTOR_INDEX.isSuburb], 0, 'captured suburb invalidated');
assertClose(capturedTownVector[CELL_VECTOR_INDEX.townSuburbCount], 2 / SUBURB_COUNT_VECTOR_SCALE, 'captured suburb removed from count');

friendlyTown.hp = 0;
friendlyTown.isBadlyDamaged = true;
let damagedTownVector = vectorizeCell(townCell);
assertClose(damagedTownVector[CELL_VECTOR_INDEX.townSuburbCount], 2 / SUBURB_COUNT_VECTOR_SCALE, 'damage preserves suburbs');

friendlyTown.killed = true;
townHex.isSuburb = false;
expansionHex.isSuburb = false;
let lostTownVector = vectorizeCell(townCell);
let formerExpansionVector = vectorizeCell(expansionCell);
assertClose(lostTownVector[CELL_VECTOR_INDEX.currentPlayerSuburbIncome], 0, 'town loss removes suburb income');
assertEqual(formerExpansionVector[CELL_VECTOR_INDEX.suburbExpansionAvailable], 0, 'town loss removes expansion opportunities');

whooseTurn = 2;
let enemyPerspectiveVector = vectorizeCell(cell(enemyTownHex, enemyTown));
assertEqual(enemyPerspectiveVector[CELL_VECTOR_INDEX.suburbOwner], 1, 'suburb ownership is relative');
assertModelCellVectorCompatible({inputs: [{shape: [null, 3, 3, CELL_VECTOR_SIZE]}]});
`, { filename: 'suburb-vectorization-smoke.js' }).runInContext(context);

console.log('Suburb vectorization smoke passed');
