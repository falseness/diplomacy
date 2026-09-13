const colors = [{r:255,g:0,b:0}, {r:98,g:168,b:222},
  {r:60,g:190,b:100}, {r:230,g:170,b:40}];
// Independent integer arithmetic for the specified LCG, including seed zero.
function towns(count, seed) {
  let state = BigInt(seed || 0x9e3779b9);
  return Array.from({length: count}, (_, i) => {
    state = (1664525n * state + 1013904223n) % 4294967296n;
    return {x: 3 + i * 6, y: 2 + Number(state * 5n / 4294967296n)};
  });
}
function expectedMap(count, seed) {
  const starts = towns(count, seed);
  const map = {mapSize: {x:count*6+1,y:9}, players: [
    {rgb:{r:208,g:208,b:208},towns:[],units:[],gold:0},
    ...starts.map((t,i) => ({rgb:colors[i],gold:100,units:[],towns:[t]})),
    {rgb:{r:160,g:40,b:180},units:[],towns:[],gold:0,economyEnabled:false}],
    goldmines:[],lakes:[],mountains:[],bushes:[],hills:[],mapShape:{type:'rectangular'},
    coop:{initialHumanCount:count,humanSlots:Array.from({length:count},(_,i)=>i+1),
      humanTeam:'HUMANS',demonSlot:count+1,
      generation:{version:1,playerCount:count,seed,options:{seed}}}};
  addTerrain(map, count, seed);
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
  map.players[0].towns = Array.from({length:count},(_,i)=>({x:6+i*6,y:7}));
  const reserved = new Set();
  for (const p of map.players) for (const t of p.towns)
    for (let dx=-1;dx<=1;dx++) for(let dy=-1;dy<=1;dy++)
      reserved.add(`${t.x+dx},${t.y+dy}`);
  const cells = Array.from({length:map.mapSize.x*9},(_,i)=>({x:Math.floor(i/9),y:i%9}))
    .filter(c=>!reserved.has(`${c.x},${c.y}`));
  for(let remaining=cells.length;remaining>1;remaining--) {
    const index=next(remaining), last=cells[remaining-1];
    cells[remaining-1]=cells[index]; cells[index]=last;
  }
  for(const [i,key] of ['goldmines','lakes','mountains','bushes'].entries())
    map[key]=cells.slice(i*count,(i+1)*count).map(c=>key==='goldmines'?{...c,owner:0,income:20}:c);
}
function initialEntities(map) {
  return [
    ...map.players.flatMap((p,owner)=>p.towns.flatMap((t,i)=>[
      {...t,id:`town-${owner}-${i}`,kind:'town',name:'town',owner},
      ...(owner ? [{...t,id:`unit-${owner}-${i}`,kind:'unit',name:'noob',owner}] : [])])),
    ...['goldmines','lakes','mountains','bushes'].flatMap(key=>map[key].map((c,i)=>({
      x:c.x,y:c.y,id:`${key}-${i}`,kind:key==='goldmines'?'goldmine':'nature',
      name:{goldmines:'goldmine',lakes:'lake',mountains:'mountain',bushes:'bush'}[key],owner:0})))
  ];
}
module.exports = {expectedMap, initialEntities};
