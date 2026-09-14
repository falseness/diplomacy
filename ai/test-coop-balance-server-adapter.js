// Reversible compatibility adapter for sibling tests maintained outside this repo.
// Only fixture setup/expectations change; the actual server and transport are untouched.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {spawnSync} = require('node:child_process');
const assert = require('node:assert/strict');
const dir=path.resolve(__dirname,'../../diplomacy_server');
const out=path.resolve(process.env.COOP_EVIDENCE_DIR || 'artifacts/TASK-108');
fs.mkdirSync(out,{recursive:true});
const files=['authority.test.js','phase-idempotence.test.js'];
const originals=files.map(file=>fs.readFileSync(path.join(dir,'tests/coop',file)));
function replace(s,from,to) {assert.equal(s.split(from).length,2,from);return s.replace(from,to)}
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const restoration = files.map((file,i)=>({file,before:hash(originals[i])}));
let status=1;
try {
  files.forEach((file,i)=>{
    let s=originals[i].toString('utf8');
    const marker=i===0?'new DemonPortal(20,7);':'new DemonPortal(40,7);';
    s=replace(s,marker,'delete gameSettings.coop.balanceVersion; '+marker);
    if(i===1) {
      // Production emits/prepares a turn before its submission. Older direct-call
      // fixtures skipped that read path, so lazy preparation changed their hash.
      s=replace(s,'return {enqueueGameOperation,createNewRound,','return {getTurnGameObjectForEmit,enqueueGameOperation,createNewRound,');
      s=replace(s,'const stale=submission(player,initial[1].componentResult);',
        'await h.api.getTurnGameObjectForEmit(h.game.gameID,player,component.componentResult);\n                        const stale=submission(player,initial[1].componentResult);');
      s=replace(s,'evaluate(`players[3].units.slice()', 'evaluate(`gameSettings.coop.balanceVersion=2; players[3].units.slice()');
      s=replace(s,'Object.entries(COOP_WAVE_CONFIG.types)','Object.entries(getCoopWaveConfig(2).types)');
      s=replace(s,'{imp:3,clawling:4,hound:5,brute:6,bulwark:8,spitter:5,emberArcher:7,hexcaster:9,ravager:11,demonLord:14}',
        '{imp:1,clawling:3,hound:6,brute:10,bulwark:20,spitter:6,emberArcher:15,hexcaster:24,ravager:30,demonLord:35}');
      s=replace(s,"{...imp(40),name:'imp'}","{...imp(40),name:round===5?'clawling':'imp'}");
      s=replace(s,'selects Imp under the current tuned progression.','selects Clawling under the revised version-2 progression.');
      s=replace(s,'round<3?[imp(44)]:','round<1?[imp(44)]:');
      s=replace(s,'first_spawn=3','first_spawn=1');
      s=replace(s,'waves: round 3','waves: round 1');
      s += '\n'+fs.readFileSync(path.join(__dirname,'test-coop-server-progression-fixture.js'),'utf8');
      s=replace(s,"compare('saved-marker-empty-portal-no-replay'", "compare('reconnected-balance-version',h.game.rounds.at(-1)[0].parallelTurnResult.gameSettings.coop.balanceVersion,2);\n        compare('saved-marker-empty-portal-no-replay'");
    }
    fs.writeFileSync(path.join(out,'adapted-'+file),s);
    fs.writeFileSync(path.join(out,'original-'+file),originals[i]);
    fs.writeFileSync(path.join(dir,'tests/coop',file),s);
  });
  console.log('CWD='+dir+'\nCOMMAND='+process.execPath+' --test tests/coop/authority.test.js tests/coop/phase-idempotence.test.js');
  const result=spawnSync(process.execPath,['--test',...files.map(f=>'tests/coop/'+f)],{cwd:dir,stdio:'inherit',env:{...process.env,COOP_EVIDENCE_DIR:out}});
  status=result.status ?? 1;
  console.log('SERVER_EXIT_STATUS='+status);
} finally {
  files.forEach((f,i)=>fs.writeFileSync(path.join(dir,'tests/coop',f),originals[i]));
  restoration.forEach((row,i)=>{row.after=hash(fs.readFileSync(path.join(dir,'tests/coop',files[i])));assert.equal(row.after,row.before);});
  fs.writeFileSync(path.join(out,'fixture-hashes.json'),JSON.stringify(restoration,null,2)+'\n');
  console.log('PASS sibling fixtures restored byte-for-byte '+JSON.stringify(restoration));
}
process.exitCode=status;
