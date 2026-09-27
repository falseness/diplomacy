'use strict';
// Offline, independent fog review. Does not import the shipped visibility
// implementation or its test oracle. Raw worlds supply facts, never expectations.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const A=require('/root/diplomacy_server/tests/reliability/helpers/evidence-audit');
const R=require('/root/diplomacy_server/tests/reliability/helpers/evidence-reviews');
const SOURCE=['source-competitive-clear','source-competitive-fog','source-coop-clear','source-coop-fog'];
const BROWSER=['coop-fog','competitive-clear'],CASES=[...SOURCE,...BROWSER];
const STAGES=[['initial','p1'],['initial','p2'],['movement','p1'],['combat-death','p1'],['capture','p1'],['production','p2'],['round','p1'],['round','p2'],['stale','p1'],['reconnect','p1']];
function expectedMask(world){
 const {cells,players,viewer,fog,coop}=world,w=cells.length,h=cells[0].length;
 assert(cells.every(col=>col.length===h),'ragged-fog-world');
 const mask=cells.map(col=>col.map(cell=>!fog||['mountain','lake','sea'].includes(cell.building)));
 if(!fog)return mask;
 // Compute finite distance fields by simultaneous relaxation, including opaque
 // endpoints but never traversing them. Odd-column vertical hex coordinates.
 for(const player of players.filter(p=>coop?p.role==='HUMAN':p.index===viewer)){
  const sources=[...player.units.map(u=>({...u,radius:3,over:cells[u.x][u.y].building==='tower'})),...player.towns.flatMap(t=>t.suburbs.map(s=>({...s,radius:1,over:false})))];
  for(const s of sources){
   let reached=new Set([s.x+','+s.y]);
   for(let depth=0;depth<s.radius;depth++){
    const next=new Set(reached);
    for(const key of reached){const [x,y]=key.split(',').map(Number);
     if(key!==s.x+','+s.y&&!s.over&&['town','wall','tower','bastion','mountain','bush'].includes(cells[x][y].building))continue;
     for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++){
      if(dx===0?Math.abs(dy)!==1:!(x%2?dy===0||dy===1:dy===-1||dy===0))continue;
      const nx=x+dx,ny=y+dy;if(nx>=0&&ny>=0&&nx<w&&ny<h)next.add(nx+','+ny);
     }
    }reached=next;
   }
   for(const key of reached){const [x,y]=key.split(',').map(Number);mask[x][y]=true;}
  }
 }
 return mask;
}
function analyze(visibility,checkpoints,traces,inputs){
 const checks=[],check=(owner,id,expected,observed)=>{assert.deepEqual(observed,expected,'fog/'+id);checks.push({owner,id:'fog/'+id,expected,observed,pass:true});};
 const cp=new Map(checkpoints.map(c=>[c.id,c]));assert.equal(cp.size,checkpoints.length,'duplicate-provider-checkpoint');
 const observed=id=>{assert(cp.has(id),'missing-provider-checkpoint:'+id);return cp.get(id).observed;};
 const expectedKeys=[...SOURCE.flatMap(id=>[1,2].map(p=>[id,'source',p])),...BROWSER.flatMap(id=>STAGES.map(([s,p])=>[id,s,p]))];
 check(1,'exact-recipient-observations',expectedKeys,visibility.map(r=>[r.case,r.label,r.player]));
 const previous=new Map();
 for(const row of visibility){
  const {case:id,label,player,world}=row,key=id+'/'+label+'/'+player;
  const fog=id.endsWith('-fog'),coop=id.includes('coop'),viewer=typeof player==='number'?player:Number(player.slice(1));
  check(1,key+'/recipient-contract',{fog,coop,viewer},{fog:world.fog,coop:world.coop,viewer:world.viewer});
  check(1,key+'/dimensions',id.startsWith('source-')?[13,9]:[14,14],[world.cells.length,world.cells[0].length]);
  check(1,key+'/roles',coop?['NEUTRAL','HUMAN','HUMAN','DEMONS']:(id.startsWith('source-')?['NEUTRAL','HUMAN','HUMAN','HUMAN']:['NEUTRAL','HUMAN','HUMAN']),world.players.map(p=>p.role));
  check(1,key+'/player-indices',world.players.map((_,i)=>i),world.players.map(p=>p.index));
  const occupied=new Set();
  for(const p of world.players)for(const u of p.units){const k=u.x+','+u.y;assert(!occupied.has(k),'duplicate-fog-unit');occupied.add(k);
   check(1,key+'/unit/'+k,u.name,world.cells[u.x][u.y].unit);
  }
  const mask=expectedMask(world);
  for(const [name,value] of [['world',world.visible],['observed',row.observed],['declared',row.expected]])check(1,key+'/'+name,mask,value);
  check(1,key+'/provider-checkpoint',mask,observed(id+(id.startsWith('source-')?'/recipient-'+player:'/'+label+'/'+player+'/visibility')));
  if(id.startsWith('source-'))continue;
  const prior=previous.get(id+'/'+player),delta={revealed:[],hidden:[]};
  if(prior)for(let x=0;x<mask.length;x++)for(let y=0;y<mask[x].length;y++){
   if(mask[x][y]&&!prior[x][y])delta.revealed.push([x,y]);if(!mask[x][y]&&prior[x][y])delta.hidden.push([x,y]);
  }
  previous.set(id+'/'+player,mask);check(2,key+'/visibility-delta',delta,row.delta);
  const s=world.selection;check(2,key+'/live-selection',true,s===null||(!s.killed&&s.onGrid&&mask[s.x][s.y]));
 }
 for(const id of SOURCE.filter(id=>id.endsWith('-fog'))){
  const rows=visibility.filter(r=>r.case===id);
  check(1,id+'/sharing-policy',id.includes('coop'),JSON.stringify(rows[0].observed)===JSON.stringify(rows[1].observed));
 }
 for(const id of BROWSER){
  const get=(label,p='p1')=>visibility.find(r=>r.case===id&&r.label===label&&r.player===p),cell=(label,x,y,p)=>get(label,p).world.cells[x][y];
  for(const owner of [1,2,3])check(owner,id+'/AC'+owner+'/participants',2,observed(id+'/participants'));
  const joins=traces[id].filter(r=>r.stage==='api-join');
  check(1,id+'/distinct-live-slots',[1,2],joins.map(r=>r.board.whooseTurn).sort());
  check(1,id+'/join-identities',[0,1],joins.map(r=>r.identity).sort());
  const fixture=traces[id].filter(r=>r.stage==='admission-assignments');assert.equal(fixture.length,1,'missing-fog-assignments');
  check(1,id+'/persistent-slots',[1,2],fixture[0].assignments.map(r=>r.slot).sort());
  check(1,id+'/persistent-identities',[true,true],fixture[0].assignments.map(r=>r.matches));
  const facts=[['initial',1,6,'unit','noob'],['initial',1,7,'unit',undefined],['movement',1,6,'unit',undefined],['movement',1,7,'unit','noob'],['initial',5,3,'unit','noob'],['combat-death',5,3,'unit',undefined],['initial',7,3,'owner',0],['capture',7,3,'building','town'],['capture',7,3,'owner',1],['initial',9,8,'unit',undefined],['production',9,8,'unit','noob','p2']];
  for(const [stage,x,y,field,value,p] of facts)check(2,id+'/'+stage+'/'+x+','+y+'/'+field,value??null,cell(stage,x,y,p)[field]??null);
  for(const label of ['move scout','lethal combat','capture town','commit visibility actions','commit peer and automatic phase'])check(2,id+'/mouse/'+label,true,inputs[id].some(r=>r.label===label&&r.via==='mouse.click'));
  const turns=traces[id].filter(r=>r.stage==='outgoing-turn');check(2,id+'/two-commits',2,turns.length);
  const durable=traces[id].filter(r=>r.stage==='durable-round');check(2,id+'/one-durable-round',1,durable.length);check(2,id+'/durable-round-number',1,durable[0].stored.gameRound);
  for(const p of ['p1','p2'])check(2,id+'/'+p+'/death-not-retained',null,cell('round',5,3,p).unit??null);
  if(id==='coop-fog'){
   check(2,id+'/scout-reveals-enemy',true,get('movement').delta.revealed.some(([x,y])=>x===1&&y===10));
   check(2,id+'/raze-hides-enemy',true,get('round').delta.hidden.some(([x,y])=>x===3&&y===4));
   check(2,id+'/town-razed',null,cell('round',4,5).building??null);
   check(2,id+'/doomed-selection-observed',true,observed(id+'/doomed-selection'));
   check(2,id+'/destroyed-selection-cleared',null,get('round').world.selection);
  }
  for(const stage of ['stale','reconnect']){
   // Separate public facts from recipient-only visibility and selection.
   check(3,id+'/'+stage+'/public-world',get('round').world.cells,get(stage).world.cells);
   check(3,id+'/'+stage+'/asset-world',get('round').world.players,get(stage).world.players);
   check(3,id+'/'+stage+'/mask',expectedMask(get('round').world),get(stage).world.visible);
   check(3,id+'/'+stage+'/selection',null,get(stage).world.selection);
  }
  const replay=traces[id].filter(r=>r.stage==='stale-receipt-replay'),deliver=traces[id].filter(r=>r.stage==='stale-receipt-delivered');
  check(3,id+'/replay-count',1,replay.length);check(3,id+'/delivery-count',1,deliver.length);
  const packet=JSON.parse(replay[0].packet.slice(2)),board=JSON.parse(packet[1]);
  check(3,id+'/stale-round',0,board.gameRound);check(3,id+'/actual-stale-delivery',deliver[0].before+1,deliver[0].after);
  check(3,id+'/authentic-stale-receipt',true,traces[id].some(r=>r.stage==='upstream-receipt'&&r.packet===replay[0].packet));
  check(3,id+'/reconnect-input',true,inputs[id].filter(r=>r.label==='reconnect slot'&&r.player==='p1'&&r.via==='mouse.click').length>=2);
  if(id==='coop-fog'){
   check(3,id+'/hidden-enemy-present','noob',cell('reconnect',3,4).unit);
   check(3,id+'/hidden-enemy-invisible',false,get('reconnect').world.visible[3][4]);
   check(3,id+'/hidden-enemy-click',true,inputs[id].some(r=>r.label==='click hidden enemy'&&r.via==='mouse.click'));
   check(3,id+'/hidden-enemy-not-selectable',true,observed(id+'/hidden-enemy-not-selectable'));
  }
 }
 return {checks,caseIds:CASES,criteria:[1,2,3],scope:'Independent recipient visibility, action milestones and stale/reconnect isolation; no G18 whole-match or full audit closure',derivation:'Finite hex-distance relaxation from raw unit/town ownership and terrain. Neutral/demon vision is excluded; competitive vision uses only the recipient and cooperative vision uses human allies. Fixed action coordinates derive from the declared initial scenario and mouse/commit observations. Raw before/after worlds separate public entities from recipient masks; authentic stale packets and delivery counters establish the negative update. This review does not infer coverage from parent PASS flags.'};
}
function review(directory){
 const coverage=A.read(path.join(directory,'coverage-results.json')),manifest=coverage.evidenceHashes,proofs={};
 const file=n=>{A.proofKey(directory,n,manifest);proofs[n]=manifest[n];return path.join(directory,n);};
 const json=n=>A.read(file(n)),lines=n=>fs.readFileSync(file(n),'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
 const v=json('visibility-checkpoints.json'),cp=json('checkpoints.json').checkpoints,traces={},inputs={};
 assert.deepEqual(coverage.cases.map(c=>c.id),CASES,'wrong-fog-cases');
 for(const id of BROWSER){traces[id]=lines(id+'/network-traces.jsonl');inputs[id]=lines(id+'/input-trace.jsonl');json(id+'/declared-fixture.json');}
 const report=analyze(v,cp,traces,inputs);report.proofs=proofs;return report;
}
function rowFor(tasks,report,manifest,number){
 assert([1,2,3].includes(number),'unknown-fog-criterion');const text=tasks.find(t=>t.id==='TASK-212').acceptance_criteria[number-1],ref=n=>({file:n,sha256:manifest[n]});
 return {id:'TASK-212/AC'+number,targetSha256:R.digest(text),reviewer:'Independent fog-world, input and wire review',clauses:[{text,disposition:'reviewed',runTask:'TASK-212',tier:number===1?'source-executed':'natural-browser',caseIds:number===1?CASES:BROWSER,...(number===1?{}:{traces:BROWSER.map(id=>ref(id+'/network-traces.jsonl')),contextIds:BROWSER.map(id=>'fog/'+id+'/AC'+number+'/participants'),milestoneIds:BROWSER.map(id=>'fog/'+id+(number===2?'/one-durable-round':'/actual-stale-delivery'))}),sourceIdentity:ref('source-identities.json'),proofs:[...Object.keys(report.proofs),'fog-independent-review.json'].map(ref),assertions:report.checks.filter(c=>c.owner===number).map(c=>({id:c.id,expected:c.expected,proof:ref('fog-independent-review.json')})),reason:report.scope,derivation:report.derivation,followUp:{scope:'Refresh the bounded fog provider only when its source/proof changes.',acceptance:'Exact independent masks, milestones, real recipients and input/wire proof; no stale certification.',targetMs:1500000,stopWorkMs:3300000,budgetMs:3600000}}]};
}
if(require.main===module)console.log(JSON.stringify(review(path.resolve(process.argv[2])),null,2));
module.exports={expectedMask,analyze,review,rowFor,CASES,BROWSER};
