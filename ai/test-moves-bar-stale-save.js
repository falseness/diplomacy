'use strict';
// TASK-450-7: a save made before a speed cut (demonQueen movement 2 -> 1 in TASK-396) holds more
// moves than the moves bar has boxes; repaintRects must fill the bar instead of throwing.
// Usage: node ai/test-moves-bar-stale-save.js
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert');
const source=fs.readFileSync(path.join(__dirname,'../sprites/entities/hpBar.js'),'utf8');
class Rect{constructor(x,y,w,h,_f,_s,color){this.color=color;}}
const Bar=vm.runInNewContext(source+';Bar',{basis:{r:10},Rect});
const bar=new Bar({x:0,y:0},1);
bar.repaintRects(2);
assert.strictEqual(JSON.stringify(bar.rects.map(r=>r.color)),JSON.stringify([bar.healthColor]));
console.log('PASS stale-save moves 2 on a 1-box bar fills the bar');
const two=new Bar({x:0,y:0},2);
two.repaintRects(1);
assert.strictEqual(JSON.stringify(two.rects.map(r=>r.color)),JSON.stringify([two.healthColor,two.dmgColor]));
two.repaintRects(-1);
assert.strictEqual(JSON.stringify(two.rects.map(r=>r.color)),JSON.stringify([two.healthColor,two.dmgColor]));
console.log('PASS normal moves 1 of 2 and negative moves unchanged');
