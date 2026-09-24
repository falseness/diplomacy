// Independent Divided Valley geometry contract. Every measurement is computed
// here from raw cell lists; production generator, repair and path helpers and
// any generator-supplied region labels are never consulted as proof.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const key = c => `${c.x},${c.y}`;
const RULES = {tiny:{baseSide:15,minSide:11,objects:1,portalDistance:6},
  normal:{baseSide:25,minSide:15,objects:2,portalDistance:10},
  big:{baseSide:39,minSide:21,objects:3,portalDistance:14}};
const PATH_DISPARITY = 4;
const ASSETS = {gold:100, towns:1, units:0};

// Odd columns sit half a row lower: even x touches rows y-1..y of adjacent
// columns, odd x touches rows y..y+1.
function neighbours(c) {
  const shift = c.x % 2 ? 0 : -1;
  return [{x:c.x,y:c.y-1},{x:c.x,y:c.y+1},
    ...[-1,1].flatMap(dx=>[0,1].map(dy=>({x:c.x+dx,y:c.y+shift+dy})))];
}
const inside = (map,c) => Number.isInteger(c.x)&&Number.isInteger(c.y)&&c.x>=0&&c.y>=0&&c.x<map.mapSize.x&&c.y<map.mapSize.y;
const chebyshev = (a,b) => Math.max(Math.abs(a.x-b.x),Math.abs(a.y-b.y));
const humans = map => map.players.slice(1,1+map.coop.initialHumanCount);

// Unweighted BFS. blocked cells are never entered; endpoint cells are entered
// (an interaction edge) but never expanded; allowed, when given, limits cells.
function bfs(map, starts, {blocked=new Set(), endpoints=new Set(), allowed=null}={}) {
  const dist = new Map(), queue = [], origin = new Set(starts.map(key));
  for (const s of starts) if (inside(map,s)&&!blocked.has(key(s))&&(!allowed||allowed.has(key(s)))&&!dist.has(key(s))) {
    dist.set(key(s),0); queue.push(s);
  }
  for (let i=0;i<queue.length;i++) {
    const c = queue[i];
    if (!origin.has(key(c)) && endpoints.has(key(c))) continue;
    for (const n of neighbours(c)) {
      const id = key(n);
      if (!inside(map,n)||blocked.has(id)||dist.has(id)||(allowed&&!allowed.has(id))) continue;
      dist.set(id,dist.get(key(c))+1); queue.push(n);
    }
  }
  return dist;
}
function expectedFor(map) {
  const rule = RULES[map.size], h = map.coop.initialHumanCount;
  const side = Math.max(rule.minSide, Math.ceil(rule.baseSide*Math.sqrt(h/4)));
  // TASK-151 supersedes H x multiplier portals: four typed portals per human on every size.
  return {side, humanTowns:h, neutralTowns:h*rule.objects, goldmines:h*rule.objects, portals:4*h,
    portalDistance:rule.portalDistance};
}
// Transit for one human: terrain and allied towns block; hostile (neutral)
// towns and portals are endpoints. Extra blocked cells model passage removal.
function transit(map, index, extra=[]) {
  const blocked = new Set([...map.mountains,...map.lakes,
    ...humans(map).flatMap((p,j)=>j===index?[]:p.towns),...extra].map(key));
  const endpoints = new Set([...map.players[0].towns,...map.portals].map(key));
  return bfs(map,[humans(map)[index].towns[0]],{blocked,endpoints});
}
function freeCells(map) {
  const solid = new Set([...map.mountains,...map.lakes,...map.players.flatMap(p=>p.towns),...map.portals].map(key));
  return c => inside(map,c)&&!solid.has(key(c));
}
function passageCells(p) {
  const cells = [];
  for (let x=p.x[0];x<=p.x[1];x++) for (let y=p.y[0];y<=p.y[1];y++) cells.push({x,y});
  const row = y => cells.filter(c=>c.y===y);
  return {mask:cells, exit:row(p.y[0]), entrance:row(p.y[1]), interior:cells.filter(c=>c.y!==p.y[0]&&c.y!==p.y[1])};
}
// Connected components of an arbitrary cell list, largest first.
function components(cells) {
  const remaining = new Set(cells.map(key)), result = [];
  for (const origin of cells) {
    if (!remaining.delete(key(origin))) continue;
    const queue = [origin];
    for (let i=0;i<queue.length;i++) for (const n of neighbours(queue[i])) if (remaining.delete(key(n))) queue.push(n);
    result.push(queue.map(key));
  }
  return result.sort((a,b)=>b.length-a.length);
}
function reaches(map, cells, from, to) {
  const d = bfs(map, from, {allowed:new Set(cells.map(key))});
  return to.some(c=>d.has(key(c)));
}

const ASSERTIONS = [
  ['dimensions', (map,e) => ({expected:{x:e.side,y:e.side}, observed:map.mapSize,
    pass:map.mapSize.x===e.side&&map.mapSize.y===e.side})],
  ['counts', (map,e) => {
    const observed = {humanTowns:humans(map).length, neutralTowns:map.players[0].towns.length,
      goldmines:map.goldmines.length, portals:map.portals.length};
    const expected = {humanTowns:e.humanTowns, neutralTowns:e.neutralTowns, goldmines:e.goldmines, portals:e.portals};
    return {expected, observed, pass:JSON.stringify(expected)===JSON.stringify(observed)};
  }],
  ['starting-assets', map => {
    const observed = humans(map).map(p=>({gold:p.gold,towns:p.towns.length,units:p.units.length}));
    return {expected:ASSETS, observed, pass:observed.every(o=>JSON.stringify(o)===JSON.stringify(ASSETS))};
  }],
  ['placements-disjoint-in-bounds', map => {
    const all = [...map.players.flatMap(p=>p.towns),...map.portals,...map.goldmines,...map.mountains,...map.lakes,...map.bushes,...map.hills];
    const outside = all.filter(c=>!inside(map,c)), unique = new Set(all.map(key)).size;
    return {expected:{outside:0,duplicates:0}, observed:{cells:all.length,outside:outside.length,duplicates:all.length-unique},
      pass:!outside.length&&unique===all.length};
  }],
  ['town-clearances', map => {
    const towns = map.players.flatMap(p=>p.towns), side = map.mapSize.x;
    const edge = towns.filter(t=>t.x<2||t.y<2||t.x>=side-2||t.y>=side-2);
    const close = towns.flatMap((t,i)=>towns.slice(i+1).filter(u=>chebyshev(t,u)<3).map(u=>[t,u]));
    const crowding = [...map.portals,...map.goldmines,...map.mountains,...map.lakes,...map.bushes,...map.hills]
      .filter(c=>towns.some(t=>chebyshev(t,c)<=1));
    return {expected:{edgeMargin:2,minTownChebyshev:3,objectsInTownNeighbourhoods:0},
      observed:{edgeViolations:edge,closeTownPairs:close,objectsInTownNeighbourhoods:crowding},
      pass:!edge.length&&!close.length&&!crowding.length};
  }],
  ['terrain-components', map => {
    const solid = new Set([...map.mountains,...map.lakes].map(key)), walk = [], terrain = [];
    for (let x=0;x<map.mapSize.x;x++) for (let y=0;y<map.mapSize.y;y++) (solid.has(key({x,y}))?terrain:walk).push({x,y});
    const walkable = components(walk), blockers = components(terrain);
    const owner = new Map(walkable.flatMap((cells,i)=>cells.map(id=>[id,i])));
    const humanComponents = [...new Set(humans(map).map(p=>owner.get(key(p.towns[0]))))];
    return {expected:{humanTownWalkableComponents:1},
      observed:{walkableComponentSizes:walkable.map(c=>c.length), terrainComponentSizes:blockers.map(c=>c.length), humanComponents},
      pass:humanComponents.length===1&&humanComponents[0]!==undefined};
  }],
  ['portal-hex-distance', (map,e) => {
    const matrix = humans(map).map(p=>{const d=bfs(map,[p.towns[0]]);return map.portals.map(q=>d.get(key(q)));});
    const minimum = Math.min(...matrix.flat());
    return {expected:{minimum:e.portalDistance}, observed:{minimum,matrix}, pass:minimum>=e.portalDistance};
  }],
  ['route-connectivity', map => {
    const targets = {portals:map.portals, neutralTowns:map.players[0].towns, goldmines:map.goldmines};
    const observed = humans(map).map((_,i)=>{const d=transit(map,i);
      return Object.fromEntries(Object.entries(targets).map(([k,v])=>[k,v.map(c=>d.has(key(c)))]));});
    return {expected:'every human reaches every portal, neutral town and goldmine', observed,
      pass:observed.every(r=>Object.values(r).every(v=>v.every(Boolean)))};
  }],
  ['main-passage-cut-resilience', map => {
    const free = freeCells(map);
    const observed = map.valley.passages.map(p=>{
      const s = passageCells(p), walk = s.mask.filter(free), entrance = s.entrance.filter(free), exit = s.exit.filter(free);
      const interior = s.interior.filter(free);
      const cuts = interior.filter(cut=>!reaches(map,walk.filter(c=>key(c)!==key(cut)),entrance,exit)).map(key);
      return {name:p.name, maskCells:s.mask.length, blockedMaskCells:s.mask.filter(c=>!free(c)).map(key),
        entranceCells:entrance.length, exitCells:exit.length, connected:reaches(map,walk,entrance,exit),
        singleCutsTested:interior.length, disconnectingCuts:cuts};
    });
    return {expected:{entranceCells:'>=2',exitCells:'>=2',connected:true,disconnectingCuts:[]}, observed,
      pass:observed.length>0&&observed.every(o=>o.entranceCells>=2&&o.exitCells>=2&&o.connected&&!o.disconnectingCuts.length)};
  }],
  ['advance-passages', map => {
    const adv = map.valley.passages.filter(p=>p.kind==='advance').map(p=>({p,s:passageCells(p)}));
    const overlaps = adv.flatMap((a,i)=>adv.slice(i+1).filter(b=>b.s.mask.some(c=>a.s.mask.some(d=>key(d)===key(c)))).map(b=>[a.p.name,b.p.name]));
    // Each passage alone must carry every human to every portal.
    const alone = adv.map(a=>{
      const cut = adv.filter(b=>b!==a).flatMap(b=>b.s.interior);
      return {name:a.p.name, humansReachAllPortals:humans(map).map((_,i)=>{const d=transit(map,i,cut);return map.portals.every(q=>d.has(key(q)));})};
    });
    return {expected:{advancePassages:'>=2',overlaps:[],eachAloneSufficient:true},
      observed:{advancePassages:adv.length,overlaps,alone},
      pass:adv.length>=2&&!overlaps.length&&alone.every(a=>a.humansReachAllPortals.every(Boolean))};
  }],
  ['valley-divide', map => {
    const cut = map.valley.passages.filter(p=>p.kind==='advance').flatMap(p=>passageCells(p).interior);
    const observed = humans(map).map((_,i)=>{const d=transit(map,i,cut);return map.portals.filter(q=>d.has(key(q))).length;});
    return {expected:{portalsReachableWithoutAdvancePassages:0}, observed, pass:observed.every(n=>n===0)};
  }],
  ['lateral-connections', map => {
    const free = freeCells(map), adv = map.valley.passages.filter(p=>p.kind==='advance').map(passageCells);
    const observed = ['rear','forward'].map(side=>{
      const laterals = map.valley.laterals.filter(l=>l.side===side);
      const ends = adv.map(s=>(side==='rear'?s.entrance:s.exit).filter(free));
      const cells = [...laterals.flatMap(passageCells).flatMap(s=>s.mask),...ends.flat()].filter(free);
      const joined = ends.slice(1).map(e=>reaches(map,cells,ends[0],e));
      return {side, laterals:laterals.length, walkableCells:cells.length, joinsAdvancePassages:joined};
    });
    return {expected:{rear:true,forward:true}, observed,
      pass:observed.every(o=>o.laterals>0&&o.joinsAdvancePassages.length>0&&o.joinsAdvancePassages.every(Boolean))};
  }],
  ['portal-approach', map => {
    const free = freeCells(map), reach = humans(map).map((_,i)=>transit(map,i));
    const observed = map.portals.map(p=>{
      const cells = neighbours(p).filter(free).filter(c=>reach.every(d=>d.has(key(c))));
      return {portal:key(p), approachCells:cells.map(key)};
    });
    return {expected:{approachCellsPerPortal:'>=2 connected to every human'}, observed,
      pass:observed.every(o=>o.approachCells.length>=2)};
  }],
  ['starting-access-fairness', map => {
    const groups = {goldmines:map.goldmines, neutralTowns:map.players[0].towns, portals:map.portals};
    const nearest = humans(map).map((_,i)=>{const d=transit(map,i);
      return Object.fromEntries(Object.entries(groups).map(([k,v])=>[k,Math.min(...v.filter(c=>d.has(key(c))).map(c=>d.get(key(c))))]));});
    const disparity = Object.fromEntries(Object.keys(groups).map(k=>{const v=nearest.map(n=>n[k]);
      return [k, v.every(Number.isFinite)?Math.max(...v)-Math.min(...v):null];}));
    return {expected:{maxDisparity:PATH_DISPARITY}, observed:{nearest,disparity},
      pass:Object.values(disparity).every(v=>v!==null&&v<=PATH_DISPARITY)};
  }]
];

// Contract order is fixed; a map is rejected by its first failing assertion.
// Callers may supply independently declared current quotas/dimensions; defaults
// preserve the authored four-category legacy contract fixtures.
function verifyValley(map, expected = expectedFor(map)) {
  const e = expected, results = [];
  for (const [name,check] of ASSERTIONS) {
    let r; try { r = check(map,e); } catch (error) { r = {pass:false, error:error.message}; }
    results.push({name,...r});
  }
  const failed = results.filter(r=>!r.pass).map(r=>r.name);
  return {valid:!failed.length, rejectedBy:failed[0]||null, failed, results};
}

// Legend: . free, M mountain, L lake, B bush, 1-9 human start (player index),
// N neutral town, G goldmine, P portal. Rows are y, columns are x.
function parseFixture(spec) {
  const map = {name:spec.name, size:spec.size, mapSize:{x:spec.rows[0].length,y:spec.rows.length},
    coop:{initialHumanCount:spec.humans}, goldmines:[], portals:[], mountains:[], lakes:[], bushes:[], hills:[],
    players:[{towns:[],units:[],gold:0},...Array.from({length:spec.humans},()=>({towns:[],units:[],gold:100}))],
    valley:{passages:spec.passages, laterals:spec.laterals}, claimedLabels:spec.claimedLabels};
  spec.rows.forEach((row,y)=>[...row].forEach((ch,x)=>{
    const c = {x,y};
    if (/[1-9]/.test(ch)) map.players[Number(ch)].towns.push(c);
    else ({N:map.players[0].towns,G:map.goldmines,P:map.portals,M:map.mountains,L:map.lakes,B:map.bushes})[ch]?.push(c);
  }));
  return map;
}
const LABELS = {regionsConnected:true, passagesValid:true, portalsApproachable:true, fair:true};
const FIXTURES = [
  // Four typed portals per human (TASK-151): eight portals for two humans.
  {name:'tiny-H2-valley', size:'tiny', humans:2, claimedLabels:LABELS, rows:[
    'P.P.P.P.P.P',
    '....PP.....',
    '..N.....N..',
    '...........',
    'M..MLLM..MM',
    'L..MMLM..LM',
    '...........',
    '..1.....2..',
    'B....B....B',
    '...........',
    '..G.....G..'],
    passages:[{name:'west-advance',kind:'advance',x:[1,2],y:[3,6]},{name:'east-advance',kind:'advance',x:[7,8],y:[3,6]}],
    laterals:[{name:'rear-lateral',side:'rear',x:[1,8],y:[6,6]},{name:'forward-lateral',side:'forward',x:[1,8],y:[3,3]}]},
  {name:'normal-H2-valley', size:'normal', humans:2, claimedLabels:LABELS, rows:[
    '...P..P....P..P...',
    '.P.....P.P.....P..',
    '..................',
    '..N.......N.......',
    '......N.......N...',
    '..................',
    '..................',
    'MMM..MMLLMM..MMMLL',
    'MLL..LMMMLL..LMMML',
    'MMM..MMLLMM..MMMLL',
    '..................',
    '..................',
    'B................B',
    '....1.......2.....',
    '........B.........',
    '..G.......G.......',
    '......G.......G...',
    '..................'],
    passages:[{name:'west-advance',kind:'advance',x:[3,4],y:[6,10]},{name:'east-advance',kind:'advance',x:[11,12],y:[6,10]}],
    laterals:[{name:'rear-lateral',side:'rear',x:[3,12],y:[10,10]},{name:'forward-lateral',side:'forward',x:[3,12],y:[6,6]}]}
];
const move = (list,from,to) => { const c = list.find(c=>key(c)===key(from)); c.x=to.x; c.y=to.y; };
// Each corruption keeps the generator-style labels claiming validity.
const CORRUPTIONS = {
  'disconnected-route': {base:'normal-H2-valley', assertion:'route-connectivity',
    detail:'lakes enclose goldmine 6,16', apply:m=>m.lakes.push(...neighbours({x:6,y:16}).filter(c=>inside(m,c)))},
  'narrow-passage': {base:'tiny-H2-valley', assertion:'main-passage-cut-resilience',
    detail:'mountain at 1,4 leaves west passage one cell wide at row 4', apply:m=>m.mountains.push({x:1,y:4})},
  'portal-approach': {base:'tiny-H2-valley', assertion:'portal-approach',
    detail:'lakes at 1,0 and 3,0 leave portal 2,0 one approach cell', apply:m=>m.lakes.push({x:1,y:0},{x:3,y:0})},
  'unfair-access': {base:'normal-H2-valley', assertion:'starting-access-fairness',
    detail:'goldmines 10,15, 14,16 and 6,16 moved to west edge 0,15, 0,17 and 1,10',
    apply:m=>{move(m.goldmines,{x:10,y:15},{x:0,y:15}); move(m.goldmines,{x:14,y:16},{x:0,y:17}); move(m.goldmines,{x:6,y:16},{x:1,y:10});}}
};
function corrupted(name) {
  const c = CORRUPTIONS[name], m = parseFixture(FIXTURES.find(f=>f.name===c.base));
  c.apply(m); return m;
}
module.exports = {verifyValley, neighbours, bfs, parseFixture, FIXTURES, CORRUPTIONS, RULES, ASSERTIONS:ASSERTIONS.map(a=>a[0])};

if (require.main === module) {
  const arg = n => { const i = process.argv.indexOf(n); return i<0 ? undefined : process.argv[i+1]; };
  const out = path.resolve(arg('--output-dir') || 'artifacts/TASK-134'), fault = arg('--fault');
  if (fault!==undefined && !CORRUPTIONS[fault]) { console.error('Unknown --fault '+fault+'; expected '+Object.keys(CORRUPTIONS).join(', ')); process.exit(2); }
  fs.mkdirSync(out,{recursive:true});
  const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
  fs.writeFileSync(path.join(out,'source-identities.json'), JSON.stringify({node:process.version,
    files:{[path.relative(process.cwd(),__filename)]:sha(__filename)}},null,2)+'\n');
  const summary = r => r.results.map(x=>`${x.pass?'PASS':'FAIL'} ${x.name}`).join('\n');
  if (fault) {
    const c = CORRUPTIONS[fault], r = verifyValley(corrupted(fault));
    console.log(`FAULT ${fault} base=${c.base} ${c.detail}`); console.log(summary(r));
    fs.writeFileSync(path.join(out,'checkpoints.json'), JSON.stringify({mode:'fault',fault,base:c.base,detail:c.detail,
      intendedAssertion:c.assertion,claimedLabels:LABELS,...r},null,2)+'\n');
    if (r.valid) { console.log('UNEXPECTED fault accepted '+fault); process.exit(3); }
    console.log(`REJECTED ${fault} by=${r.rejectedBy} intended=${c.assertion} failed=${r.failed.join(',')}`);
    process.exit(r.rejectedBy===c.assertion ? 1 : 4);
  }
  const positives = FIXTURES.map(spec=>{ const r = verifyValley(parseFixture(spec));
    console.log(`CASE ${spec.name}`); console.log(summary(r));
    return {case:spec.name, expectedValid:true, ...r}; });
  const negatives = Object.entries(CORRUPTIONS).map(([name,c])=>{ const r = verifyValley(corrupted(name));
    const ok = !r.valid && r.rejectedBy===c.assertion && r.failed.length===1;
    console.log(`${ok?'PASS':'FAIL'} corruption ${name} base=${c.base} rejectedBy=${r.rejectedBy} intended=${c.assertion} failed=${r.failed.join(',')}`);
    return {case:name, base:c.base, detail:c.detail, intendedAssertion:c.assertion, expectedValid:false, isolated:ok, ...r}; });
  fs.writeFileSync(path.join(out,'fixtures.json'), JSON.stringify({legend:'. free, M mountain, L lake, B bush, digit human start, N neutral town, G goldmine, P portal; rows=y columns=x',
    fixtures:FIXTURES.map(spec=>({...spec, map:parseFixture(spec)})),
    corruptions:Object.entries(CORRUPTIONS).map(([name,c])=>({name,base:c.base,detail:c.detail,intendedAssertion:c.assertion,map:corrupted(name)}))},null,2)+'\n');
  fs.writeFileSync(path.join(out,'checkpoints.json'), JSON.stringify({mode:'positive',assertionOrder:ASSERTIONS.map(a=>a[0]),
    rules:RULES,pathDisparity:PATH_DISPARITY,startingAssets:ASSETS,positives,negatives},null,2)+'\n');
  const bad = positives.filter(p=>!p.valid).length + negatives.filter(n=>!n.isolated).length;
  console.log(`${bad?'FAIL':'PASS'} valley-contract positives=${positives.filter(p=>p.valid).length}/${positives.length} corruptions=${negatives.filter(n=>n.isolated).length}/${negatives.length}`);
  process.exit(bad?1:0);
}
