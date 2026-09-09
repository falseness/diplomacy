// Real generated-map purchase and turn accounting; no learned-strength claim.
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const crypto = require('crypto');
const { createRuntimeContext, loadBrowserScripts, disableHeadlessBorderDrawing } =
  require('../gamestart-simple-economy-completion');
const { scoreFinalEconomyVector } = require('../benchmark-final-symmetrical-economy-gate');

const SEEDS = [1039700, 1039701];
const SIDES = [1, 2];
const BUDGETS = [0, 1, 2, 30];
const CAPS = [0, 1, 6];
const TURN_BUDGETS = [1, 2, 30];
const cases = [];
for (const seed of SEEDS) for (const side of SIDES) {
  for (const budget of BUDGETS) for (const cap of CAPS) {
    cases.push({ seed, side, budget, cap, kind: 'purchase' });
  }
  for (const budget of TURN_BUDGETS) {
    cases.push({ seed, side, budget, kind: 'turn' });
  }
}

function run(testCase) {
  const context = createRuntimeContext(testCase.seed);
  loadBrowserScripts(context);
  disableHeadlessBorderDrawing(context);
  context.__case = testCase;
  // Same deterministic public-state oracle for baseline and fixed unit tests.
  context.__predict = (_model, vectors) => vectors.map(v => [scoreFinalEconomyVector(v)]);
  return JSON.parse(new vm.Script(`(() => {
    isFogOfWar = false
    gameSettings.testAI = false
    gameSettings.withAI = false
    gameSettings.aiActionLimit = __case.budget
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
    let beforeActions = actionManager.arr.length
    let beforeGold = player.gold
    let beforeProduction = player.towns.concat(player.barracks || []).filter(p =>
      !p.killed && p.isPreparingUnit).length
    let remaining = null
    let effectiveLimit = player.getActionLimit(AI_ECONOMY_DEFAULT_ACTION_LIMIT)
    if (__case.kind === 'purchase') {
      remaining = player.spendWarGoldWithinLimit(__case.budget, __case.cap)
    } else {
      player.doActions()
      assert(player.candidateScoringGrid === null, 'turn cache leaked')
    }
    return JSON.stringify({startingGold, beforeGold, afterGold: player.gold,
      recordedActions: actionManager.arr.length - beforeActions,
      beforeProduction, afterProduction: player.towns.concat(player.barracks || []).filter(p =>
        !p.killed && p.isPreparingUnit).length,
      remaining, effectiveLimit,
      purchases: player.aiHeuristicEconomyActions || 0,
      movement: player.aiHeuristicMovementActions || 0,
      attacks: player.aiModelRankedAttackActions || 0,
      candidateClass: player.constructor.name,
      opponentClass: players[3 - whooseTurn].constructor.name,
      layout})
  })()`, { filename: 'task103-purchase-budget-runtime.js' }).runInContext(context));
}

const results = cases.map(testCase => {
  const result = run(testCase);
  const layoutHash = crypto.createHash('sha256').update(JSON.stringify(result.layout)).digest('hex');
  delete result.layout;
  assert.equal(result.candidateClass, 'AIPlayerWithEconomy');
  assert.equal(result.opponentClass, 'SimpleAiPlayerWithEconomy');
  const total = result.purchases + result.movement + result.attacks;
  assert.equal(result.recordedActions, total, 'counters disagree with real action history');
  const pass = testCase.kind === 'purchase' ?
    result.remaining === testCase.budget - result.purchases &&
      result.purchases <= Math.min(testCase.budget, testCase.cap) &&
      result.afterProduction - result.beforeProduction === result.purchases &&
      (result.purchases > 0 ? result.afterGold < result.beforeGold : result.afterGold === result.beforeGold) :
    total <= result.effectiveLimit;
  const row = { ...testCase, ...result, layoutHash, total, pass };
  console.log('BUDGET_CASE: ' + JSON.stringify(row));
  return row;
});
const summary = { cases: results.length, failures: results.filter(r => !r.pass).length,
  successfulPurchaseCases: results.filter(r => r.kind === 'purchase' && r.purchases > 0).length,
  turnCases: results.filter(r => r.kind === 'turn').length,
  zeroBudgetCases: results.filter(r => r.kind === 'purchase' && r.budget === 0).length,
  layouts: new Set(results.map(r => r.layoutHash)).size };
console.log('BUDGET_SUMMARY: ' + JSON.stringify(summary));
if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify({results, summary}, null, 2) + '\n', {flag: 'wx'});
assert(summary.successfulPurchaseCases > 0, 'no actual purchase coverage');
assert.equal(summary.layouts, SEEDS.length, 'distinct generated layouts required');
assert.equal(summary.failures, 0, 'purchase/turn action budget violation');
console.log('PURCHASE_BUDGET: PASS real production consumes exactly one action; bounded complete turns');
