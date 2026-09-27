'use strict';
// Persist values already returned by production read-only observations. No extra
// browser round trips, inputs, retries, game writes or clock changes.
const fs=require('node:fs'),path=require('node:path');
const {BrowserPlayer}=require('/root/diplomacy_server/tests/reliability/helpers/browser-driver');
const original=BrowserPlayer.prototype.observe;
BrowserPlayer.prototype.observe=async function(fn,arg){
 const result=await original.call(this,fn,arg),source=String(fn);
 let kind;
 if(source==='()=>canvas.scale')kind='scale-before';
 if(source==='()=>players[1].gold')kind='gold-before';

 if(kind)fs.appendFileSync(path.join(path.dirname(this.screenshotDir),'matrix-observations.jsonl'),JSON.stringify({player:this.name,kind,value:result,at:Date.now()})+'\n');
 return result;
};
const observe=BrowserPlayer.prototype.observe;
BrowserPlayer.prototype.observe=async function(fn,arg){
 if(String(fn)!=='s=>canvas.scale<s&&Number.isFinite(canvas.scale)')return observe.call(this,fn,arg);
 const value=await original.call(this,s=>({before:s,after:canvas.scale,valid:canvas.scale<s&&Number.isFinite(canvas.scale)}),arg);
 fs.appendFileSync(path.join(path.dirname(this.screenshotDir),'matrix-observations.jsonl'),JSON.stringify({player:this.name,kind:'scale-after',value,at:Date.now()})+'\n');
 return value.valid;
};
