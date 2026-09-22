'use strict';
// Independent reference BFS exercises the optimized graph kernels, including
// endpoint origins, multiple origins, blocked cells, and cache size changes.
const assert = require('node:assert/strict');
const {createFixture} = require('./test-coop-harness');
const f = createFixture(undefined, () => {});
function neighbours(id, side) {
    const x = id % side, y = (id - x) / side, dy = x % 2 ? 0 : -1;
    return [[x,y-1],[x,y+1],[x-1,y+dy],[x-1,y+dy+1],[x+1,y+dy],[x+1,y+dy+1]]
        .filter(([a,b]) => a >= 0 && b >= 0 && a < side && b < side).map(([a,b]) => b*side+a);
}
function distances(side, origins, blocked, endpoints) {
    const result = Array(side*side).fill(-1), queue = [...origins];
    for (const id of origins) result[id] = 0;
    for (let head = 0; head < queue.length; head++) {
        const id = queue[head];
        if (head >= origins.length && endpoints.includes(id)) continue;
        for (const next of neighbours(id, side)) if (result[next] < 0 && !blocked.includes(next)) {
            result[next] = result[id]+1; queue.push(next);
        }
    }
    return result;
}
let checks = 0;
for (const side of [1,2,3,8,15,8,2]) for (let seed = 0; seed < 32; seed++) {
    const ids = Array.from({length:side*side},(_,i)=>i);
    const blocked = ids.filter(i => (i*13+seed*7)%11 < 3);
    const endpoints = ids.filter(i => (i*7+seed)%13 < 2);
    const origins = seed%2 ? [seed%ids.length, (seed*3)%ids.length] : [seed%ids.length];
    f.context.input = {side, blocked, endpoints, origins};
    const actual = f.evaluate(`Array.from(valleyDistances(input.side,
        input.origins.map(id=>({x:id%input.side,y:Math.floor(id/input.side)})),
        new Set(input.blocked),new Set(input.endpoints)))`);
    assert.deepEqual(actual, distances(side,origins,blocked,endpoints)); checks++;
    const open = ids.filter(id => !blocked.includes(id));
    const reached = open.length ? distances(side,[open[0]],blocked,[]) : ids.map(()=>-1);
    const expected = open.every(id=>reached[id]>=0) && endpoints.every(id=>neighbours(id,side).some(n=>reached[n]>=0));
    assert.equal(f.evaluate('valleyPassableConnected(input.side,new Set(input.blocked),input.endpoints)'),expected); checks++;
}
console.log(`PASS valley graph oracle checks=${checks}`);
