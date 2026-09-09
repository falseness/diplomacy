// Real generated-map purchase and turn accounting; no learned-strength claim.
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const crypto = require('crypto');
const { createRuntimeContext, loadBrowserScripts, disableHeadlessBorderDrawing } =
  require('../gamestart-simple-economy-completion');
const { scoreFinalEconomyVector } = require('../benchmark-final-symmetrical-economy-gate');


const cases = [];
for (const seed of [1039800, 1039801]) for (const side of [1, 2]) {
  for (const mode of ['success', 'throw-after-action', 'reject-after-action', 'reject-without-action']) {
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

    let command = player.getEconomyCommands().find(c => c.category === 'unit-training')
    assert(command, 'generated map must supply a legal purchase')
    // Preserve an actual selected action beneath the speculative one.
    let unit = player.units.find(u => u.moves > 0)
    assert(unit, 'need a real selected action')
    unit.skipMoves()
    let previousAction = actionManager.lastAction
    let beforeCount = actionManager.arr.length
    let beforeVector = JSON.stringify(vectoriseGrid())
    let beforeGold = player.gold
    let beforeGrid = JSON.stringify(grid)
    let sentinel = new Error('candidate rollback negative control')
    let caught = null
    let result = null
    try {
      result = player.scoreActionCommandsWithFastVectorGrid([command], function(c) {
        if (__case.mode === 'reject-without-action') return false
        assert(this.applyActionCommand(c), 'real legal action must succeed')
        assert(this.gold < beforeGold, 'real production must spend gold')
        assert(actionManager.arr.length === beforeCount + 1, 'real action history')
        if (__case.mode === 'throw-after-action') throw sentinel
        return __case.mode !== 'reject-after-action'
      })
    } catch (error) { caught = error }
    return JSON.stringify({mode: __case.mode,
      exceptionPreserved: __case.mode === 'throw-after-action' ? caught === sentinel : caught === null,
      vectorRestored: JSON.stringify(vectoriseGrid()) === beforeVector,
      gridRestored: JSON.stringify(grid) === beforeGrid,
      goldRestored: player.gold === beforeGold,
      historyRestored: actionManager.arr.length === beforeCount && actionManager.lastAction === previousAction,
      candidateCount: result ? result.commands.length : null,
      error: caught && caught.message,
      candidateClass: player.constructor.name,
      opponentClass: players[3 - whooseTurn].constructor.name})
  })()`, {filename: 'task103-candidate-rollback-runtime.js'}).runInContext(context));
}
const results = cases.map(testCase => {
  const row = {...testCase, ...run(testCase)};
  row.pass = row.exceptionPreserved && row.vectorRestored && row.gridRestored &&
    row.goldRestored && row.historyRestored &&
    row.candidateCount === (row.mode === 'throw-after-action' ? null : row.mode === 'success' ? 1 : 0);
  console.log('ROLLBACK_CASE: ' + JSON.stringify(row));
  return row;
});
const summary = {cases: results.length, failures: results.filter(r => !r.pass).length};
console.log('ROLLBACK_SUMMARY: ' + JSON.stringify(summary));
if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify({results, summary}, null, 2) + '\n', {flag: 'wx'});
assert.equal(summary.failures, 0, 'speculative candidate rollback failed');
console.log('CANDIDATE_ROLLBACK: PASS real production, exception identity, rejected candidates, grid/vector/gold/history restoration');
