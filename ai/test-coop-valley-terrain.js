// Divided Valley ridge, lake and bush formations. Layouts come from
// ai/coop-valley-plan.js; ridge, reservations, clusters, densities, passage
// widths, connectivity, reachability, single-front routes and fairness are
// re-measured here with the TASK-134 contract BFS and its full verifyValley.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const plan = require('./coop-valley-plan.js');
const {bfs, neighbours, verifyValley} = require('./test-coop-valley-contract.js');
const {getCoopMapScaling} = require('./coop-map-scaling.js');
const ROOT = path.join(__dirname, '..');
const key = c => `${c.x},${c.y}`;
const ALL_SIZES = ['tiny','normal','big'], ALL_HUMANS = Array.from({length:12},(_,i)=>i+1);
const SEEDS = [0,1,31,4294967295];
const SOURCES = ['ai/coop-valley-plan.js','ai/test-coop-valley-terrain.js','ai/test-coop-valley-contract.js','ai/coop-map-scaling.js','ai/generateMap.js'];
const DISPARITY = 4, MIN_APPROACH = 2, MIN_COMPONENT = 3, MULTI_CELL_SHARE = 0.8, DENSITY_TOLERANCE = 0.02;
const SHARES = {mountains:0.08, lakes:0.06, bushes:0.10};
const FAULTS = {'erase-ridge':'ridge-formation', 'block-lateral':'reservations', 'scatter-lakes':'terrain-clusters'};
const MODELS = {mineEndpoints:'neutral towns, mines and portals are endpoints', walkableMines:'neutral towns and portals are endpoints; mines walkable (TASK-134 contract)'};
const chebyshev = (a,b) => Math.max(Math.abs(a.x-b.x),Math.abs(a.y-b.y));
const sha = text => crypto.createHash('sha256').update(text).digest('hex');
const same = (a,b) => JSON.stringify(a)===JSON.stringify(b);
const spread = v => v.every(Number.isFinite) ? Math.max(...v)-Math.min(...v) : null;
const colorSource = fs.readFileSync(path.join(ROOT,'ai/generateMap.js'),'utf8').match(/function coopPlayerColor\(playerIndex\) \{[\s\S]*?\n\}\n/)[0];
const coopPlayerColor = vm.runInNewContext('('+colorSource+')');

function cellsOf(p) {
  const cells = []; for (let y=0;y<p.side;y++) for (let x=0;x<p.side;x++) cells.push({x,y,ch:p.grid[y][x]});
  return cells;
}
// Connected components (hex adjacency) of a cell list, largest first.
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
const passageInterior = (p, q) => { const cells = [];
  for (let x=q.x[0];x<=q.x[1];x++) for (let y=q.y[0]+1;y<q.y[1];y++) cells.push({x,y});
  return cells; };

// Per human: terrain, other humans' towns and closed cells block.
function transitFields(p, L, model, terrain, closed=[]) {
  const towns = L.players.slice(1).map(h=>h.towns[0]);
  const endpoints = new Set([...L.players[0].towns,...L.portals,...(model==='mineEndpoints'?L.goldmines:[])].map(key));
  return towns.map((t,i)=>bfs({mapSize:p.mapSize},[t],{blocked:new Set([...terrain,...towns.filter((_,j)=>j!==i).map(key),...closed.map(key)]),endpoints}));
}
// Walk a BFS distance map back from a target to its origin.
function witness(L, dist, origin, target) {
  const endpoints = new Set([...L.players[0].towns,...L.portals,...L.goldmines].map(key));
  if (!dist.has(key(target))) return null;
  const route = [target];
  let cur = target;
  while (dist.get(key(cur))>0) {
    cur = neighbours(cur).find(n=>dist.get(key(n))===dist.get(key(cur))-1&&(key(n)===key(origin)||!endpoints.has(key(n))));
    if (!cur) return null;
    route.push(cur);
  }
  return route.reverse().map(c=>({x:c.x,y:c.y}));
}

function contractMap(p, L) {
  return {size:p.size, mapSize:p.mapSize, coop:{initialHumanCount:p.humans},
    players:L.players.map(q=>({towns:q.towns,units:q.units,gold:q.gold})), goldmines:L.goldmines, portals:L.portals,
    mountains:L.mountains, lakes:L.lakes, bushes:L.bushes, hills:L.hills, valley:JSON.parse(JSON.stringify(p.valley))};
}

function applyFault(p, L, fault) {
  if (fault==='erase-ridge') {
    // Remove the middle planned ridge cell of the centre segment.
    const [left,right] = p.valley.passages;
    const centre = cellsOf(p).filter(c=>c.ch==='M'&&c.x>left.x[1]&&c.x<right.x[0]);
    if (!centre.length) return false;
    const gone = key(centre[Math.floor(centre.length/2)]);
    L.mountains = L.mountains.filter(c=>key(c)!==gone);
    return true;
  }
  if (fault==='block-lateral') {
    // Move the last lake onto the middle forward-lateral cell.
    const lateral = p.valley.laterals.find(l=>l.side==='forward'), [left,right] = p.valley.passages;
    const spot = {x:Math.floor((left.x[1]+right.x[0])/2), y:lateral.y[0]};
    if (!L.lakes.length) return false;
    L.lakes = [...L.lakes.slice(0,-1), spot];
    return true;
  }
  if (fault==='scatter-lakes') {
    // Keep only lakes with no kept lake neighbour, so every lake is a singleton.
    const kept = [];
    for (const c of L.lakes) if (!kept.some(k=>neighbours(c).some(n=>key(n)===key(k)))) kept.push(c);
    L.lakes = kept;
    return true;
  }
  return false;
}

function measure(p, L, before) {
  const side = p.side, mapInfo = {mapSize:p.mapSize}, area = side*side, scaling = getCoopMapScaling(p.humans,p.size);
  const inBounds = c => Number.isInteger(c.x)&&Number.isInteger(c.y)&&c.x>=0&&c.y>=0&&c.x<side&&c.y<side;
  const humanTowns = L.players.slice(1).map(h=>h.towns[0]), neutral = L.players[0].towns, allTowns = [...humanTowns,...neutral];
  const mines = L.goldmines, portals = L.portals, approachCells = L.portalApproaches.flatMap(a=>a.cells);
  const cats = {mountains:L.mountains, lakes:L.lakes, bushes:L.bushes};
  const terrain = new Set([...L.mountains,...L.lakes].map(key)), mountainKeys = new Set(L.mountains.map(key));
  const [left,right] = p.valley.passages, {exitRow, entranceRow, alliedTop, ridge:[ridgeRow,ridgeEnd]} = p.rows;
  const interiors = {left:passageInterior(p,left), right:passageInterior(p,right)};

  // Ridge: every planned ridge cell is a mountain, each segment is one mountain
  // component, every column outside passages keeps a band mountain, and with
  // passage interiors closed the mountains alone divide allied from forward cells.
  const planned = cellsOf(p).filter(c=>c.ch==='M');
  const mountainComponents = components(L.mountains), componentOf = new Map(mountainComponents.flatMap((ids,i)=>ids.map(id=>[id,i])));
  const segments = {west:planned.filter(c=>c.x<left.x[0]), centre:planned.filter(c=>c.x>left.x[1]&&c.x<right.x[0]), east:planned.filter(c=>c.x>right.x[1])};
  const segmentReport = Object.fromEntries(Object.entries(segments).map(([n,cells])=>{
    const comps = [...new Set(cells.map(c=>componentOf.get(key(c))))];
    return [n,{plannedCells:cells.length, mountainComponents:comps.length, containingComponentSize:comps.length===1&&comps[0]!==undefined?mountainComponents[comps[0]].length:null}];
  }));
  const bandColumnsWithoutMountain = [];
  for (let x=0;x<side;x++) {
    if ((x>=left.x[0]&&x<=left.x[1])||(x>=right.x[0]&&x<=right.x[1])) continue;
    let found = false; for (let y=ridgeRow;y<=ridgeEnd;y++) if (mountainKeys.has(key({x,y}))) found = true;
    if (!found) bandColumnsWithoutMountain.push(x);
  }
  const alliedStarts = cellsOf(p).filter(c=>c.y>=alliedTop&&!mountainKeys.has(key(c)));
  const divideDist = bfs(mapInfo,alliedStarts,{blocked:new Set([...mountainKeys,...interiors.left.map(key),...interiors.right.map(key)])});
  const forwardReachedWithoutPassages = cellsOf(p).filter(c=>c.y<=exitRow&&divideDist.has(key(c))).length;
  const ridgeFormation = {plannedCells:planned.length, missingPlannedCells:planned.filter(c=>!mountainKeys.has(key(c))).map(key),
    segments:segmentReport, bandRows:[ridgeRow,ridgeEnd], bandColumnsWithoutMountain, forwardReachedWithoutPassages};
  const ridgeOk = planned.length>0&&!ridgeFormation.missingPlannedCells.length&&!bandColumnsWithoutMountain.length&&forwardReachedWithoutPassages===0&&
    Object.values(segmentReport).every(s=>s.plannedCells===0||s.mountainComponents===1);

  // Reservations: terrain stays off objects, town 3x3s, passages, laterals,
  // passage mouths, portal approaches and earlier reservations; categories disjoint.
  const allTerrain = [...L.mountains,...L.lakes,...L.bushes];
  const passageKeys = new Set(p.valley.passages.flatMap(q=>{ const c=[]; for (let x=q.x[0];x<=q.x[1];x++) for (let y=q.y[0];y<=q.y[1];y++) c.push(key({x,y})); return c; }));
  const lateralKeys = new Set(p.valley.laterals.flatMap(l=>{ const c=[]; for (let x=l.x[0];x<=l.x[1];x++) for (let y=l.y[0];y<=l.y[1];y++) c.push(key({x,y})); return c; }));
  const mouthKeys = new Set(p.valley.passages.flatMap(q=>{ const c=[]; for (let x=q.x[0];x<=q.x[1];x++) c.push({x,y:q.y[0]},{x,y:q.y[1]}); return c; }).flatMap(neighbours).map(key));
  const objectKeys = new Set([...allTowns,...mines,...portals].map(key)), approachKeys = new Set(approachCells.map(key)), reservedKeys = new Set(before.reserved.map(key));
  const hits = test => allTerrain.filter(test).map(key), plannedKeys = new Set(planned.map(key));
  // The planned ridge itself borders the passages; only grown terrain must stay out of mouths.
  const reservations = {outOfBounds:hits(c=>!inBounds(c)), duplicates:allTerrain.length-new Set(allTerrain.map(key)).size,
    onObjects:hits(c=>objectKeys.has(key(c))), inTownNeighbourhoods:hits(c=>allTowns.some(t=>chebyshev(t,c)<=1)),
    inPassages:hits(c=>passageKeys.has(key(c))), inLaterals:hits(c=>lateralKeys.has(key(c))), inPassageMouths:hits(c=>mouthKeys.has(key(c))&&!plannedKeys.has(key(c))),
    onPortalApproaches:hits(c=>approachKeys.has(key(c))), onEarlierReservations:hits(c=>reservedKeys.has(key(c))), hills:L.hills.length};
  const reservationsOk = Object.values(reservations).every(v=>Array.isArray(v)?!v.length:v===0);

  // Clusters and densities.
  const clusters = Object.fromEntries(Object.entries(cats).map(([n,cells])=>{
    const sizes = components(cells).map(c=>c.length), multi = sizes.filter(s=>s>1).reduce((a,b)=>a+b,0);
    return [n,{cells:cells.length, componentSizes:sizes, largestComponent:sizes[0]||0, multiCellShare:cells.length?multi/cells.length:0}];
  }));
  const clustersOk = Object.values(clusters).every(c=>c.cells>0&&c.largestComponent>=MIN_COMPONENT&&c.multiCellShare>=MULTI_CELL_SHARE);
  const density = Object.fromEntries(Object.entries(cats).map(([n,cells])=>{
    const target = Math.round(area*SHARES[n]), deviation = cells.length-target;
    const ridgeOverflow = n==='mountains'&&deviation>0&&cells.length===planned.length;
    return [n,{target, scalingTarget:scaling.counts[n], achieved:cells.length, deviation, density:cells.length/area, targetDensity:SHARES[n],
      densityDeviation:(cells.length-target)/area, withinTolerance:Math.abs(deviation)<=DENSITY_TOLERANCE*area, ridgeOverflow,
      emittedAchieved:L.terrain&&L.terrain[n]?L.terrain[n].achieved:null}];
  }));
  const densityOk = Object.values(density).every(d=>d.target===d.scalingTarget&&d.achieved>0&&(d.withinTolerance||d.ridgeOverflow)&&d.emittedAchieved===d.achieved);
  const counts = {side:{expected:scaling.side, observed:side, mapSize:p.mapSize}, expected:{humanTowns:scaling.counts.humanTowns, neutralTowns:scaling.counts.neutralTowns,
    goldmines:scaling.counts.goldmines, portals:scaling.counts.portals},
    observed:{humanTowns:humanTowns.length, neutralTowns:neutral.length, goldmines:mines.length, portals:portals.length}};
  const countsOk = side===scaling.side&&p.mapSize.x===side&&p.mapSize.y===side&&same(counts.expected,counts.observed);

  // Path width: every passage row keeps >=2 free cells, lateral rows stay
  // free, contract cut resilience/laterals/portal approaches hold, emitted
  // approach cells stay free.
  const contract = verifyValley(contractMap(p,L)), result = n => contract.results.find(r=>r.name===n);
  const freeCell = c => inBounds(c)&&!terrain.has(key(c))&&!objectKeys.has(key(c));
  const passageRows = p.valley.passages.map(q=>{ const rows = [];
    for (let y=q.y[0];y<=q.y[1];y++) { let n=0; for (let x=q.x[0];x<=q.x[1];x++) n += freeCell({x,y}); rows.push(n); }
    return {name:q.name, freeCellsPerRow:rows, minimum:Math.min(...rows)}; });
  const lateralFree = p.valley.laterals.map(l=>{ let blocked=0, cells=0; for (let x=l.x[0];x<=l.x[1];x++) { cells++; blocked += !freeCell({x,y:l.y[0]}); } return {name:l.name, cells, blocked}; });
  const pathWidth = {passageRows, lateralFree, emittedApproachFree:L.portalApproaches.map(a=>a.cells.filter(freeCell).length),
    contract:Object.fromEntries(['main-passage-cut-resilience','lateral-connections','portal-approach'].map(n=>[n,result(n).pass]))};
  const widthOk = passageRows.every(r=>r.minimum>=2)&&lateralFree.every(l=>l.blocked===0)&&pathWidth.emittedApproachFree.every(n=>n>=MIN_APPROACH)&&
    Object.values(pathWidth.contract).every(Boolean);

  // Connectivity: walkable cells (mines walkable) form one component touched by
  // every town and portal; forward basin cells form one component on their own.
  const solid = new Set([...terrain,...allTowns.map(key),...portals.map(key)]);
  const walk = cellsOf(p).filter(c=>!solid.has(key(c)));
  const walkDist = bfs(mapInfo,[walk[0]],{blocked:solid});
  const basinCells = walk.filter(c=>'FfWE'.includes(c.ch));
  const basinDist = bfs(mapInfo,[basinCells[0]],{blocked:solid,allowed:new Set(basinCells.map(key))});
  const touches = (dist,c) => neighbours(c).some(n=>dist.has(key(n)));
  const forwardObjects = [...neutral,...portals];
  const connectivity = {walkableCells:walk.length, reachedFromOneCell:walkDist.size, untouchedObjects:[...allTowns,...portals].filter(c=>!touches(walkDist,c)).map(key),
    basinCells:basinCells.length, basinReached:basinDist.size, basinUntouchedObjects:forwardObjects.filter(c=>!touches(basinDist,c)).map(key),
    contractTerrainComponents:result('terrain-components').pass};
  const connectivityOk = walkDist.size===walk.length&&!connectivity.untouchedObjects.length&&basinDist.size===basinCells.length&&
    !connectivity.basinUntouchedObjects.length&&connectivity.contractTerrainComponents;

  // Reachability and fairness in both path models.
  const fields = Object.fromEntries(Object.keys(MODELS).map(m=>[m,transitFields(p,L,m,terrain)]));
  const groups = {goldmines:mines, neutralTowns:neutral, portals, approachCells};
  const reach = Object.fromEntries(Object.entries(fields).map(([m,f])=>[m,f.map((d,i)=>({slot:i+1,
    ...Object.fromEntries(Object.entries(groups).map(([g,list])=>[g,list.filter(c=>!d.has(key(c))).length]))}))]));
  const reachOk = Object.values(reach).every(rows=>rows.every(r=>Object.keys(groups).every(g=>r[g]===0)))&&result('route-connectivity').pass;
  const fairnessOf = (f) => Object.fromEntries(['goldmines','neutralTowns','portals'].map(g=>{
    const nearest = f.map(d=>{ const v = groups[g].map(c=>d.get(key(c))).filter(x=>x!==undefined); return v.length?Math.min(...v):Infinity; });
    return [g,{nearest:nearest.map(x=>Number.isFinite(x)?x:null), disparity:spread(nearest)}]; }));
  const fairness = Object.fromEntries(Object.entries(fields).map(([m,f])=>[m,fairnessOf(f)]));
  const ridgeOnly = new Set(planned.map(key));
  const preTerrain = Object.fromEntries(Object.keys(MODELS).map(m=>[m,fairnessOf(transitFields(p,before,m,ridgeOnly))]));
  const fairOk = Object.values(fairness).every(byGroup=>Object.values(byGroup).every(g=>g.disparity!==null&&g.disparity<=DISPARITY))&&
    result('starting-access-fairness').pass;

  // Each advance passage alone reaches every objective; neither reaches no portal.
  const closures = {leftOnly:interiors.right, rightOnly:interiors.left, bothClosed:[...interiors.left,...interiors.right]};
  const closed = Object.fromEntries(Object.entries(closures).map(([n,cells])=>[n,transitFields(p,L,'mineEndpoints',terrain,cells)]));
  const fronts = Object.fromEntries(Object.entries(closed).map(([n,f])=>[n,f.map((d,i)=>({slot:i+1,
    ...Object.fromEntries(Object.entries(groups).map(([g,list])=>[g,list.filter(c=>d.has(key(c))).length]))}))]));
  const frontsOk = ['leftOnly','rightOnly'].every(n=>fronts[n].every(r=>Object.keys(groups).every(g=>r[g]===groups[g].length)))&&
    fronts.bothClosed.every(r=>r.portals===0)&&result('advance-passages').pass&&result('valley-divide').pass;
  // Route witness per human and front: town -> nearest approach cell -> its portal.
  const routeWitnesses = humanTowns.map((t,i)=>['leftOnly','rightOnly'].map(n=>{
    const d = closed[n][i];
    const target = approachCells.filter(c=>d.has(key(c))).sort((a,b)=>d.get(key(a))-d.get(key(b)))[0];
    const route = target ? witness(L,d,t,target) : null;
    const portal = target ? L.portalApproaches.find(a=>a.cells.some(c=>key(c)===key(target))).portal : null;
    const walkRoute = route ? [...route,portal] : null, shut = new Set(closures[n].map(key));
    const valid = !!walkRoute&&key(walkRoute[0])===key(t)&&walkRoute.slice(1).every((c,k)=>neighbours(walkRoute[k]).some(m=>key(m)===key(c)))&&
      walkRoute.slice(1,-1).every(c=>freeCell(c)&&!shut.has(key(c)));
    const own = (n==='leftOnly'?interiors.left:interiors.right).map(key);
    return {slot:i+1, front:n==='leftOnly'?'left-advance':'right-advance', steps:walkRoute?walkRoute.length-1:null, valid,
      viaOwnPassage:!!walkRoute&&walkRoute.some(c=>own.includes(key(c))), route:walkRoute&&walkRoute.map(c=>[c.x,c.y])};
  }));
  const witnessesOk = routeWitnesses.flat().every(w=>w.valid&&w.viaOwnPassage);

  const prior = {objectsUnchanged:same(L.players,before.players)&&same(L.goldmines,before.goldmines)&&same(L.portals,before.portals),
    approachesUnchanged:same(L.portalApproaches,before.portalApproaches)&&same(L.portalGroups,before.portalGroups),
    reservedUnchanged:same(L.reserved,before.reserved), stages:L.stages};
  const priorOk = prior.objectsUnchanged&&prior.approachesUnchanged&&prior.reservedUnchanged&&same(L.stages,[...before.stages,'ridge','mountains','lakes','bushes']);

  const comparisons = {ridgeFormation, reservations, clusters, density, counts, pathWidth, connectivity, reach, fairness, preTerrainFairness:preTerrain,
    fronts, routeWitnesses, contract:{valid:contract.valid, failed:contract.failed}, prior};
  const checks = [
    ['ridge-formation', ridgeOk],
    ['reservations', reservationsOk],
    ['terrain-clusters', clustersOk],
    ['terrain-density', densityOk],
    ['counts-unchanged', countsOk],
    ['path-width', widthOk],
    ['connectivity', connectivityOk],
    ['objective-reach', reachOk],
    ['single-front-reach', frontsOk&&witnessesOk],
    ['starting-fairness', fairOk],
    ['contract-valid', contract.valid],
    ['prior-layout-kept', priorOk]];
  return {comparisons, checks};
}

function runCase(size, humans, seed, fault) {
  let p, before, layout, again;
  try {
    p = plan.planDividedValley(humans,size,seed);
    before = plan.placeValleyPortals(p,plan.placeValleyExpansions(p,plan.placeValleyStarts(p,coopPlayerColor)));
    layout = plan.placeValleyTerrain(p,before);
    again = plan.placeValleyTerrain(p,before);
  } catch (error) {
    return {p, error:String(error&&error.stack||error), faulted:false, checks:{generation:false}, failed:['generation'], rejectedBy:'generation'};
  }
  const layoutSha256 = sha(JSON.stringify(layout)), repeatSha256 = sha(JSON.stringify(again));
  const faulted = fault ? applyFault(p,layout,fault) : false;
  const m = measure(p,layout,before);
  const checks = [...m.checks, ['deterministic-repeat', layoutSha256===repeatSha256]];
  const failed = checks.filter(([,ok])=>!ok).map(([n])=>n);
  return {p, before, layout, faulted, layoutSha256, repeatSha256, m, checks:Object.fromEntries(checks), failed, rejectedBy:failed[0]||null};
}

module.exports = {runCase, measure, FAULTS};

if (require.main === module) {
  const arg = n => { const i = process.argv.indexOf(n); return i<0 ? undefined : process.argv[i+1]; };
  const out = path.resolve(arg('--output-dir') || 'artifacts/TASK-139'), fault = arg('--fault');
  if (fault!==undefined && !FAULTS[fault]) { console.error('Unknown --fault '+fault+'; expected '+Object.keys(FAULTS).join(', ')); process.exit(2); }
  // --sizes/--humans narrow the matrix (negative controls only; positive mode requires all 144 cases).
  const SIZES = arg('--sizes') ? arg('--sizes').split(',') : ALL_SIZES, HUMANS = arg('--humans') ? arg('--humans').split(',').map(Number) : ALL_HUMANS;
  fs.mkdirSync(out,{recursive:true});
  const files = Object.fromEntries(SOURCES.map(f=>[f,sha(fs.readFileSync(path.join(ROOT,f)))]));
  fs.writeFileSync(path.join(out,'source-identities.json'), JSON.stringify({node:process.version,files},null,2)+'\n');
  const matrix = [], cases = [], started = Date.now();
  for (const size of SIZES) for (const humans of HUMANS) for (const seed of SEEDS) {
    const t0 = Date.now(), r = runCase(size,humans,seed,fault), elapsedMs = Date.now()-t0;
    if (r.error) {
      console.log(`FAIL ${size}-H${humans}-seed${seed} failed=generation error=${r.error.split('\n')[0]}`);
      matrix.push({size, humans, seed, faulted:false, error:r.error, checks:r.checks, failed:r.failed, rejectedBy:r.rejectedBy});
      continue;
    }
    const c = r.m.comparisons, d = c.density, cl = c.clusters;
    const fair = Math.max(...Object.values(c.fairness).flatMap(g=>Object.values(g).map(v=>v.disparity??Infinity)));
    console.log(`${r.failed.length?'FAIL':'PASS'} ${size}-H${humans}-seed${seed} side=${r.p.side} mountains=${d.mountains.achieved}/${d.mountains.target}(ridge ${c.ridgeFormation.plannedCells}) lakes=${d.lakes.achieved}/${d.lakes.target} bushes=${d.bushes.achieved}/${d.bushes.target} largest=${cl.mountains.largestComponent}/${cl.lakes.largestComponent}/${cl.bushes.largestComponent} multi=${['mountains','lakes','bushes'].map(n=>cl[n].multiCellShare.toFixed(2)).join('/')} minPassageWidth=${Math.min(...c.pathWidth.passageRows.map(q=>q.minimum))} disparity=${fair} contract=${c.contract.valid} ms=${elapsedMs}${r.faulted?' faulted='+fault:''}${r.failed.length?' failed='+r.failed.join(','):''}`);
    matrix.push({size, humans, seed, side:r.p.side, elapsedMs, faulted:r.faulted, layoutSha256:r.layoutSha256, repeatSha256:r.repeatSha256,
      checks:r.checks, failed:r.failed, rejectedBy:r.rejectedBy,
      postTerrain:{ridgeFormation:c.ridgeFormation, reservations:c.reservations, clusters:Object.fromEntries(Object.entries(cl).map(([n,v])=>[n,{...v, componentSizes:undefined, components:v.componentSizes.length}])),
        density:d, counts:c.counts, pathWidth:c.pathWidth, connectivity:c.connectivity, objectiveReach:c.reach, fairness:c.fairness,
        preTerrainFairness:c.preTerrainFairness, singleFrontReach:c.fronts, routeWitnessesValid:c.routeWitnesses.flat().filter(w=>w.valid&&w.viaOwnPassage).length,
        routeWitnesses:c.routeWitnesses.flat().length, contract:c.contract, prior:c.prior}});
    cases.push({identity:{size,humans,seed,side:r.p.side,planSha256:sha(JSON.stringify(r.p)),layoutSha256:r.layoutSha256,faulted:r.faulted},
      targets:Object.fromEntries(Object.entries(d).map(([n,v])=>[n,v.target])), achieved:Object.fromEntries(Object.entries(d).map(([n,v])=>[n,v.achieved])),
      deviations:Object.fromEntries(Object.entries(d).map(([n,v])=>[n,{cells:v.deviation, densityPoints:+(v.densityDeviation*100).toFixed(3), withinTolerance:v.withinTolerance, ridgeOverflow:v.ridgeOverflow}])),
      densities:Object.fromEntries(Object.entries(d).map(([n,v])=>[n,+v.density.toFixed(5)])),
      componentSizes:Object.fromEntries(Object.entries(cl).map(([n,v])=>[n,v.componentSizes])),
      multiCellShare:Object.fromEntries(Object.entries(cl).map(([n,v])=>[n,+v.multiCellShare.toFixed(4)])),
      ridge:{rows:r.p.rows, segments:c.ridgeFormation.segments, plannedCells:c.ridgeFormation.plannedCells},
      cells:{mountains:r.layout.mountains.map(q=>[q.x,q.y]), lakes:r.layout.lakes.map(q=>[q.x,q.y]), bushes:r.layout.bushes.map(q=>[q.x,q.y])},
      generatorReport:r.layout.terrain, routeWitnesses:c.routeWitnesses.flat()});
  }
  const failedCases = matrix.filter(m=>m.failed.length).length, ok = matrix.filter(m=>m.postTerrain);
  const sum = (n,f) => ok.reduce((s,m)=>s+f(m.postTerrain.density[n]),0);
  const summary = {matrixCases:matrix.length, failedCases, generationErrors:matrix.filter(m=>m.error).length, elapsedMs:Date.now()-started,
    terrain:Object.fromEntries(Object.keys(SHARES).map(n=>[n,{achieved:sum(n,v=>v.achieved), target:sum(n,v=>v.target),
      minDensityDeviationPoints:+(Math.min(...ok.map(m=>m.postTerrain.density[n].densityDeviation))*100).toFixed(3),
      maxDensityDeviationPoints:+(Math.max(...ok.map(m=>m.postTerrain.density[n].densityDeviation))*100).toFixed(3),
      casesOutsideTolerance:ok.filter(m=>!m.postTerrain.density[n].withinTolerance).map(m=>`${m.size}-H${m.humans}-seed${m.seed}${m.postTerrain.density[n].ridgeOverflow?'(ridge overflow)':''}`),
      minLargestComponent:Math.min(...ok.map(m=>m.postTerrain.clusters[n].largestComponent)),
      minMultiCellShare:Math.min(...ok.map(m=>m.postTerrain.clusters[n].multiCellShare))}])),
    minPassageFreeWidth:Math.min(...ok.flatMap(m=>m.postTerrain.pathWidth.passageRows.map(q=>q.minimum))),
    maxDisparity:Math.max(...ok.flatMap(m=>Object.values(m.postTerrain.fairness).flatMap(g=>Object.values(g).map(v=>v.disparity??Infinity)))),
    contractValid:ok.filter(m=>m.postTerrain.contract.valid).length,
    routeWitnesses:{valid:ok.reduce((s,m)=>s+m.postTerrain.routeWitnessesValid,0), total:ok.reduce((s,m)=>s+m.postTerrain.routeWitnesses,0)}};
  fs.writeFileSync(path.join(out,'checkpoints.json'), JSON.stringify({mode:fault?'fault':'positive', fault:fault||null,
    intendedAssertion:fault?FAULTS[fault]:null, sizes:SIZES, humans:HUMANS, seeds:SEEDS,
    rules:{softTargets:'round(area*share) with shares '+JSON.stringify(SHARES)+'; generation version 4 superseding exact terrain counts',
      density:`|achieved-target| <= ${DENSITY_TOLERANCE*100} percentage points of area, or mountains above target only because every planned ridge cell is a mountain`,
      clusters:`every category non-empty, largest component >=${MIN_COMPONENT}, >=${MULTI_CELL_SHARE*100}% of cells in multi-cell components`,
      ridge:'all planned ridge cells are mountains; each ridge segment in one mountain component; every non-passage column has a band mountain; mountains plus closed passage interiors separate allied from forward rows',
      reservations:'no terrain on objects, town 3x3s, passage masks, lateral rows, passage mouths (neighbours of entrance/exit rows), portal approaches or earlier reservations; categories disjoint; no hills',
      pathWidth:'>=2 free cells on every passage row, lateral rows free, contract cut resilience/laterals/portal approach, emitted approaches >=2 free',
      connectivity:'walkable cells one component touched by every town/portal; forward basin (F/f/W/E) one component touched by neutral towns and portals',
      reach:'every human reaches every mine, neutral town, portal and approach cell in both path models', fairness:`nearest mine/neutral/portal disparity <=${DISPARITY} in both models`,
      singleFront:'each advance passage alone reaches every objective with a valid route witness through it; neither reaches no portal', pathModels:MODELS,
      pathObstacles:'mountains, lakes and other human towns block; bushes walkable'},
    assertionOrder:ok[0]?Object.keys(ok[0].checks):[], summary, matrix},null,1)+'\n');
  fs.writeFileSync(path.join(out,'terrain-maps.json'), '{"note":"cells are [x,y]; deviations are achieved-target cells and percentage points of area; route witnesses walk town -> nearest approach cell -> portal with the other passage interior closed (mines are endpoints)",\n"cases":[\n'+
    cases.map(c=>JSON.stringify(c)).join(',\n')+'\n]}\n');
  if (fault) {
    const assertion = FAULTS[fault], applied = matrix.filter(m=>m.faulted);
    const intended = applied.filter(m=>m.rejectedBy===assertion), accepted = applied.filter(m=>!m.failed.length);
    const other = applied.filter(m=>m.failed.length&&m.rejectedBy!==assertion), untouched = matrix.filter(m=>!m.faulted&&m.failed.length);
    console.log(`REJECTED ${fault} intended=${assertion} faultedCases=${applied.length} rejectedByIntended=${intended.length} accepted=${accepted.length} rejectedByOther=${other.length} unfaultedFailures=${untouched.length}`);
    if (accepted.length || !applied.length) { console.log('UNEXPECTED fault accepted '+fault); process.exit(3); }
    process.exit(other.length||untouched.length ? 4 : 1);
  }
  const pass = !failedCases && matrix.length===144;
  const t = summary.terrain;
  console.log(`${pass?'PASS':'FAIL'} valley-terrain cases=${matrix.length-failedCases}/${matrix.length} mountains=${t.mountains.achieved}/${t.mountains.target} lakes=${t.lakes.achieved}/${t.lakes.target} bushes=${t.bushes.achieved}/${t.bushes.target} minLargestComponent=${t.mountains.minLargestComponent}/${t.lakes.minLargestComponent}/${t.bushes.minLargestComponent} minMultiCellShare=${['mountains','lakes','bushes'].map(n=>t[n].minMultiCellShare.toFixed(3)).join('/')} minPassageFreeWidth=${summary.minPassageFreeWidth} maxDisparity=${summary.maxDisparity} contractValid=${summary.contractValid}/${ok.length} routeWitnesses=${summary.routeWitnesses.valid}/${summary.routeWitnesses.total}`);
  process.exit(pass?0:1);
}
