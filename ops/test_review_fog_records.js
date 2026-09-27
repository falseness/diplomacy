'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const A=require('/root/diplomacy_server/tests/reliability/helpers/evidence-audit'),S=require('./evidence_selection'),P=require('./review_fog_records');
const baseline=path.join(A.client,'artifacts/TASK-225/review-77/prepared/selected-212');
const change=fn=>text=>{const x=JSON.parse(text);fn(x);return JSON.stringify(x);};
for(const [id,number,name,mutate,pattern] of [
 ['omitted-command',4,'verification.log',t=>t.replace(/^COMMAND .+\n/m,''),/literal-command/],
 ['truncated-output',4,'verification.log',t=>t.replace('TAP version 13','TAP truncated'),/full-output/],
 ['wrong-runtime',4,'verification.log',t=>t.replace(/125\.0\.6422\.26/g,'0.0.0.0'),/full-output|runtime-records/],
 ['false-checkpoint',4,'checkpoints.json',change(x=>x.checkpoints[0].observed=[]),/checkpoint\//],
 ['nested-credential',4,'coop-fog/network-traces.jsonl',t=>t.trimEnd()+'\n'+JSON.stringify({packet:'42'+JSON.stringify(['event',JSON.stringify({password:'123456789012'})])})+'\n',/redaction/],
 ['missing-capture',4,'screenshots/coop-fog-001-p1-actions.png',()=>null,/ENOENT/],
 ['wrong-seed',7,'declared-fixture.json',null,null],
 ['extra-browser-case',7,'verification-plan.json',change(x=>x.cases.push({...x.cases.at(-1),id:'extra'})),/declared-cases/],
 ['wrong-join',7,'verification-plan.json',change(x=>x.cases[4].join='sequential'),/bounded-browser-pairings/],
 ['one-context',7,'checkpoints.json',change(x=>x.checkpoints.find(c=>c.id==='coop-fog/participants').observed=1),/connected-humans/],
 ['unexpected-browser-error',5,'coop-fog/browser-errors.json',()=>JSON.stringify([{type:'pageerror',text:'boom'}]),/browser-errors/],
 ['wrong-navigation-reason',5,'coop-fog/navigation-errors.json',()=>JSON.stringify([{type:'requestfailed',text:'net::ERR_FAILED',url:'https://127.0.0.1:123/socket.io/'}]),/expected-navigation-abort/],
 ['fake-tier',6,'verification-plan.json',change(x=>x.cases[4].tier='simulated'),/browser-tiers/],
 ['substituted-ai',6,'coop-fog/declared-fixture.json',change(x=>x.b.gameSettings.withAI=true),/no-ai/],
 ['elapsed-reset',8,'verification-budget.json',change(x=>x.elapsedMs=1),/wall-clock/],
 ['live-owned-process',8,'coop-fog/cleanup.json',change(x=>x.processes[0].aliveAfter=true),/owned-dead/],
 ['timeout',8,'child-results.json',change(x=>x.children[0].timedOut=true),/no-timeout/],
 ['omitted-case',8,'original-coverage.json',change(x=>x.cases.pop()),/selected-cases/]
])test('fog AC'+number+' rejects '+id+' after proof hash rebinding',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fog-record-'));
 try{
  fs.cpSync(baseline,dir,{recursive:true});
  const actualName=id==='wrong-seed'?'coop-fog/declared-fixture.json':name;
  const edit=id==='wrong-seed'?change(x=>x.spec.seed=2):mutate;
  const f=path.join(dir,actualName),value=edit(fs.readFileSync(f,'utf8')),manifest=A.read(path.join(dir,'evidence-hashes.json'));
  if(value===null)fs.unlinkSync(f);else{fs.writeFileSync(f,value);manifest[actualName]=A.hash(f);}
  assert.throws(()=>S.transaction(()=>P.review(number,dir,manifest)),id==='wrong-seed'?/fixture-contract/:pattern);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
