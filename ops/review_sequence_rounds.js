'use strict';
// Independent bounded round oracle. Inputs are immutable observations, never the
// archived expected/pass fields or production merge/economy/pathfinding functions.
const assert=require('node:assert/strict');
const O=require('/root/diplomacy_server/tests/reliability/helpers/observations');
const distance=(a,b)=>{const z=p=>p.y-(p.x-(p.x&1))/2;return Math.max(Math.abs(a.x-b.x),Math.abs(z(a)-z(b)),Math.abs(a.x+z(a)-b.x-z(b)));};
function occupancy(game){
 const grid=game.ownership.map(col=>col.map(()=>null));
 for(const p of game.players)for(const u of p.units){
  assert(Number.isInteger(u.x)&&Number.isInteger(u.y)&&grid[u.x]&&u.y>=0&&u.y<grid[u.x].length,'sequence-unit-out-of-grid');
  assert.equal(grid[u.x][u.y],null,'sequence-duplicate-occupancy');grid[u.x][u.y]={owner:p.index,name:u.name};
 }
 return grid;
}
function components(game){
 const fields=[1,2].map(slot=>{
  const cells=new Set();game.ownership.forEach((col,x)=>col.forEach((owner,y)=>{
   if(owner===slot||game.players[slot].units.some(u=>game.ownership[u.x][u.y]===slot&&distance(u,{x,y})<=2))cells.add(x+','+y);
  }));return cells;
 });
 return [...fields[0]].some(c=>fields[1].has(c))?[[1,2]]:[[1],[2]];
}
function reviewRounds({c,journal,actions,wire,cp,ck}){
 const coop=c.mode==='coop',one=(rows,id)=>{assert.equal(rows.length,1,'sequence-record:'+id);return rows[0];};
 const moves=actions.filter(r=>(r.stage||r.action)==='move');
 const before=r=>coop?r.before.game:O.localGameplay(r.before),after=r=>coop?r.after.game:O.localGameplay(r.after);
 const firstBoard=O.packetBoard(wire[0]);
 // These trajectories have one noob and a seven-cell town per human, no
 // buildings or owned goldmines. Neutral co-op has two one-cell towns.
 for(const slot of [1,2]){
  const p=firstBoard.players[slot];
  ck('economy-roster/'+slot,[1,1,'noob'],[p.units.length,p.towns.length,p.units[0].name]);
  ck('economy-town/'+slot,[7,0],[p.towns[0].suburbs.filter(s=>s.isSuburb&&firstBoard.grid[s.x][s.y]===slot).length,p.towns[0].buildings.length]);
  ck('economy-mines/'+slot,0,firstBoard.goldmines.filter(g=>firstBoard.grid[g.coord.x][g.coord.y]===slot).length);
 }
 if(coop){
  ck('neutral-towns',[1,1],firstBoard.players[0].towns.map(t=>t.suburbs.filter(s=>s.isSuburb&&firstBoard.grid[s.x][s.y]===0).length));
  ck('neutral-buildings',[[],[]],firstBoard.players[0].towns.map(t=>t.buildings));
  ck('passive-rosters',[[],[]],[firstBoard.players[0].units,firstBoard.players[3].units]);
 }
 const income=4+7-1,baseGold=coop?100:1000;
 let prior;
 for(let round=0;round<2;round++){
  const pair=moves.slice(round*2,round*2+2),merged=structuredClone(before(pair[0]));
  ck('round-move-slots/'+round,[1,2],pair.map(r=>r.slot||r.before.controls.slot));
  if(prior)ck('next-round-continuity/'+round,prior,merged);
  for(const [i,m] of pair.entries()){
   const slot=i+1,b=before(m);
   ck('activation-income/'+round+'/'+slot,baseGold+(round+1)*income,b.players[slot].gold);
   ck('activation-noob/'+round+'/'+slot,[['noob',2,2]],b.players[slot].units.map(u=>[u.name,u.hp,u.moves]));
   if(coop&&slot===2){const expected=structuredClone(after(pair[0]));expected.players[2].gold+=income;expected.players[2].units.forEach(u=>u.moves=2);ck('sequential-activation/'+round,expected,b);}
   merged.players[slot]=structuredClone(after(m).players[slot]);
  }
  merged.gameRound=round+1;
  if(coop)merged.players[0].gold+=2*(4+1);
  const next=coop?[[1,2]]:components(merged),eligible=next.map(g=>g[0]);
  if(coop){
   const phase=one(journal.filter(r=>r.stage==='round-phase'&&r.round===round),'phase');
   ck('canonical-round/'+round,merged,phase.board);ck('round-count/'+round,round+2,phase.roundCount);
  }else{
   const stored=journal.filter(r=>r.stage==='round-persisted')[round].stored;
   ck('canonical-round/'+round,merged,O.sharedGameplay(stored.rounds[round+1][0].parallelTurnResult));
   ck('round-count/'+round,round+2,stored.rounds.length);
   ck('round-components/'+round,next,stored.rounds[round+1].slice(1).map(g=>g.turns.map(t=>t.playerIndex)));
  }
  for(const slot of eligible){merged.players[slot].gold+=income;merged.players[slot].units.forEach(u=>u.moves=2);}
  for(const slot of [1,2]){
   const receipt=one(journal.filter(r=>coop?r.stage==='round-complete'&&r.state.controls.slot===slot&&r.state.game.gameRound===round+1:r.stage==='round-received'&&r.slot===slot&&r.state.gameRound===round+1),'receipt');
   const state=receipt.state;
   ck('whole-recipient/'+round+'/'+slot,merged,coop?state.game:O.localGameplay(state));
   ck('recipient-context/'+round+'/'+slot,[slot,!eligible.includes(slot),c.fog,true,2],coop?[state.controls.slot,state.controls.waiting,state.opening.fog,state.opening.socketConnected,state.opening.lobby.occupiedHumans]:[state.whooseTurn,state.waiting,state.fog,state.socket.connected,state.lobby.occupiedHumans]);
   let observed;
   if(coop){
    const marker=`coop:${receipt.player}:r${round+1}:round-complete:broadcast-exact-all-assets`;
    const index=cp.findIndex(r=>r.id===marker);assert(index>=0,'sequence-missing-occupancy-anchor');
    assert.equal(cp[index-1]?.id,receipt.player+':exact-grid-occupancy','sequence-missing-adjacent-occupancy');
    observed=cp[index-1].observed;
    const broadcast=one(journal.filter(r=>r.stage==='broadcast'&&r.observation==='round-complete'&&r.player===receipt.player&&O.packetBoard(r.packet)?.gameRound===round+1),'broadcast');
    ck('recipient-wire/'+round+'/'+slot,merged,O.sharedGameplay(O.packetBoard(broadcast.packet)));
   }else observed=one(cp.filter(r=>r.id.endsWith(`:r${round}:${slot}:round-receipt-live-occupancy`)),'occupancy').observed;
   ck('recipient-occupancy/'+round+'/'+slot,occupancy(merged),observed);
  }
  prior=merged;
 }
}
module.exports={reviewRounds,occupancy,components};
