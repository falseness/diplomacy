'use strict';
// TASK-369: gameSettings.drawFogLandmarks across the real client lifecycle
// (GameManager.start, buildOnlineBoard, getGameObject/loadFromJson, legacy saves).
// TASK-450-4: co-op also draws landmarks, so every mode starts with true.
// Needs node >= 14 (client scripts use optional chaining).
// Usage: node ai/test-fog-landmark-lifecycle.js --output-dir DIR [--fixtures-dir DIR]
const fs=require('fs'),path=require('path'),util=require('util');
const {createFixture}=require('../../diplomacy_server/tests/client/test-coop-harness');
const arg=name=>{const i=process.argv.indexOf(name);return i<0?undefined:process.argv[i+1];};
const out=arg('--output-dir');
if(!out){console.error('usage: --output-dir DIR [--fixtures-dir DIR]');process.exit(2);}
const fixturesDir=arg('--fixtures-dir')||path.join(out,'legacy-fixtures');
fs.mkdirSync(out,{recursive:true});fs.mkdirSync(fixturesDir,{recursive:true});

const COMPETITIVE="maps['open field'][2]",COOP="generateCoopGame(2,{size:'tiny',seed:1})";
// A page with production scripts; only presentation callbacks are replaced.
function page(){
    const f=createFixture(undefined,()=>{});
    f.evaluate(`GameManager.clearBasisValues=()=>{}; GameManager.updateCameraBorders=()=>{};
        gameEvent.nextTurn=()=>{}; globalThis.saveManager={save(){}};
        globalThis.nextTurnPauseInterface={visible:false}; undefined`);
    return {
        e:source=>f.evaluate(source),
        start(map){return f.evaluate(`GameManager.start(${map},true,false); gameSettings.drawFogLandmarks`);},
        flag(){return f.evaluate('gameSettings.drawFogLandmarks');},
        save(){return f.evaluate('JSON.stringify(getGameObject())');},
        load(json,stale){
            f.context.savedInput=json;
            return f.evaluate(`gameSettings.drawFogLandmarks=${JSON.stringify(stale)};
                loadFromJson(savedInput); gameSettings.drawFogLandmarks`);
        },
    };
}
function onlineBoard(before,map){
    // Stale false from the previous game; a leak into the board would show.
    const p=page();p.start(before);p.e('gameSettings.drawFogLandmarks=false');
    const settingsBefore=p.e('JSON.stringify(gameSettings)');
    const board=p.e(`GameManager.buildOnlineBoard(${map},true)`);
    const settingsAfter=p.e('JSON.stringify(gameSettings)');
    return {board:board.gameSettings.drawFogLandmarks,
        before:JSON.parse(settingsBefore).drawFogLandmarks,after:JSON.parse(settingsAfter).drawFogLandmarks,
        unchanged:settingsBefore===settingsAfter,fog:board.isFogOfWar};
}
function roundtrip(map,stale){
    const p=page();p.start(map);
    const json=p.save();
    return {saved:JSON.parse(json).gameSettings.drawFogLandmarks,loaded:page().load(json,stale)};
}
function legacy(map,name,stale){
    const p=page();p.start(map);
    const packed=JSON.parse(p.save());
    delete packed.gameSettings.drawFogLandmarks;
    const json=JSON.stringify(packed),file=path.join(fixturesDir,name+'.json');
    fs.writeFileSync(file,json+'\n');
    // Load exactly the bytes on disk.
    const input=fs.readFileSync(file,'utf8').trim();
    return {file:path.relative(process.cwd(),file),inputHasKey:input.includes('drawFogLandmarks'),
        coop:!!packed.gameSettings.coop,loaded:page().load(input,stale)};
}

const cases=[
    ['start-competitive-hotseat',()=>{const p=page();p.e('gameSettings.drawFogLandmarks=false');
        return {started:p.start(COMPETITIVE),fog:p.e('isFogOfWar'),coop:p.e('!!gameSettings.coop')};},
        {started:true,fog:true,coop:false}],
    ['start-coop-local',()=>{const p=page();p.e('gameSettings.drawFogLandmarks=false');
        return {started:p.start(COOP),fog:p.e('isFogOfWar'),coop:p.e('!!gameSettings.coop')};},
        {started:true,fog:true,coop:true}],
    ['online-board-competitive',()=>onlineBoard(COOP,COMPETITIVE),{board:true,before:false,after:false,unchanged:true,fog:true}],
    ['online-board-coop',()=>onlineBoard(COMPETITIVE,COOP),{board:true,before:false,after:false,unchanged:true,fog:true}],
    ['save-roundtrip-competitive',()=>roundtrip(COMPETITIVE,false),{saved:true,loaded:true}],
    ['save-roundtrip-coop',()=>roundtrip(COOP,false),{saved:true,loaded:true}],
    ['legacy-coop',()=>legacy(COOP,'legacy-coop',false),
        {file:path.relative(process.cwd(),path.join(fixturesDir,'legacy-coop.json')),inputHasKey:false,coop:true,loaded:true}],
    ['legacy-competitive',()=>legacy(COMPETITIVE,'legacy-competitive',false),
        {file:path.relative(process.cwd(),path.join(fixturesDir,'legacy-competitive.json')),inputHasKey:false,coop:false,loaded:true}],
    ['explicit-preserved',()=>{const p=page();p.start(COMPETITIVE);
        const packed=JSON.parse(p.save());packed.gameSettings.drawFogLandmarks=false;
        return {coop:!!packed.gameSettings.coop,loaded:page().load(JSON.stringify(packed),true)};},
        {coop:false,loaded:false}],
    ['mode-switch',()=>{const p=page();return [p.start(COMPETITIVE),p.start(COOP),p.start(COMPETITIVE)];},[true,true,true]],
];
const checkpoints=[];
for(const [id,run,expected] of cases){
    let observed;
    try{observed=run();}catch(e){observed='ERROR '+e.message;}
    const pass=util.isDeepStrictEqual(observed,expected);
    checkpoints.push({id,expected,observed,pass});
    console.log(`${pass?'PASS':'FAIL'} ${id} observed=${JSON.stringify(observed)}${pass?'':' expected='+JSON.stringify(expected)}`);
}
const failed=checkpoints.filter(c=>!c.pass).length;
fs.writeFileSync(path.join(out,'checkpoints.json'),JSON.stringify(checkpoints,null,2)+'\n');
console.log(`SUMMARY pass=${checkpoints.length-failed} fail=${failed}`);
process.exit(failed?1:0);
