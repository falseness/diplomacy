// Divided Valley region/route plan matrix. Plans come from ai/coop-valley-plan.js;
// every connectivity, width and capacity claim is re-measured here or by the
// independent TASK-134 contract on a probe map built from the plan.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const plan = require('./coop-valley-plan.js');
const contract = require('./test-coop-valley-contract.js');
const {getCoopMapScaling} = require('./coop-map-scaling.js');
const {neighbours, bfs, verifyValley} = contract;
const key = c => `${c.x},${c.y}`;
const SIZES = ['tiny','normal','big'], HUMANS = Array.from({length:12},(_,i)=>i+1);
const SEEDS = [0,1,31,4294967295], VARIATION_SEEDS = Array.from({length:32},(_,i)=>i);
// Placement-dependent contract checks that later tasks own; recorded, not required.
const DEFERRED = ['starting-access-fairness'];
const SOURCES = ['ai/coop-valley-plan.js','ai/test-coop-valley-regions.js','ai/test-coop-valley-contract.js','ai/coop-map-scaling.js'];
const chebyshev = (a,b) => Math.max(Math.abs(a.x-b.x),Math.abs(a.y-b.y));
const sha = text => crypto.createHash('sha256').update(text).digest('hex');
const at = (p,c) => p.grid[c.y][c.x];
const cellsWhere = (p,test) => p.grid.flatMap((row,y)=>[...row].map((ch,x)=>({x,y,ch}))).filter(test).map(({x,y})=>({x,y}));
const spread = (list,n) => Array.from({length:n},(_,i)=>list[Math.floor(i*list.length/n)]);
const passageRidgeMask = p => p.grid.map(row=>row.replace(/[^lrM]/g,'.')).join('/');

// Probe map: exact scaled counts on the plan's own candidate sites, ridge as
// terrain and no other decorations. It lets the contract measure the plan.
function probeMap(p, fault) {
  const humans = spread(p.capacity.alliedSites, p.humans);
  const neutral = spread(p.capacity.forwardSites, p.counts.neutralTowns);
  const portals = [];
  for (let i=0; portals.length<p.counts.portals; i++) {
    const side = i%2 ? p.capacity.portalSlots.east : p.capacity.portalSlots.west;
    if (side[Math.floor(i/2)]) portals.push(side[Math.floor(i/2)]);
  }
  const towns = [...humans,...neutral], portalIds = new Set(portals.flatMap(q=>[q,...neighbours(q)]).map(key));
  const room = ch => cellsWhere(p,c=>c.ch===ch&&!towns.some(t=>chebyshev(t,c)<=1)&&!portalIds.has(key(c)));
  const mines = [...spread(room('A'),p.humans), ...spread(room('F'),p.counts.goldmines-p.humans)]
    .map(c=>({...c,owner:0,income:20}));
  const ridge = p.masks.ridge.slice(), mountainCount = Math.min(ridge.length,p.counts.mountains);
  const map = {size:p.size, mapSize:p.mapSize, coop:{initialHumanCount:p.humans},
    players:[{towns:neutral,units:[],gold:0},...humans.map(t=>({towns:[t],units:[],gold:100}))],
    goldmines:mines, portals, mountains:ridge.slice(0,mountainCount), lakes:ridge.slice(mountainCount),
    bushes:[], hills:[], valley:JSON.parse(JSON.stringify(p.valley))};
  if (fault==='blocked-passage') {
    const pass = map.valley.passages[0], y = p.rows.ridge[0];
    for (let x=pass.x[0]; x<=pass.x[1]; x++) map.mountains.push({x,y});
  }
  return map;
}

// Terrain-only measurement from the plan grid: allied territory to portal
// regions through each passage alone, both, or neither.
function measureConnectivity(p) {
  const map = {mapSize:p.mapSize};
  const ridge = p.masks.ridge.map(key);
  const interior = pass => cellsWhere(p,c=>c.ch===pass&&c.y>p.rows.exitRow&&c.y<p.rows.entranceRow).map(key);
  const allied = cellsWhere(p,c=>c.ch==='A'), portalCells = [...p.masks.westPortal,...p.masks.eastPortal];
  const reach = extra => { const d = bfs(map,allied,{blocked:new Set([...ridge,...extra])});
    return {west:p.masks.westPortal.some(c=>d.has(key(c))), east:p.masks.eastPortal.some(c=>d.has(key(c)))}; };
  const lateral = (mask,a,b) => { const allowed = new Set([...mask,...a,...b].map(key));
    const d = bfs(map,a,{allowed}); return b.some(c=>d.has(key(c))); };
  const hexDist = bfs(map,p.masks.westPortal);
  const e = p.endpoints;
  const widthOk = q => { const xs = new Set(cellsWhere(p,c=>c.ch===q&&c.y===p.rows.ridge[0]).map(c=>c.x)); return xs.size; };
  return {bothOpen:reach([]), leftOnly:reach(interior('r')), rightOnly:reach(interior('l')),
    bothClosed:reach([...interior('l'),...interior('r')]),
    rearLateralJoinsEntrances:lateral(p.masks.rearLateral,e.leftPassage.entrance,e.rightPassage.entrance),
    forwardLateralJoinsExits:lateral(p.masks.forwardLateral,e.leftPassage.exit,e.rightPassage.exit),
    passageWidths:{left:widthOk('l'),right:widthOk('r')},
    portalRegionSeparation:p.masks.eastPortal.length?Math.min(...p.masks.eastPortal.map(c=>hexDist.get(key(c)))):null,
    portalRegionCells:portalCells.length};
}

// Re-check the plan's candidate sites and portal slots against the grid.
function measureCapacity(p) {
  const side = p.side, cap = p.capacity;
  const siteOk = (t,allowed) => t.x>=2&&t.y>=2&&t.x<side-2&&t.y<side-2&&
    [-1,0,1].every(dy=>[-1,0,1].every(dx=>allowed.includes(p.grid[t.y+dy][t.x+dx])));
  const spaced = list => list.every((t,i)=>list.slice(i+1).every(u=>chebyshev(t,u)>=3));
  const alliedCenters = cellsWhere(p,c=>c.x>=2&&c.y>=p.rows.alliedTop&&c.x<side-2&&c.y<side-2);
  const d = bfs({mapSize:p.mapSize},alliedCenters);
  const slotOk = (list,ch) => list.every(s=>at(p,s)===ch&&d.get(key(s))>=p.portalDistance&&
    neighbours(s).filter(n=>n.x>=0&&n.y>=0&&n.x<side&&n.y<side&&!list.some(o=>key(o)===key(n))).length>=2);
  const count = ch => p.grid.join('').split('').filter(c=>c===ch).length;
  const terrainBudget = p.counts.mountains+p.counts.lakes;
  return {
    alliedSites:{available:cap.alliedSites.length, needed:p.humans, valid:cap.alliedSites.every(t=>siteOk(t,'Ablr'))&&spaced(cap.alliedSites)},
    forwardSites:{available:cap.forwardSites.length, needed:p.counts.neutralTowns, valid:cap.forwardSites.every(t=>siteOk(t,'Fflr'))&&spaced(cap.forwardSites)},
    portalSlots:{west:cap.portalSlots.west.length, east:cap.portalSlots.east.length, needed:cap.portalNeed,
      valid:slotOk(cap.portalSlots.west,'W')&&slotOk(cap.portalSlots.east,'E')},
    alliedMineRoom:{available:count('A')-9*p.humans, needed:p.humans},
    forwardMineRoom:{available:count('F')-9*p.counts.neutralTowns, needed:p.counts.goldmines-p.humans},
    ridge:{cells:count('M'), terrainBudget},
    decorativeRoom:{available:p.side*p.side-count('M')-count('l')-count('r')-count('b')-count('f')-count('W')-count('E')
      -9*(p.humans+p.counts.neutralTowns)-p.counts.goldmines, needed:terrainBudget-count('M')+p.counts.bushes}};
}

function checkPlan(p, fault) {
  const scaling = getCoopMapScaling(p.humans,p.size);
  plan.clearValleyPlanCache();
  const again = plan.planDividedValley(p.humans,p.size,p.seed);
  const identical = JSON.stringify(again)===JSON.stringify(p);
  const connectivity = measureConnectivity(p), capacity = measureCapacity(p);
  const contractResult = verifyValley(probeMap(p,fault));
  const required = contractResult.results.filter(r=>!DEFERRED.includes(r.name));
  const regionCounts = Object.fromEntries(Object.keys(p.legend).map(ch=>[ch,p.grid.join('').split(ch).length-1]));
  const checks = {
    'dimensions-unchanged': p.side===scaling.side&&p.grid.length===scaling.side&&p.grid.every(r=>r.length===scaling.side),
    'all-regions-present': Object.entries(regionCounts).every(([ch,n])=>n>0||(ch==='E'&&p.counts.portals<2)),
    'deterministic-repeat': identical,
    'terrain-only-divide': connectivity.bothOpen.west&&connectivity.leftOnly.west&&connectivity.rightOnly.west&&
      (p.counts.portals<2||connectivity.bothOpen.east&&connectivity.leftOnly.east&&connectivity.rightOnly.east)&&
      !connectivity.bothClosed.west&&!connectivity.bothClosed.east,
    'lateral-connections-measured': connectivity.rearLateralJoinsEntrances&&connectivity.forwardLateralJoinsExits,
    'passage-width-min-2': connectivity.passageWidths.left>=2&&connectivity.passageWidths.right>=2,
    'town-site-capacity': capacity.alliedSites.valid&&capacity.forwardSites.valid&&
      capacity.alliedSites.available>=capacity.alliedSites.needed&&capacity.forwardSites.available>=capacity.forwardSites.needed,
    'portal-slot-capacity': capacity.portalSlots.valid&&capacity.portalSlots.west>=capacity.portalSlots.needed.west&&
      capacity.portalSlots.east>=capacity.portalSlots.needed.east,
    'entity-room': capacity.alliedMineRoom.available>=capacity.alliedMineRoom.needed&&
      capacity.forwardMineRoom.available>=capacity.forwardMineRoom.needed&&
      capacity.ridge.cells<=capacity.ridge.terrainBudget&&capacity.decorativeRoom.available>=capacity.decorativeRoom.needed,
    'contract-probe': required.every(r=>r.pass)};
  const failed = Object.entries(checks).filter(([,v])=>!v).map(([k])=>k);
  return {checks, failed, identical, planSha256:sha(JSON.stringify(p)), regionCounts, connectivity, capacity,
    contract:{rejectedBy:contractResult.rejectedBy, failed:contractResult.failed, deferred:DEFERRED,
      results:contractResult.results.map(r=>({name:r.name,pass:r.pass,required:!DEFERRED.includes(r.name),
        expected:r.expected,observed:['main-passage-cut-resilience','advance-passages','valley-divide','lateral-connections','portal-approach','portal-hex-distance','starting-access-fairness'].includes(r.name)?r.observed:undefined}))}};
}

function variation(size, humans, fault) {
  const masks = VARIATION_SEEDS.map(seed=>{ const p = plan.planDividedValley(humans,size,fault==='fixed-seed'?0:seed);
    return {seed, maskSha256:sha(passageRidgeMask(p)), selection:p.selection}; });
  const distinct = new Set(masks.map(m=>m.maskSha256)).size;
  return {size, humans, seeds:VARIATION_SEEDS.length, distinctPassageRidgeMasks:distinct, pass:distinct>=2, masks};
}

module.exports = {checkPlan, passageRidgeMask};

if (require.main === module) {
  const arg = n => { const i = process.argv.indexOf(n); return i<0 ? undefined : process.argv[i+1]; };
  const out = path.resolve(arg('--output-dir') || 'artifacts/TASK-135'), fault = arg('--fault');
  const FAULTS = {'blocked-passage':'contract-probe', 'fixed-seed':'seed-variation'};
  if (fault!==undefined && !FAULTS[fault]) { console.error('Unknown --fault '+fault+'; expected '+Object.keys(FAULTS).join(', ')); process.exit(2); }
  fs.mkdirSync(out,{recursive:true});
  const files = Object.fromEntries(SOURCES.map(f=>[f,sha(fs.readFileSync(f))]));
  fs.writeFileSync(path.join(out,'source-identities.json'), JSON.stringify({node:process.version,files},null,2)+'\n');
  // Production default must not reference the planner yet.
  const production = ['ai/generateMap.js','index.html'].map(f=>({file:f, referencesPlanner:/coop-valley-plan|planDividedValley/.test(fs.readFileSync(f,'utf8'))}));
  const matrix = [], plans = [], variations = [];
  for (const size of SIZES) for (const humans of HUMANS) {
    for (const seed of SEEDS) {
      if (fault==='fixed-seed') break;
      const p = plan.planDividedValley(humans,size,seed), r = checkPlan(p,fault);
      console.log(`${r.failed.length?'FAIL':'PASS'} ${size}-H${humans}-seed${seed} side=${p.side} w=${p.selection.passageWidth} ridge=${p.rows.ridge.join('-')} left=${p.selection.leftX} right=${p.selection.rightX} contract=${r.contract.rejectedBy||'valid'}${r.failed.length?' failed='+r.failed.join(','):''}`);
      matrix.push({size, humans, seed, side:p.side, planSha256:r.planSha256, checks:r.checks, failed:r.failed,
        contractFailed:r.contract.failed, deferredObserved:r.contract.results.filter(x=>!x.required).map(x=>({name:x.name,pass:x.pass}))});
      plans.push({identity:{size,humans,seed,planSha256:r.planSha256,repeatSha256:r.identical?r.planSha256:null,identical:r.identical},
        plan:p, measured:{regionCounts:r.regionCounts, connectivity:r.connectivity, capacity:r.capacity, contract:r.contract}});
    }
    if (fault==='blocked-passage') continue;
    const v = variation(size,humans,fault); variations.push(v);
    console.log(`${v.pass?'PASS':'FAIL'} variation ${size}-H${humans} seeds=0..31 distinctPassageRidgeMasks=${v.distinctPassageRidgeMasks}`);
  }
  const failedCases = matrix.filter(m=>m.failed.length).length, failedVariation = variations.filter(v=>!v.pass).length;
  const productionOk = production.every(p=>!p.referencesPlanner);
  console.log(`${productionOk?'PASS':'FAIL'} production-default-unchanged ${production.map(p=>`${p.file}:referencesPlanner=${p.referencesPlanner}`).join(' ')}`);
  const summary = {matrixCases:matrix.length, failedCases, variationCombos:variations.length, failedVariation, productionOk};
  fs.writeFileSync(path.join(out,'checkpoints.json'), JSON.stringify({mode:fault?'fault':'positive', fault:fault||null,
    intendedAssertion:fault?FAULTS[fault]:null, sizes:SIZES, humans:HUMANS, seeds:SEEDS, variationSeeds:VARIATION_SEEDS,
    deferredContractAssertions:DEFERRED, production, summary, matrix,
    variationCounts:variations.map(({masks,...v})=>v), variations},null,2)+'\n');
  if (!fault) fs.writeFileSync(path.join(out,'region-plans.json'), JSON.stringify({legend:plan.VALLEY_LEGEND,
    note:'grid rows are y; masks/endpoints are cell lists; measured.* is recomputed by the test and TASK-134 contract', plans},null,2)+'\n');
  if (fault) {
    const assertion = FAULTS[fault];
    const rejected = fault==='blocked-passage' ? matrix.filter(m=>m.failed.includes(assertion)) : variations.filter(v=>!v.pass);
    const other = fault==='blocked-passage' ? matrix.filter(m=>m.failed.some(f=>f!==assertion)) : [];
    const contractBy = [...new Set(matrix.flatMap(m=>m.contractFailed))];
    console.log(`REJECTED ${fault} intended=${assertion} rejectedCases=${rejected.length} otherFailures=${other.length}${contractBy.length?' contractFailed='+contractBy.join(','):''}`);
    if (!rejected.length) { console.log('UNEXPECTED fault accepted '+fault); process.exit(3); }
    process.exit(other.length ? 4 : 1);
  }
  const ok = !failedCases && !failedVariation && productionOk && matrix.length===144 && variations.length===36;
  console.log(`${ok?'PASS':'FAIL'} valley-regions cases=${matrix.length-failedCases}/${matrix.length} variation=${variations.length-failedVariation}/${variations.length}`);
  process.exit(ok?0:1);
}
