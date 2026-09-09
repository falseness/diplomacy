// Real generated-map economy command authority and atomic rejection controls.
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const crypto = require('crypto');
const { createRuntimeContext, loadBrowserScripts, disableHeadlessBorderDrawing } =
  require('../gamestart-simple-economy-completion');
const { scoreFinalEconomyVector } = require('../benchmark-final-symmetrical-economy-gate');


const cases = [];
for (const seed of [1039900, 1039901]) for (const side of [1, 2]) {
  for (const mode of ['legal-unit', 'legal-placement', 'unit-with-destination', 'foreign-producer', 'offmap-producer', 'offmap-destination', 'unknown-product', 'placement-without-destination']) {
    cases.push({seed, side, mode});
  }
}
function run(testCase) {
  const context = createRuntimeContext(testCase.seed);
  loadBrowserScripts(context);
  disableHeadlessBorderDrawing(context);
  context.__case = testCase;
  context.__predict = (_model, vectors) => vectors.map(v => [scoreFinalEconomyVector(v)]);
  return JSON.parse(new vm.Script(`(() => {
    isFogOfWar = false
    gameSettings.testAI = false
    gameSettings.withAI = false
    gameSettings.aiActionLimit = 30
    gameSettings.aiCommandLimit = AI_ECONOMY_DEFAULT_COMMAND_LIMIT
    predict = __predict
    entityInterface = {change() {}, hide() {}}
    townInterface = {change() {}, hide() {}}
    barrackInterface = {change() {}, hide() {}}
    statisticsInterface = {}
    gameEvent = {selected: new Empty(), hideAll() {},
      removeSelection() { this.selected = new Empty() },
      screen: {moveTo() {}, moveToPlayer() {}, stop() {}}}
    nextTurnButton = {setNextPlayerColor() {}, highlightButton: false,
      enableClick() {}, disableClick() {}}
    nextTurnPauseInterface = {visible: false}
    saveManager = {save() {}}
    border = new Border()
    attackBorder = new Border()
    otherSettings.moveCameraToUndoTarget = false
    let map = generateEconomyStage2TrainingMap({seed: __case.seed})
    let layout = JSON.parse(JSON.stringify(map))
    delete layout.testName
    for (let side = 1; side < map.players.length; ++side) {
      map.players[side].playerType = side === __case.side ?
        'AIPlayerWithEconomy' : 'SimpleAiPlayerWithEconomy'
    }
    map.start({clearValues() {
      external = []; externalProduction = []; nature = []; goldmines = []
      gameRound = 0; gameExit = false
    }}, false)
    whooseTurn = __case.side
    let player = players[whooseTurn]
    let startingGold = player.gold
    assert(startingGold === map.players[whooseTurn].gold, 'changed starting resources')
    player.nextTurn()

    let commands = player.getEconomyCommands()
    let unitCommand = commands.find(c => c.category === 'unit-training')
    let placement = commands.find(c => c.destinationCoord)
    assert(unitCommand && placement, 'generated legal unit and placement required')
    let command = JSON.parse(JSON.stringify(
      __case.mode.includes('placement') || __case.mode === 'offmap-destination' ? placement : unitCommand))
    if (__case.mode === 'unit-with-destination') command.destinationCoord = command.producerCoord
    if (__case.mode === 'foreign-producer') command.producerCoord = players[3 - whooseTurn].towns[0].coord
    if (__case.mode === 'offmap-producer') command.producerCoord = {x: -1, y: 0}
    if (__case.mode === 'offmap-destination') command.destinationCoord = {x: -1, y: 0}
    if (__case.mode === 'unknown-product') command.product = 'not-a-product'
    if (__case.mode === 'placement-without-destination') delete command.destinationCoord
    player.units.find(u => u.moves > 0).skipMoves()
    let previousAction = actionManager.lastAction
    let beforeCount = actionManager.arr.length
    function snapshot() {
      return JSON.stringify({grid, vector: vectoriseGrid(),
        gold: players.map(p => p.gold),
        active: players.map(p => p.towns.map(t => t.activeProduction.name || null))})
    }
    let before = snapshot()
    let result = null, error = null
    try { result = player.applyActionCommand(command) }
    catch (caught) { error = caught.message }
    let legal = __case.mode.startsWith('legal-')
    let actionRecorded = actionManager.arr.length === beforeCount + 1
    let stateChanged = snapshot() !== before
    if (legal && result) actionManager.undo()
    return JSON.stringify({result, error, legal, actionRecorded, stateChanged,
      restored: snapshot() === before,
      historyRestored: actionManager.arr.length === beforeCount && actionManager.lastAction === previousAction,
      candidateClass: player.constructor.name,
      opponentClass: players[3 - whooseTurn].constructor.name,
      layoutHashInput: layout})
  })()`, {filename: 'task103-economy-command-validation-runtime.js'}).runInContext(context));
}
const results = cases.map(testCase => {
  const row = {...testCase, ...run(testCase)};
  row.layoutHash = crypto.createHash('sha256').update(JSON.stringify(row.layoutHashInput)).digest('hex');
  delete row.layoutHashInput;
  row.pass = row.error === null && row.result === row.legal && row.restored &&
    row.historyRestored && (!row.legal || (row.actionRecorded && row.stateChanged));
  console.log('COMMAND_CASE: ' + JSON.stringify(row));
  return row;
});
const summary = {cases: results.length, failures: results.filter(r => !r.pass).length};
console.log('COMMAND_SUMMARY: ' + JSON.stringify(summary));
if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify({results, summary}, null, 2) + '\n', {flag: 'wx'});
assert.equal(summary.failures, 0, 'economy command validation failed');
console.log('ECONOMY_COMMAND_VALIDATION: PASS rejected commands preserve state/history; legal production and undo pass');
