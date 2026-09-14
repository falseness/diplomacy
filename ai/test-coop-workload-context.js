'use strict';
// The benchmark may omit drawing output, but must preserve commands and state.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {createFixture} = require('./test-coop-harness');
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
function run(nativeIntrinsics, omitLines) {
    const f = createFixture(undefined, () => {}, {nativeIntrinsics});
    f.evaluate(`generateCoopGame(2,{size:'tiny',seed:0}).start({
        clearValues(){external=[];externalProduction=[];nature=[];goldmines=[];gameRound=0;gameExit=false},
        updateCameraBorders(){}},false);
        whooseTurn=3;gameSettings.aiActionLimit=0;globalThis.trace=[];
        const send=Unit.prototype.sendInstructions;
        Unit.prototype.sendInstructions=function(cell){
            trace.push({from:{...this.coord},to:{...cell.coord},moves:this.moves});
            return send.call(this,cell)
        };void 0`);
    if (omitLines) f.evaluate('border.createLine=()=>{};attackBorder.createLine=()=>{};void 0');
    f.evaluate(`for(let round=1;round<=3;round++){
        spawnCoopWave(round,0);players[3].nextTurn();players[3].play();gameRound=round;
    }void 0`);
    const result = f.evaluate('({trace,state:JSON.parse(JSON.stringify(getGameObject()))})');
    assert(result.trace.length > 0, 'actual demon commands required');
    return result;
}
const expected = run(false, false);
for (const [native, omit] of [[true,false],[true,true]]) {
    const observed = run(native, omit);
    assert.deepEqual(observed, expected);
    console.log(`PASS workload-context native=${native} omitBorderLines=${omit} commands=${observed.trace.length} expected=${hash(expected)} observed=${hash(observed)}`);
}
