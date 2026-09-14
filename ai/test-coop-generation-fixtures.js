const colors = [{r:255,g:0,b:0}, {r:98,g:168,b:222},
  {r:60,g:190,b:100}, {r:230,g:170,b:40},
  {r:0,g:110,b:120}, {r:245,g:120,b:180}, {r:100,g:70,b:210}, {r:135,g:80,b:35},
  {r:170,g:200,b:40}, {r:20,g:55,b:125}, {r:255,g:110,b:0}, {r:80,g:80,b:80}];
// Independent integer arithmetic for the specified LCG, including seed zero.
function towns(count, seed, size = 'normal') {
  const side = {tiny:15,normal:25,big:39}[size];
  let state = BigInt(seed || 0x9e3779b9);
  return Array.from({length: count}, (_, i) => {
    state = (1664525n * state + 1013904223n) % 4294967296n;
    return {x: Math.max(2, Math.min(side-3, Math.floor((2*i+1)*(side-1)/(2*count)))), y: 2 + Number(state * 5n / 4294967296n)};
  });
}
function expectedMap(count, seed, size = 'normal') {
  const starts = towns(count, seed, size);
  const side = {tiny:15,normal:25,big:39}[size];
  const map = {mapSize: {x:side,y:side}, players: [
    {rgb:{r:208,g:208,b:208},towns:[],units:[],gold:0},
    ...starts.map((t,i) => ({rgb:colors[i],gold:100,units:[],towns:[t]})),
    {rgb:{r:160,g:40,b:180},units:[],towns:[],gold:0,economyEnabled:false}],
    goldmines:[],lakes:[],mountains:[],bushes:[],hills:[],mapShape:{type:'rectangular'},
    coop:{initialHumanCount:count,humanSlots:Array.from({length:count},(_,i)=>i+1),
      humanTeam:'HUMANS',demonSlot:count+1,
      generation:{version:2,playerCount:count,seed,size,options:{seed,size}}}};
  addTerrain(map, count, seed);
  // Independent evaluator uses literal task bounds, never production helpers.
  const {evaluateBalance, balanced} = require('./test-coop-balance-evaluator');
  if (!balanced(evaluateBalance(map))) {
    map.goldmines = starts.map(t=>({x:t.x,y:0,owner:0,income:20}));
    map.portals = starts.map(t=>({x:t.x,y:map.mapSize.y-1}));
    map.lakes = starts.map(t=>({x:t.x-2,y:0}));
    map.mountains = starts.map(t=>({x:t.x-1,y:map.mapSize.y-1}));
    map.bushes = starts.map(t=>({x:t.x-1,y:map.mapSize.y-5}));
  }
  return map;
}

// Independent BigInt stream and reserved-cell set; never reads generated output.
function addTerrain(map, count, seed) {
  let state = BigInt(seed || 0x9e3779b9);
  const next = n => {
    state = (state * 1664525n + 1013904223n) % (2n ** 32n);
    return Number(state * BigInt(n) / (2n ** 32n));
  };
  for (let i=0;i<count;i++) next(5); // Human start draws precede terrain.
  map.players[0].towns = Array.from({length:count},(_,i)=>({x:map.players[i+1].towns[0].x,y:map.mapSize.y-3}));
  const reserved = new Set();
  for (const p of map.players) for (const t of p.towns)
    for (let dx=-1;dx<=1;dx++) for(let dy=-1;dy<=1;dy++)
      reserved.add(`${t.x+dx},${t.y+dy}`);
  const cells = Array.from({length:map.mapSize.x*map.mapSize.y},(_,i)=>({x:Math.floor(i/map.mapSize.y),y:i%map.mapSize.y}))
    .filter(c=>!reserved.has(`${c.x},${c.y}`));
  for(let remaining=cells.length;remaining>1;remaining--) {
    const index=next(remaining), last=cells[remaining-1];
    cells[remaining-1]=cells[index]; cells[index]=last;
  }
  for(const [i,key] of ['goldmines','lakes','mountains','bushes'].entries())
    map[key]=cells.slice(i*count,(i+1)*count).map(c=>key==='goldmines'?{...c,owner:0,income:20}:c);
  map.portals = cells.slice(4*count,5*count);
}
function initialEntities(map) {
  return [
    ...map.portals.map((c,i)=>({...c,id:`portal-${i}`,kind:'portal',name:'demonPortal',owner:map.coop.demonSlot})),
    ...map.players.flatMap((p,owner)=>p.towns.flatMap((t,i)=>[
      {...t,id:`town-${owner}-${i}`,kind:'town',name:'town',owner},
      ...(owner ? [{...t,id:`unit-${owner}-${i}`,kind:'unit',name:'noob',owner}] : [])])),
    ...['goldmines','lakes','mountains','bushes'].flatMap(key=>map[key].map((c,i)=>({
      x:c.x,y:c.y,id:`${key}-${i}`,kind:key==='goldmines'?'goldmine':'nature',
      name:{goldmines:'goldmine',lakes:'lake',mountains:'mountain',bushes:'bush'}[key],owner:0})))
  ];
}
module.exports = {expectedMap, initialEntities};
