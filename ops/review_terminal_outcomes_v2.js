'use strict';
// Version 2: explicit reviewed current implementation and immutable historical ancestry.
// Independent archived outcome oracle. Never execute the provider's expected-
// state builders or treat its PASS flags as the expected gameplay state.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const A=require('/root/diplomacy_server/tests/reliability/helpers/evidence-audit');
const R=require('/root/diplomacy_server/tests/reliability/helpers/evidence-reviews');
const CASES=['terminal-victory','terminal-draw','terminal-to-coop','terminal-to-competitive'];
const implementation={
 'client/player.js':'85123d8a0253cf3ce4f93890680dc952c2fc7d3972157a9cc4f2b8fc2466f037',
 'client/nextTurn.js':'920ed705c5b34c15dec6893384616d6edb3173f807ec4724711fa013997f2fd1',
 'server/tests/reliability/terminal-flow.test.js':'e56fb519f9c0e6ffb3f8c0b4a22c9cf1d858a8a25a2faf5dfcbea201fdfbff99',
 'server/tests/reliability/helpers/terminal-flow-source.js':'f26b9457dc90d6c0d2a59ac03afeb378cc7b68913adf69bf88cc8d4b46b57ce1',
 'server/tests/reliability/helpers/terminal-flow-flood.js':'a8449f13b3613cd223c105b1a1e7508dd54af87e484abb8e3d2f46be6c498e4d',
 'server/tests/reliability/helpers/crisis-cleanup-browser.js':'87a9c0b003eaa778d92076f64fa579f0d8cf5b37011f079a3884c52821759e8a',
 'server/tests/reliability/helpers/terminal-flow-next-game.js':'31eff97d53f66a02be409405456c70e65397fdd029327f3d357ca861769d79e8',
 'server/tests/reliability/helpers/browser-driver.js':'cd99d63051da689a098a3170ebb507f6e0aa28dfc9f74aeb5efd28d467fd6348'
};
const files=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(dir,e.name)).map(n=>e.name+'/'+n):[e.name]).sort();
const manifest=dir=>Object.fromEntries(files(dir).map(n=>[n,A.hash(path.join(dir,n))]));
function state(b){return structuredClone({round:b.gameRound,grid:b.grid,players:b.players.map(p=>({gold:p.gold,units:p.units,towns:p.towns})),external:b.external,externalProduction:b.externalProduction,nature:b.nature.slice().sort((a,b)=>a.coord.x-b.coord.x||a.coord.y-b.coord.y),goldmines:b.goldmines});}
function outcome(b){const alive=p=>p.units.some(u=>!u.killed&&u.hp>0)||p.towns.some(t=>!t.killed&&t.hp>0);const humans=b.players.slice(1,3).some(alive),enemy=b.players[3].units.some(u=>!u.killed&&u.hp>0)||b.external.some(e=>e.name==='demonPortal'&&!e.killed&&e.hp>0);return !humans?enemy?'defeat':'draw':enemy?null:'victory';}
function flood(b,ring){const x=structuredClone(b),last=x.grid.length-1;const wet=c=>c.x>=ring&&c.y>=ring&&c.x<=last-ring&&c.y<=last-ring&&(c.x===ring||c.y===ring||c.x===last-ring||c.y===last-ring);for(let i=ring;i<=last-ring;i++)for(let j=ring;j<=last-ring;j++)if(wet({x:i,y:j})){x.grid[i][j]=0;if(!x.nature.some(n=>n.name==='sea'&&n.coord.x===i&&n.coord.y===j))x.nature.push({name:'sea',coord:{x:i,y:j}});}for(const p of x.players){p.units=p.units.filter(u=>!wet(u.coord));p.towns=p.towns.filter(t=>!wet(t.coord));}x.external=x.external.filter(e=>!wet(e.coord));x.gameRound++;return x;}
function prepareHuman(b,slot,late){const p=b.players[slot];if(late)p.gold-=p.units.length;else {assert.equal(p.gold,0);assert.equal(p.units.length,5);assert.equal(p.towns.length,1);assert.deepEqual(p.towns[0].suburbs,[]);p.units=[];p.towns[0].unitProduction.turns--;p.towns[0].wasHitted=false;}}
function defeat(b){const x=structuredClone(b);for(const slot of [1,2]){const t=x.players[slot].towns[0],u=x.players[3].units[slot-1];assert.equal(t.hp,1);assert.equal(u.name,'imp');assert.equal(u.coord.x,t.coord.x);assert.equal(u.coord.y,t.coord.y+1);x.players[slot].towns=[];u.coord.y--;u.moves=0;x.grid[u.coord.x][u.coord.y]=3;}return x;}
function review(dir,criteria=[1],receipt=null,bound=manifest(dir),mode='current'){
 assert(['current','historical'].includes(mode),'explicit implementation mode');
 const reviewed=mode==='historical'?implementation:{...implementation,'client/player.js':'09095f1b53aad727d3270a1fe2187fc91a6d6599db8b2be370cbb8d9beaa71a1'};
 assert.deepEqual(criteria,[1],'only-complete-terminal-outcome-criterion');
 const checks=[],proofs={};const check=(id,e,o)=>{assert.deepEqual(o,e,'terminal/'+id);checks.push({owner:1,id:'terminal/AC1/'+id,expected:structuredClone(e),observed:structuredClone(o),pass:true});};
 const read=(n,jsonl=false)=>{A.proofKey(dir,n,bound);proofs[n]=bound[n];const s=fs.readFileSync(path.join(dir,n),'utf8');return jsonl?s.trim().split('\n').map(JSON.parse):JSON.parse(s);};
 const ids=read('source-identities.json');for(const [key,sha] of Object.entries(reviewed)){const [repo,...parts]=key.split('/'),n=parts.join('/'),absolute=path.join(repo==='client'?A.client:A.root,n);check('implementation/'+key,sha,ids.after[repo].files[n]);if(mode==='current')assert.equal(A.hash(absolute),sha,'changed-reviewed-terminal-implementation:'+key);proofs[absolute]=sha;}
 const inv=read('terminal-inventory.json');check('source-case-enumeration',['victory','defeat','draw','competitive-draw','competitive-survivor'],inv.rules.map(r=>r.id));
 for(const r of inv.rules){assert.match(r.fixture,/late round 39/);check('source/'+r.id+'/tier','shipped source execution',r.tier);check('source/'+r.id+'/round-before',39,r.before.gameRound);check('source/'+r.id+'/no-portals',[],r.before.external);const after=flood(r.before,0),living=after.players.slice(1).map(p=>p.units.length>0||p.towns.length>0),coop=!r.id.startsWith('competitive');check('source/'+r.id+'/derived-outcome',{round:40,living,result:coop?outcome(after):null,ended:coop?outcome(after)!==null:living.every(v=>!v)},r.observed);}
 check('unsupported-rules',[{id:'competitive-lone-survivor-victory',reason:'NeutralPlayer.isGameEnded requires every nonneutral player to be lost; remaining survivors continue.'},{id:'stalemate',reason:'No repetition or no-legal-move terminal rule exists; sudden death flooding can yield all-eliminated draw.'}],inv.unsupported);
 const plan=read('verification-plan.json'),cov=read('coverage-results.json'),cp=read('checkpoints.json').checkpoints;
 check('four-cases',CASES,plan.cases.map(c=>c.id));check('completed-cases',CASES,cov.cases.filter(c=>c.pass).map(c=>c.id));
 for(const id of CASES){
  const late=id==='terminal-victory'||id==='terminal-draw',expectedResult=late?id.slice(9):'defeat';
  const fixture=read(id+'/declared-fixture.json'),b=fixture.b;assert.equal(fixture.spec.generation.testFixture.generated,false);assert.match(fixture.spec.generation.testFixture.kind,/declared/);check(id+'/fixture-parameters',[2,'tiny',1],[fixture.spec.humans,fixture.spec.size,fixture.spec.seed]);check(id+'/initial-round',late?41:0,b.gameRound);check(id+'/initial-not-terminal',null,outcome(b));
  const trace=read(id+'/network-traces.jsonl',true),inputs=read(id+'/input-trace.jsonl',true),stage=name=>trace.filter(r=>r.stage===name);
  check(id+'/admitted-slots',[1,2],stage('api-join').map(r=>r.board.whooseTurn).sort());check(id+'/admitted-identities',[0,1],stage('api-join').map(r=>r.identity).sort());
  const contexts=cp.filter(c=>c.id===id+'/participants');check(id+'/context-record-count',1,contexts.length);check(id+'/contexts',2,contexts[0].observed);
  check(id+'/legal-inputs',[['p1','mouse','tap','mouse.click'],['p2','mouse','tap','mouse.click']],inputs.filter(r=>r.label===(late?'legal pass before flooding':'commit crisis state')).map(r=>[r.player,r.device,r.action,r.via]));
  const commits=stage('mongo-commit');check(id+'/commit-owners',[1,2],commits.map(r=>r.owner));const terminal=stage('mongo-terminal');check(id+'/terminal-count',1,terminal.length);
  let expected=structuredClone(b);
  for(const slot of [1,2]){
   prepareHuman(expected,slot,late);
   const doc=commits[slot-1].stored;
   if(!late&&slot===2)expected=defeat(expected);
   if(!late&&slot===2)check(id+'/commit-'+slot,state(expected),state(doc.rounds.at(-1)[0].parallelTurnResult));
   else {const turns=doc.rounds.flatMap(rr=>rr.flatMap(g=>g.turns)).filter(t=>t.playerIndex===slot&&t.gameObject);check(id+'/commit-'+slot+'/count',1,turns.length);check(id+'/commit-'+slot,state(expected),state(turns[0].gameObject));}
  }
  if(late)expected=flood(expected,1);
  const doc=terminal[0].stored,actual=doc.rounds.at(-1)[0].parallelTurnResult;
  check(id+'/independently-derived-result',expectedResult,outcome(expected));check(id+'/terminal-state',state(expected),state(actual));check(id+'/terminal-result',expectedResult,actual.gameSettings.coop.result);check(id+'/terminal-no-human-turns',[0],doc.rounds.at(-1).flatMap(g=>g.turns.map(t=>t.playerIndex)));
  const ui=stage('terminal-ui');check(id+'/ui-participants',['p1','p2'],ui.map(r=>r.player));for(const r of ui){check(id+'/'+r.player+'/ui-result',expectedResult,r.state.result);const text={victory:'Victory — humans win',draw:'Draw',defeat:'Defeat — demons win'}[expectedResult];check(id+'/'+r.player+'/rendered-outcome',true,r.state.text.includes(text));}
 }
 return {criteria,checks,proofs,caseIds:CASES,derivation:'Declared initial fixtures only. Derive perimeter flood occupancy, portal removal, unit upkeep, starvation and adjacent imp capture independently from initial boards; compare both committed boards and persisted terminal state. Independently derive supported rule outcomes from five source fixtures, distinguish all-eliminated competitive end from unsupported lone-survivor victory and stalemate, and bind each of four browser cases to two admitted identities, two real pass clicks, commits and captured result text. These are historical observations, never current-source or natural-progression proof.'};
}
function rowFor(tasks,report,m,n=1){assert.equal(n,1);const text=tasks.find(t=>t.id==='TASK-221').acceptance_criteria[0],ref=file=>({file,sha256:m[file]}),name='terminal-independent-review.json';return {id:'TASK-221/AC1',targetSha256:R.digest(text),reviewer:'Independent terminal outcome derivation',clauses:[{text,disposition:'reviewed',runTask:'TASK-221',tier:'natural-browser',caseIds:CASES,sourceIdentity:ref('source-identities.json'),traces:CASES.map(id=>ref(id+'/network-traces.jsonl')),contextIds:CASES.map(id=>'terminal/AC1/'+id+'/contexts'),milestoneIds:CASES.map(id=>'terminal/AC1/'+id+'/terminal-result'),proofs:[...Object.keys(report.proofs).filter(n=>!path.isAbsolute(n)),name].map(ref),assertions:report.checks.map(c=>({id:c.id,expected:c.expected,proof:ref(name)})),reason:'Whole outcome criterion reviewed; historical disposition retains all source mismatches and current obligations.',derivation:report.derivation,followUp:{scope:'Refresh affected terminal proof only after the remaining criteria review.',acceptance:'Complete current-source terminal evidence with independent outcome and lifecycle checks.',targetMs:1800000,stopWorkMs:3300000,budgetMs:3600000}}]};}
module.exports={review,rowFor,CASES,HISTORICAL:[1],CURRENT:[1],projection:v=>structuredClone(v),manifest,implementation};
