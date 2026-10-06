// Seeded Circle region planner for hex co-op maps. It fixes the radius and the
// layer bands only (elite core, common portal ring, human town ring); later
// placement stages consume the plan. Not wired into ai/generateMap.js yet.
const circleScaling = typeof getCoopMapScaling === 'function' ? getCoopMapScaling
    : require('./coop-map-scaling.js').getCoopMapScaling
const circleBaselineRadius = typeof baselineRadius === 'function' ? baselineRadius
    : require('./coop-map-scaling.js').baselineRadius
const circleHexCounts = typeof hexCounts === 'function' ? hexCounts
    : require('./coop-map-scaling.js').hexCounts
const circleGeometry = typeof coopHexLayer === 'function'
    ? {coopHexLayer, coopHexCenter, coopHexMapShape, coopHexLattice}
    : require('./coop-hex-geometry.js')

// Portal categories that live in the elite core, eight per human plus the per-map extra heavy portals.
const COOP_CIRCLE_ELITE_CATEGORIES = ['chaos', 'heavy', 'siege', 'mage', 'cavalry']
// Minimum hex distance from every human town to a common ring portal.
const CIRCLE_TOWN_DISTANCE = Object.freeze({tiny: 3, normal: 4, big: 5})
const CIRCLE_MAX_GROWTH = 8
// Grid legend, rows are y.
const CIRCLE_LEGEND = Object.freeze({'.': 'outside the radius', X: 'elite core', o: 'common portal ring',
    T: 'human town ring', '-': 'other playable'})
const circlePlanCache = new Map()

// Scramble the seed before drawing so neighbouring seeds diverge immediately.
function createCircleRandom(seed) {
    let state = seed >>> 0
    state = Math.imul(state ^ (state >>> 16), 0x85ebca6b) >>> 0
    state = Math.imul(state ^ (state >>> 13), 0xc2b2ae35) >>> 0
    state = (state ^ (state >>> 16)) >>> 0
    return function() {
        state = (state + 0x6d2b79f5) >>> 0
        let t = state
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 0x100000000
    }
}

// Odd columns sit half a row lower, matching sprites/sprite.js.
function circleNeighbours(c, side) {
    const shift = c.x % 2 ? 0 : -1
    return [{x:c.x, y:c.y-1}, {x:c.x, y:c.y+1}, {x:c.x-1, y:c.y+shift}, {x:c.x-1, y:c.y+shift+1},
        {x:c.x+1, y:c.y+shift}, {x:c.x+1, y:c.y+shift+1}]
        .filter(n => n.x >= 0 && n.y >= 0 && n.x < side && n.y < side)
}

const circleEliteCache = new Map()

// Elite portals of one map: 8 per human plus the extra heavy portals.
function circleElitePortals(humans, size) {
    const targets = circleScaling(humans, size).counts.portalCategories
    return COOP_CIRCLE_ELITE_CATEGORIES.reduce((sum, c) => sum + targets[c], 0)
}

// Smallest layer whose disc holds one lattice cell per elite portal and three
// cells per elite portal (each portal keeps two approach cells). On big the disc
// also holds one elite neutral-town 3x3 box (9 cells) per human.
function circleEliteMinimum(radius, humans, size) {
    const id = `${radius}:${humans}:${size}`
    if (circleEliteCache.has(id)) return circleEliteCache.get(id)
    const center = circleGeometry.coopHexCenter(radius), side = 2 * radius + 1
    const cells = new Array(radius + 1).fill(0), lattice = new Array(radius + 1).fill(0)
    for (let x = 0; x < side; x++) for (let y = 0; y < side; y++) {
        const layer = circleGeometry.coopHexLayer(x, y, center)
        if (layer > radius) continue
        cells[layer]++
        if (circleGeometry.coopHexLattice(x, y)) lattice[layer]++
    }
    const eliteTownCells = size === 'big' ? 9 * humans : 0, elitePortals = circleElitePortals(humans, size)
    let minimum = radius
    for (let layer = 0, total = 0, onLattice = 0; layer <= radius; layer++) {
        total += cells[layer]; onLattice += lattice[layer]
        if (onLattice >= elitePortals && total >= 3 * elitePortals + eliteTownCells) { minimum = layer; break }
    }
    circleEliteCache.set(id, minimum)
    return minimum
}

const circleLatticeCache = new Map()

// Lattice cells per layer of a radius-R disc.
function circleLayerLattice(radius) {
    if (circleLatticeCache.has(radius)) return circleLatticeCache.get(radius)
    const center = circleGeometry.coopHexCenter(radius), side = 2 * radius + 1, lattice = new Array(radius + 1).fill(0)
    for (let x = 0; x < side; x++) for (let y = 0; y < side; y++) {
        const layer = circleGeometry.coopHexLayer(x, y, center)
        if (layer <= radius && circleGeometry.coopHexLattice(x, y)) lattice[layer]++
    }
    circleLatticeCache.set(radius, lattice)
    return lattice
}

// Ring lattice cells per common ring portal. Ring groups keep CIRCLE_GROUP_GAP
// from each other, so a ring with fewer cells (a tiny map whose elite core grew
// for the elite portals) has no site for its last groups.
const CIRCLE_RING_LATTICE_PER_PORTAL = 2
// Common ring portals of one map (melee + ranged, 6 per human).
const circleRingPortals = targets => targets.melee + targets.ranged

// Layer bands. The elite core is R/6, grown only when the elite portals would
// not fit. The common ring ends at R/2, extended outwards while it holds fewer
// than CIRCLE_RING_LATTICE_PER_PORTAL lattice cells per ring portal. Layer is
// 1-Lipschitz, so ringOuter <= townRing - D keeps every ring cell at hex
// distance >= D from the whole town ring.
function circleRegions(radius, size, humans) {
    const elite = Math.max(Math.floor(radius / 6), circleEliteMinimum(radius, humans, size)), townRing = radius - 3
    const limit = townRing - CIRCLE_TOWN_DISTANCE[size], lattice = circleLayerLattice(radius)
    const targets = circleScaling(humans, size).counts.portalCategories
    const need = CIRCLE_RING_LATTICE_PER_PORTAL * circleRingPortals(targets)
    let ringOuter = Math.floor(3 * radius / 6), have = 0
    for (let layer = elite + 1; layer <= ringOuter; layer++) have += lattice[layer]
    while (have < need && ringOuter < limit) have += lattice[++ringOuter]
    return {elite, ringInner: elite + 1, ringOuter: Math.min(ringOuter, limit), townRing}
}

// Capacity numbers and their requirements at one candidate radius.
function circleCapacityAt(humans, size, radius) {
    const counts = circleScaling(humans, size).counts, terrain = circleHexCounts(radius)
    const regions = circleRegions(radius, size, humans), center = circleGeometry.coopHexCenter(radius)
    const side = 2 * radius + 1
    let eliteCells = 0, eliteLattice = 0, ringCells = 0, ringLattice = 0, townRingLattice = 0, playable = 0
    for (let x = 0; x < side; x++) for (let y = 0; y < side; y++) {
        const layer = circleGeometry.coopHexLayer(x, y, center)
        if (layer > radius) continue
        playable++
        const lattice = circleGeometry.coopHexLattice(x, y)
        if (layer <= regions.elite) { eliteCells++; if (lattice) eliteLattice++ }
        else if (layer <= regions.ringOuter) { ringCells++; if (lattice) ringLattice++ }
        if (layer === regions.townRing && lattice) townRingLattice++
    }
    const elitePortals = circleElitePortals(humans, size), ringPortals = circleRingPortals(counts.portalCategories)
    const outsideReserved = 9 * (humans + counts.neutralTowns) + counts.goldmines + 3 * (counts.portals - counts.portalCategories.heavy + humans)
    const reserved = eliteCells + outsideReserved
    // Nothing is placed yet, so every elite cell is free; each elite portal keeps two approach cells.
    const rows = {
        eliteLattice: {have: eliteLattice, need: elitePortals},
        eliteApproach: {have: eliteCells - elitePortals, need: 2 * elitePortals},
        ringLattice: {have: ringLattice, need: ringPortals},
        townRingLattice: {have: townRingLattice, need: humans},
        townRingGap: {have: regions.townRing, need: regions.elite + 2},
        eliteDepth: {have: regions.elite, need: 1},
        outsideElite: {have: playable - eliteCells, need: outsideReserved},
        terrain: {have: playable - reserved, need: terrain.mountains + terrain.lakes + terrain.bushes}
    }
    // Per-human neutral-town 3x3 boxes: two in the common ring on normal/big (after
    // 3 x 6h ring portal-plus-approach cells), one in the elite core on big (after the
    // elite portal-plus-approach cells).
    if (size !== 'tiny') rows.ringNeutral = {have: ringCells - 3 * ringPortals, need: 2 * 9 * humans}
    if (size === 'big') rows.eliteNeutral = {have: eliteCells - 3 * elitePortals, need: 9 * humans}
    for (const row of Object.values(rows)) row.slack = row.have - row.need
    return {radius, playable, eliteCells, regions, rows, ok: Object.values(rows).every(row => row.slack >= 0)}
}

// Grow from the preset baseline only while the capacity predicate fails.
function circleRadiusPlan(humans, size) {
    const id = `${size}:${humans}`
    if (circlePlanCache.has(id)) return circlePlanCache.get(id)
    const baseline = circleBaselineRadius(humans, size)
    let radius = baseline, capacity = circleCapacityAt(humans, size, radius)
    while (!capacity.ok) {
        if (radius >= baseline + CIRCLE_MAX_GROWTH) {
            throw new Error(`Circle has no feasible radius: size=${size} humans=${humans} baseline=${baseline}`)
        }
        radius++
        capacity = circleCapacityAt(humans, size, radius)
    }
    const plan = {baseline, radius, growth: radius - baseline, capacity}
    circlePlanCache.set(id, plan)
    return plan
}

function clearCirclePlanCache() {
    circlePlanCache.clear()
}

function planCoopCircle(humans, size = 'normal', seed = 1) {
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
        throw new RangeError('Circle seed must be an unsigned 32-bit integer')
    }
    const radiusPlan = circleRadiusPlan(humans, size), radius = radiusPlan.radius, side = 2 * radius + 1
    const regions = radiusPlan.capacity.regions, center = circleGeometry.coopHexCenter(radius)
    const terrain = circleHexCounts(radius)
    const grid = []
    for (let y = 0; y < side; y++) {
        let line = ''
        for (let x = 0; x < side; x++) {
            const layer = circleGeometry.coopHexLayer(x, y, center)
            line += layer > radius ? '.' : layer <= regions.elite ? 'X'
                : layer <= regions.ringOuter ? 'o' : layer === regions.townRing ? 'T' : '-'
        }
        grid.push(line)
    }
    const cellsOf = ch => {
        const cells = []
        for (let x = 0; x < side; x++) for (let y = 0; y < side; y++) if (grid[y][x] === ch) cells.push({x, y})
        return cells
    }
    return {
        version: 1, size, humans, seed, radius, side, mapSize: {x: side, y: side},
        mapShape: circleGeometry.coopHexMapShape(radius), center,
        counts: {...circleScaling(humans, size).counts, playable: terrain.playable,
            mountains: terrain.mountains, lakes: terrain.lakes, bushes: terrain.bushes},
        eliteCategories: COOP_CIRCLE_ELITE_CATEGORIES.slice(), townDistance: CIRCLE_TOWN_DISTANCE[size],
        legend: CIRCLE_LEGEND, regions: {...regions},
        masks: {elite: cellsOf('X'), ring: cellsOf('o'), townRing: cellsOf('T'), other: cellsOf('-'), outside: cellsOf('.')},
        capacity: {baselineRadius: radiusPlan.baseline, growth: radiusPlan.growth,
            playable: radiusPlan.capacity.playable, eliteCells: radiusPlan.capacity.eliteCells,
            rows: JSON.parse(JSON.stringify(radiusPlan.capacity.rows))},
        grid
    }
}

const circleStartScaling = typeof getCoopMapScaling === 'function' ? getCoopMapScaling
    : require('./coop-map-scaling.js').getCoopMapScaling
const CIRCLE_NEUTRAL_RGB = Object.freeze({r: 208, g: 208, b: 208})
const CIRCLE_OFFSETS3 = Object.freeze([-1, 0, 1].flatMap(dy => [-1, 0, 1].map(dx => Object.freeze({x: dx, y: dy}))))
const circleChebyshev = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y))
const circleHexDistance = (a, b) => circleGeometry.coopHexLayer(a.x, a.y, {q: b.x, r: b.y - Math.floor(b.x / 2)})
// Target hex distance between human towns, and seeded ring walks tried per spacing before relaxing it.
const CIRCLE_START_SPACING = 12
const CIRCLE_START_ATTEMPTS = 64

function circleShuffler(seed) {
    const rng = createCircleRandom(seed >>> 0)
    return list => {
        for (let i = list.length - 1; i > 0; i--) {
            const j = Math.floor(rng() * (i + 1))
            ;[list[i], list[j]] = [list[j], list[i]]
        }
        return list
    }
}

// Town ring cells in angular order around the centre cell (R, R). Pixel
// positions follow sprites/sprite.js: columns 3/4 of a hex apart, odd columns half a row lower.
function circleRingOrder(plan, layer) {
    const {side, center} = plan, cells = []
    const cx = 1.5 * plan.radius, cy = Math.sqrt(3) * (plan.radius + 0.5 * (plan.radius & 1))
    for (let x = 0; x < side; x++) for (let y = 0; y < side; y++) {
        if (circleGeometry.coopHexLayer(x, y, center) !== layer) continue
        cells.push({x, y, angle: Math.atan2(Math.sqrt(3) * (y + 0.5 * (x & 1)) - cy, 1.5 * x - cx)})
    }
    return cells.sort((a, b) => a.angle - b.angle).map(c => ({x: c.x, y: c.y}))
}

// Layer of every cell id (y * side + x), shared per radius; the plan center is
// always coopHexCenter(radius). circlePassableConnected runs once per candidate
// placement, so recomputing layers there dominated generation time.
const circleLayerTables = new Map()
function circleLayerTable(plan) {
    let table = circleLayerTables.get(plan.radius)
    if (!table) {
        const {side, center} = plan
        table = new Int16Array(side * side)
        for (let id = 0; id < side * side; id++) table[id] = circleGeometry.coopHexLayer(id % side, Math.floor(id / side), center)
        circleLayerTables.set(plan.radius, table)
    }
    return table
}

// Free cells (layer <= R, not solid) form one component and every listed object
// touches it. Cells with layer > R are always solid (InvisibleMountain at runtime).
function circlePassableConnected(plan, solid, objects) {
    const {side, radius} = plan, layers = circleLayerTable(plan)
    const inside = id => layers[id] <= radius
    const seen = new Uint8Array(side * side), queue = []
    let open = 0
    for (let id = 0; id < side * side; id++) if (inside(id) && !solid.has(id)) {
        open++
        if (!queue.length) { queue.push(id); seen[id] = 1 }
    }
    for (let i = 0; i < queue.length; i++) {
        const x = queue[i] % side
        for (const n of circleNeighbours({x, y: (queue[i] - x) / side}, side)) {
            const id = n.y * side + n.x
            if (!seen[id] && inside(id) && !solid.has(id)) { seen[id] = 1; queue.push(id) }
        }
    }
    return queue.length === open && objects.every(id => {
        const x = id % side
        return circleNeighbours({x, y: (id - x) / side}, side).some(n => seen[n.y * side + n.x])
    })
}

// Starting towns on the town ring (layer R-3); no mines (every mine is neutral,
// placed by placeCircleExpansions). Towns are not evenly spaced. For a target
// spacing S starting at CIRCLE_START_SPACING, up to min(CIRCLE_START_ATTEMPTS, N)
// seeded walks are tried; walk a is the a-th shuffle of the ring indices drawn
// from one seeded shuffler. A walk greedily keeps a ring cell at hex distance
// >= S and Chebyshev >= 3 from every town already kept, and succeeds once
// `humans` towns are kept. If every walk fails, S drops by one; Chebyshev >= 3
// is never relaxed. ring.spacing is the S achieved. Slots follow ring order.
// Each town's 3x3 neighbourhood is reserved.
function placeCircleStarts(plan, colorOf = typeof coopPlayerColor === 'function' ? coopPlayerColor : null) {
    if (typeof colorOf !== 'function') throw new TypeError('Circle starts require coopPlayerColor')
    const {side, humans, radius} = plan
    const assets = circleStartScaling(humans, plan.size).startingAssets
    const ring = circleRingOrder(plan, plan.regions.townRing), N = ring.length
    const shuffle = circleShuffler(plan.seed ^ 0x9e3779b9), walks = []
    const walkOf = a => walks[a] || (walks[a] = shuffle([...Array(N).keys()]))
    let indices = null, spacing = null
    for (let S = CIRCLE_START_SPACING; S >= 0 && !indices; S--) {
        for (let attempt = 0; attempt < Math.min(CIRCLE_START_ATTEMPTS, N) && !indices; attempt++) {
            const kept = []
            for (const k of walkOf(attempt)) {
                if (kept.length === humans) break
                if (kept.every(j => circleHexDistance(ring[k], ring[j]) >= S && circleChebyshev(ring[k], ring[j]) >= 3)) kept.push(k)
            }
            if (kept.length === humans) { indices = kept.sort((a, b) => a - b); spacing = S }
        }
    }
    if (!indices) throw new Error(`Circle has no town ring sites: size=${plan.size} humans=${humans}`)
    const towns = indices.map(k => ring[k]), start = indices[0]
    const idOf = c => c.y * side + c.x, cell = id => ({x: id % side, y: Math.floor(id / side)})
    const reserved = new Set()
    for (const t of towns) for (const o of CIRCLE_OFFSETS3) reserved.add(idOf({x: t.x + o.x, y: t.y + o.y}))
    return {
        version: 1, size: plan.size, humans, seed: plan.seed, side, mapSize: plan.mapSize, radius,
        stages: ['towns', 'reserve-neighbourhoods'],
        ring: {layer: plan.regions.townRing, cells: N, start, indices, spacing},
        players: [{slot: 0, rgb: {...CIRCLE_NEUTRAL_RGB}, towns: [], units: [], gold: 0},
            ...towns.map((t, i) => ({slot: i + 1, rgb: colorOf(i + 1), gold: assets.gold, units: [], towns: [{x: t.x, y: t.y}]}))],
        reserved: [...reserved].sort((a, b) => a - b).map(cell),
        goldmines: [],
        assignments: []
    }
}

const CIRCLE_ACCESS_DISPARITY = 4
const CIRCLE_NEUTRAL_TARGET = 2
const CIRCLE_MINE_CLEARANCE = 4
const CIRCLE_NEUTRAL_SPACING = 5
const CIRCLE_EXPANSION_PASSES = 6
// Neutral-town kinds per human by size, and hex distance windows from the owner's town.
const CIRCLE_NEUTRAL_KINDS = Object.freeze({tiny: Object.freeze(['gap', 'far']), normal: Object.freeze(['gap', 'far', 'ring', 'ring']),
    big: Object.freeze(['gap', 'far', 'ring', 'ring', 'elite'])})
const CIRCLE_GAP_HEX = Object.freeze({min: 5, max: 9})
const CIRCLE_FAR_GAP_HEX = Object.freeze({min: 10, max: 15})
const CIRCLE_RING_HEX = Object.freeze({min: 5, max: 10})

// Neutral towns and every gold mine after placeCircleStarts. Each human gets
// the neutral-town kinds of CIRCLE_NEUTRAL_KINDS[size], placed in slot order:
// 'gap' has its whole 3x3 at ringOuter < layer <= R and hex distance
// CIRCLE_GAP_HEX from its owner's town; 'far' uses the gap sites, preferring
// hex distance CIRCLE_FAR_GAP_HEX and otherwise taking the valid gap site whose
// distance lies least outside that window, the farther side first (relaxed);
// 'ring' has the town at E < layer <=
// ringOuter and the whole 3x3 at layer > E, preferring hex distance
// CIRCLE_RING_HEX and otherwise taking the nearest site at hex distance >= 5
// (relaxed, for large maps); 'elite' has the town at layer <= E and is the
// nearest valid site to its owner. Every 3x3 is inside the radius, clear of
// reservations and other neutral 3x3s, at hex distance >= CIRCLE_NEUTRAL_SPACING
// from every other neutral town; gap, far and ring towns are not strictly closer to
// another human's town than to their owner's. Candidates are shuffled, and a
// pass must leave the spread of each human's nearest neutral-town path within
// CIRCLE_ACCESS_DISPARITY. Mines are all neutral (owner 0), outside the elite
// core (layer > E), off reservations and at hex distance >= CIRCLE_MINE_CLEARANCE
// from every human town, chosen greedily for the lowest nearest-mine path
// spread. Paths treat layer > R and other humans' towns as solid; neutral towns
// and mines are endpoints. Passable connectivity is re-checked after every placement.
function placeCircleExpansions(plan, starts) {
    const {side, humans, radius, center, counts} = plan, elite = plan.regions.elite
    const shuffle = circleShuffler(plan.seed ^ 0x85ebca6b)
    const cell = id => ({x: id % side, y: Math.floor(id / side)}), idOf = c => c.y * side + c.x
    const layers = new Int32Array(side * side)
    for (let id = 0; id < side * side; id++) layers[id] = circleGeometry.coopHexLayer(id % side, Math.floor(id / side), center)
    const layerOf = id => layers[id]
    const towns = starts.players.slice(1).map(p => p.towns[0]), townIds = towns.map(idOf)
    const neutral = [], mineIds = new Set()
    const reserved = new Set(starts.reserved.map(idOf)), townMask = new Uint8Array(side * side)
    for (const id of townIds) townMask[id] = 1
    // Neighbour ids inside the radius as flat offset/list arrays; the BFS runs
    // once per human per check, so it stays allocation-free.
    const adjacentStart = new Int32Array(side * side + 1), adjacentList = []
    for (let id = 0; id < side * side; id++) {
        adjacentStart[id] = adjacentList.length
        if (layers[id] <= radius) for (const n of circleNeighbours(cell(id), side)) if (layers[idOf(n)] <= radius) adjacentList.push(idOf(n))
    }
    adjacentStart[side * side] = adjacentList.length
    const adjacent = Int32Array.from(adjacentList), queue = new Int32Array(side * side)
    const distances = (i, endpoints) => {
        const distance = new Int32Array(side * side).fill(-1)
        let tail = 1
        queue[0] = townIds[i]; distance[townIds[i]] = 0
        for (let k = 0; k < tail; k++) {
            const cid = queue[k]
            if (k > 0 && endpoints[cid]) continue
            for (let j = adjacentStart[cid]; j < adjacentStart[cid + 1]; j++) {
                const id = adjacent[j]
                if (distance[id] >= 0 || townMask[id]) continue
                distance[id] = distance[cid] + 1; queue[tail++] = id
            }
        }
        return distance
    }
    const fields = () => {
        const endpoints = new Uint8Array(side * side)
        for (const id of [...mineIds, ...neutral]) endpoints[id] = 1
        return towns.map((_, i) => distances(i, endpoints))
    }
    const connected = () => {
        const objects = [...townIds, ...neutral, ...mineIds]
        return circlePassableConnected(plan, new Set(objects), objects)
    }
    const spread = values => Math.max(...values) - Math.min(...values)
    const nearestNeutral = d => d.map(di => Math.min(...neutral.map(id => di[id] < 0 ? Infinity : di[id])))
    const box = id => CIRCLE_OFFSETS3.map(o => ({x: id % side + o.x, y: Math.floor(id / side) + o.y}))
    // Candidate sites per kind: whole 3x3 in bounds, inside the radius and off reservations.
    const ringOuter = plan.regions.ringOuter, sites = {gap: [], ring: [], elite: []}
    for (let id = 0; id < side * side; id++) {
        if (layerOf(id) > radius) continue
        const cells = box(id)
        if (!cells.every(c => c.x >= 0 && c.y >= 0 && c.x < side && c.y < side && layerOf(idOf(c)) <= radius
            && !reserved.has(idOf(c)))) continue
        const boxLayers = cells.map(c => layerOf(idOf(c)))
        if (boxLayers.every(l => l > ringOuter)) sites.gap.push(id)
        if (layerOf(id) > elite && layerOf(id) <= ringOuter && boxLayers.every(l => l > elite)) sites.ring.push(id)
        if (layerOf(id) <= elite) sites.elite.push(id)
    }
    const kinds = CIRCLE_NEUTRAL_KINDS[plan.size], neutralAssignments = []
    const within = (d, range) => d >= range.min && d <= range.max
    const byHex = (list, hexOf) => list.map(id => [id, hexOf(id)]).sort((p, q) => p[1] - q[1]).map(p => p[0])
    // One pass over humans in slot order; false when a kind has no connected
    // site or the final nearest-neutral spread is too wide.
    const placeNeutral = () => {
        neutral.length = 0; neutralAssignments.length = 0
        const taken = new Set()
        for (let i = 0; i < humans; i++) for (const kind of kinds) {
            const hexOf = id => circleHexDistance(cell(id), towns[i])
            const valid = sites[kind === 'far' ? 'gap' : kind].filter(id => !box(id).some(c => taken.has(idOf(c)))
                && !neutral.some(n => circleHexDistance(cell(id), cell(n)) < CIRCLE_NEUTRAL_SPACING)
                && (kind === 'elite' || towns.every(t => circleHexDistance(cell(id), t) >= hexOf(id))))
            // [candidates, relaxed] tiers, tried in order.
            // Far fallback: least distance outside the window first, then the farther side, then shuffled order.
            const farMiss = id => Math.max(CIRCLE_FAR_GAP_HEX.min - hexOf(id), hexOf(id) - CIRCLE_FAR_GAP_HEX.max)
            const tiers = kind === 'gap' ? [[shuffle(valid.filter(id => within(hexOf(id), CIRCLE_GAP_HEX))), false]]
                : kind === 'far' ? [[shuffle(valid.filter(id => within(hexOf(id), CIRCLE_FAR_GAP_HEX))), false],
                    [shuffle(valid.filter(id => !within(hexOf(id), CIRCLE_FAR_GAP_HEX))).map(id => [id, farMiss(id), hexOf(id)])
                        .sort((p, q) => p[1] - q[1] || q[2] - p[2]).map(p => p[0]), true]]
                : kind === 'ring' ? [[shuffle(valid.filter(id => within(hexOf(id), CIRCLE_RING_HEX))), false],
                    [byHex(shuffle(valid.filter(id => hexOf(id) > CIRCLE_RING_HEX.max)), hexOf), true]]
                : [[byHex(shuffle(valid), hexOf), false]]
            let placed = false
            search: for (const [candidates, relaxed] of tiers) for (const id of candidates) {
                neutral.push(id)
                if (connected()) {
                    box(id).forEach(c => taken.add(idOf(c)))
                    neutralAssignments.push({slot: i + 1, kind, ...cell(id), hexDistance: hexOf(id), relaxed})
                    placed = true
                    break search
                }
                neutral.pop()
            }
            if (!placed) return false
        }
        return !neutral.length || spread(nearestNeutral(fields())) <= CIRCLE_ACCESS_DISPARITY
    }
    if (![...Array(CIRCLE_EXPANSION_PASSES)].some(placeNeutral))
        throw new Error(`Circle has no fair neutral town layout: size=${plan.size} humans=${humans} seed=${plan.seed}`)
    for (const id of neutral) for (const c of box(id)) reserved.add(idOf(c))
    const mineSites = []
    for (let id = 0; id < side * side; id++) {
        if (layerOf(id) <= elite || layerOf(id) > radius || reserved.has(id) || townMask[id]) continue
        if (towns.every(t => circleHexDistance(cell(id), t) >= CIRCLE_MINE_CLEARANCE)) mineSites.push(id)
    }
    const nearestMine = d => d.map(di => Math.min(...[...mineIds].map(id => di[id] < 0 ? Infinity : di[id])))
    const neutralFair = d => !neutral.length || spread(nearestNeutral(d)) <= CIRCLE_ACCESS_DISPARITY
    // One greedy pass over the mine sites, lowest resulting nearest-mine spread
    // first; false when sites run out or the final spread is too wide.
    const placeMines = () => {
        mineIds.clear()
        for (let k = 0; k < counts.goldmines; k++) {
            const d = fields(), current = mineIds.size ? nearestMine(d) : towns.map(() => Infinity), tiers = new Map()
            for (const id of mineSites) {
                if (mineIds.has(id)) continue
                const next = d.map((di, i) => di[id] < 0 ? Infinity : Math.min(current[i], di[id]))
                if (!next.every(Number.isFinite)) continue
                const tier = Math.max(CIRCLE_NEUTRAL_TARGET, spread(next))
                if (!tiers.has(tier)) tiers.set(tier, [])
                tiers.get(tier).push(id)
            }
            let placed = false
            search: for (const tier of [...tiers.keys()].sort((a, b) => a - b)) {
                for (const id of shuffle(tiers.get(tier))) {
                    mineIds.add(id)
                    if (connected() && neutralFair(fields())) { placed = true; break search }
                    mineIds.delete(id)
                }
            }
            if (!placed) return false
        }
        const d = fields(), nearest = nearestMine(d)
        return nearest.every(Number.isFinite) && spread(nearest) <= CIRCLE_ACCESS_DISPARITY && neutralFair(d)
    }
    if (![...Array(CIRCLE_EXPANSION_PASSES)].some(placeMines))
        throw new Error(`Circle has no fair mine layout: size=${plan.size} humans=${humans} seed=${plan.seed}`)
    const mines = [...mineIds], nearestMines = nearestMine(fields())
    const nearest = neutral.length ? nearestNeutral(fields()) : []
    return {
        version: 1, size: plan.size, humans, seed: plan.seed, side, mapSize: plan.mapSize, radius,
        stages: [...starts.stages, 'neutral-towns', 'reserve-neutral-neighbourhoods', 'neutral-mines'],
        ring: {...starts.ring, indices: starts.ring.indices.slice()},
        players: [{...starts.players[0], towns: neutral.map(cell)},
            ...starts.players.slice(1).map(p => ({...p, towns: p.towns.map(t => ({...t}))}))],
        reserved: [...reserved].sort((a, b) => a - b).map(cell),
        goldmines: mines.map(id => ({...cell(id), owner: 0, income: 20})),
        assignments: starts.assignments.map(a => ({...a, mine: {...a.mine}})),
        expansions: {neutralTowns: neutral.map(cell), neutralAssignments: neutralAssignments.map(a => ({...a})), mines: mines.map(cell),
            nearestNeutralDistance: nearest, neutralSpread: nearest.length ? spread(nearest) : 0,
            nearestMineDistance: nearestMines, mineSpread: spread(nearestMines)}
    }
}

// Common ring categories in the per-human deal order; COOP_CIRCLE_ELITE_CATEGORIES
// fill the elite core.
const COOP_CIRCLE_RING_CATEGORIES = Object.freeze(['melee', 'ranged'])
// Per-human ring portal groups: three melee+ranged pairs. Members of a group are at
// hex distance 1-2 from each other; portals of different groups are at hex distance >= CIRCLE_GROUP_GAP.
const COOP_CIRCLE_RING_GROUPS = Object.freeze([...Array(3)].map(() =>
    Object.freeze({kind: 'pair', categories: Object.freeze(['melee', 'ranged'])})))
const CIRCLE_GROUP_SPAN = 2
const CIRCLE_GROUP_GAP = 3

// Portals after placeCircleExpansions. Elite categories sit on elite lattice
// cells (layer <= E); common categories sit in the ring E < layer <= ringOuter,
// which keeps them at hex distance >= D from every human town. Lattice cells
// are preferred. Elite portals touch no other portal. Ring portals form
// COOP_CIRCLE_RING_GROUPS per human: every member within CIRCLE_GROUP_SPAN of
// the others, at least CIRCLE_GROUP_GAP from other groups, and a group that
// cannot be completed is retried from another first member.
// Every portal keeps two distinct free approach cells (bipartite matching) that
// are not portals, towns, mines or reservations, and the passable region stays
// connected after every placement. Each human's first pair starts at the nearest
// reachable ring cell to that human's town, keeping the nearest-portal path
// spread level for the terrain stage; the other pairs start from the shuffled candidates.
function placeCirclePortals(plan, layout) {
    const {side, humans, radius} = plan, {elite, ringOuter} = plan.regions
    const targets = circleScaling(humans, plan.size).counts.portalCategories
    const shuffle = circleShuffler(plan.seed ^ 0xc2b2ae35)
    const cell = id => ({x: id % side, y: Math.floor(id / side)}), idOf = c => c.y * side + c.x
    const layers = circleLayerTable(plan), layerOf = id => layers[id]
    const townIds = layout.players.flatMap(p => p.towns.map(idOf)), mineIds = layout.goldmines.map(idOf)
    const occupied = new Set([...townIds, ...mineIds]), reserved = new Set(layout.reserved.map(idOf))
    const around = id => circleNeighbours(cell(id), side).map(idOf).filter(n => layerOf(n) <= radius)
    // groupOf[i]: index into portalGroups for ring portals, -1 for elite portals.
    const portals = [], categories = [], groupOf = [], portalGroups = [], portalSet = new Set()
    const hex = (a, b) => circleHexDistance(cell(a), cell(b))
    const free = n => !occupied.has(n) && !reserved.has(n) && !portalSet.has(n)
    // Two distinct approach cells per portal, or null.
    const approaches = () => {
        const options = portals.map(id => around(id).filter(free)), owner = new Map()
        const augment = (slot, seen) => {
            for (const n of options[slot >> 1]) {
                if (seen.has(n)) continue
                seen.add(n)
                if (!owner.has(n) || augment(owner.get(n), seen)) { owner.set(n, slot); return true }
            }
            return false
        }
        for (let slot = 0; slot < 2 * portals.length; slot++) if (!augment(slot, new Set())) return null
        const result = portals.map(() => [])
        for (const [n, slot] of owner) result[slot >> 1].push(n)
        return result.map(list => list.sort((a, b) => a - b))
    }
    const connected = () => {
        const objects = [...occupied, ...portals]
        return circlePassableConnected(plan, new Set(objects), objects)
    }
    // Each human's share of a region's categories, repeated once per human; the
    // per-map remainder (the extra heavy portals) comes last.
    const deal = list => [...Array.from({length: humans}, () => list.flatMap(c => Array(Math.floor(targets[c] / humans)).fill(c))).flat(),
        ...list.flatMap(c => Array(targets[c] % humans).fill(c))]
    const groups = [
        {region: 'elite', inside: layer => layer <= elite, sequence: deal(COOP_CIRCLE_ELITE_CATEGORIES)},
        {region: 'ring', inside: layer => layer > elite && layer <= ringOuter, sequence: deal(COOP_CIRCLE_RING_CATEGORIES)}
    ]
    // Path distance from one human town: layer > R and human towns solid; mines,
    // neutral towns and placed portals are entered but never expanded.
    const townSet = new Set(layout.players.slice(1).map(p => idOf(p.towns[0])))
    const pathFrom = origin => {
        const distance = new Int32Array(side * side).fill(-1), queue = [origin]
        distance[origin] = 0
        for (let k = 0; k < queue.length; k++) {
            const c = queue[k]
            if (k > 0 && (occupied.has(c) || portalSet.has(c))) continue
            for (const n of around(c)) if (distance[n] < 0 && !townSet.has(n)) { distance[n] = distance[c] + 1; queue.push(n) }
        }
        return distance
    }
    // Elite portals touch no portal; ring portals keep CIRCLE_GROUP_GAP from
    // other ring groups (members of their own group are filtered by the caller).
    const tryPlace = (id, category, group = -1) => {
        if (portalSet.has(id)) return false
        if (portals.some((p, i) => {
            const d = hex(p, id)
            return group >= 0 && groupOf[i] >= 0 ? groupOf[i] !== group && d < CIRCLE_GROUP_GAP : d < 2
        })) return false
        portals.push(id); portalSet.add(id)
        if (connected() && approaches()) { categories.push(category); groupOf.push(group); return true }
        portals.pop(); portalSet.delete(id)
        return false
    }
    const unplace = () => { portalSet.delete(portals.pop()); categories.pop(); groupOf.pop() }
    // Distance from a cell to the nearest placed ring portal (Infinity if none).
    const ringGap = id => portals.reduce((m, p, i) => groupOf[i] >= 0 ? Math.min(m, hex(p, id)) : m, Infinity)
    // Places one ring group: the first member from firsts, every later member
    // within CIRCLE_GROUP_SPAN of all placed members; backtracks on dead ends.
    // Packed placement tries the closest member cells first.
    const placeGroup = (group, slot, firsts, candidates, packed) => {
        const index = portalGroups.length, members = []
        const extend = k => {
            if (k === group.categories.length) return true
            let pool = k ? candidates.filter(id => members.every(m => hex(portals[m], id) <= CIRCLE_GROUP_SPAN)) : firsts
            if (k && packed) {
                const spread = id => members.reduce((sum, m) => sum + hex(portals[m], id), 0)
                pool = pool.sort((a, b) => spread(a) - spread(b))
            }
            for (const id of pool) {
                if (!tryPlace(id, group.categories[k], index)) continue
                members.push(portals.length - 1)
                if (extend(k + 1)) return true
                members.pop(); unplace()
            }
            return false
        }
        if (!extend(0)) throw new Error(`Circle has no ring portal site: size=${plan.size} humans=${humans} seed=${plan.seed} category=${group.categories.join('+')} slot=${slot}`)
        portalGroups.push({slot, kind: group.kind, members})
    }
    // First pairs first, one per human: the first member is tried in order of path
    // distance from that human's town, so nearest-portal distances start level.
    // The other pairs start from the shuffled candidates; packed placement instead starts
    // each pair next to the placed ring portals (closest gap first, then
    // cells on the band edges).
    const placeRing = (candidates, packed) => {
        layout.players.slice(1).forEach((p, i) => {
            const d = pathFrom(idOf(p.towns[0]))
            const firsts = candidates.filter(id => d[id] > 0).sort((a, b) => d[a] - d[b])
            placeGroup(COOP_CIRCLE_RING_GROUPS[0], i + 1, firsts, candidates, packed)
        })
        layout.players.slice(1).forEach((p, i) => COOP_CIRCLE_RING_GROUPS.slice(1).forEach(g => {
            let firsts = candidates
            if (packed) {
                const edge = id => Math.min(layerOf(id) - elite - 1, ringOuter - layerOf(id))
                const key = new Map(candidates.map(id => [id, ringGap(id) * side + edge(id)]))
                firsts = candidates.slice().sort((a, b) => key.get(a) - key.get(b))
            }
            placeGroup(g, i + 1, firsts, candidates, packed)
        }))
    }
    for (const group of groups) {
        const lattice = [], rest = []
        for (let id = 0; id < side * side; id++) {
            if (!group.inside(layerOf(id)) || occupied.has(id) || reserved.has(id)) continue
            ;(circleGeometry.coopHexLattice(id % side, Math.floor(id / side)) ? lattice : rest).push(id)
        }
        const candidates = [...shuffle(lattice), ...shuffle(rest)]
        if (group.region === 'ring') {
            const dealt = COOP_CIRCLE_RING_GROUPS.flatMap(g => g.categories)
            if (group.sequence.join() !== Array(humans).fill(COOP_CIRCLE_RING_CATEGORIES.flatMap(c => dealt.filter(k => k === c))).flat().join())
                throw new Error(`Circle ring groups do not match the portal categories: size=${plan.size} humans=${humans} seed=${plan.seed}`)
            // Small rings may not fit spread-out groups: retry them packed.
            try { placeRing(candidates, false) } catch (error) {
                while (groupOf.length && groupOf[groupOf.length - 1] >= 0) unplace()
                portalGroups.length = 0
                placeRing(candidates, true)
            }
            continue
        }
        for (const category of group.sequence) {
            if (!candidates.some(id => tryPlace(id, category)))
                throw new Error(`Circle has no ${group.region} portal site: size=${plan.size} humans=${humans} seed=${plan.seed} category=${category}`)
        }
    }
    const categoryCounts = Object.fromEntries(Object.keys(targets).map(c => [c, categories.filter(k => k === c).length]))
    if (Object.keys(targets).some(c => categoryCounts[c] !== targets[c]))
        throw new Error(`Circle portal categories do not match: size=${plan.size} humans=${humans} seed=${plan.seed}`)
    const assigned = approaches()
    return {
        ...layout,
        stages: [...layout.stages, 'portals', 'reserve-portal-approaches'],
        ring: {...layout.ring, indices: layout.ring.indices.slice()},
        players: layout.players.map(p => ({...p, towns: p.towns.map(t => ({...t}))})),
        reserved: [...new Set([...reserved, ...assigned.flat()])].sort((a, b) => a - b).map(cell),
        goldmines: layout.goldmines.map(m => ({...m})),
        assignments: layout.assignments.map(a => ({...a, mine: {...a.mine}})),
        expansions: JSON.parse(JSON.stringify(layout.expansions)),
        portals: portals.map((id, i) => ({...cell(id), category: categories[i]})),
        portalCategories: categoryCounts,
        portalGroups: portalGroups.map(g => ({slot: g.slot, kind: g.kind, members: g.members.slice()})),
        portalApproaches: portals.map((id, i) => ({portal: cell(id), cells: assigned[i].map(cell)}))
    }
}

const CIRCLE_TERRAIN_KINDS = Object.freeze({mountains: 1, lakes: 2, bushes: 3})
const CIRCLE_CLUSTER_FAILURES = 32

// Terrain after placeCirclePortals: seeded connected clusters of mountains,
// lakes and bushes with soft targets from hexCounts (8/6/10 % of playable
// cells). Terrain never lands outside the radius, on objects, on reservations
// (town and neutral 3x3s, portal approaches). Every adjacency and BFS treats
// layer > R as solid. A blocking cluster is kept only if the free region stays
// one component touching every object, every human town still reaches every
// neutral town, mine, portal and approach cell (terrain and other human towns
// solid, objectives as endpoints) and the nearest mine/neutral-town/portal
// spreads stay within CIRCLE_ACCESS_DISPARITY.
function placeCircleTerrain(plan, layout) {
    const {side, humans, radius, center, counts} = plan
    const random = createCircleRandom((plan.seed ^ 0x27d4eb2f) >>> 0)
    const pick = n => Math.floor(random() * n)
    const area = side * side
    const cell = id => ({x: id % side, y: Math.floor(id / side)}), idOf = c => c.y * side + c.x
    const layers = new Int32Array(area)
    for (let id = 0; id < area; id++) layers[id] = circleGeometry.coopHexLayer(id % side, Math.floor(id / side), center)
    const adjacentStart = new Int32Array(area + 1), adjacentList = []
    for (let id = 0; id < area; id++) {
        adjacentStart[id] = adjacentList.length
        if (layers[id] <= radius) for (const n of circleNeighbours(cell(id), side)) if (layers[idOf(n)] <= radius) adjacentList.push(idOf(n))
    }
    adjacentStart[area] = adjacentList.length
    const adjacent = Int32Array.from(adjacentList)
    const around = id => Array.from(adjacent.subarray(adjacentStart[id], adjacentStart[id + 1]))
    const townIds = layout.players.slice(1).map(p => idOf(p.towns[0]))
    const neutralIds = layout.players[0].towns.map(idOf), mineIds = layout.goldmines.map(idOf)
    const portalIds = layout.portals.map(idOf), approachIds = layout.portalApproaches.flatMap(a => a.cells.map(idOf))
    const objects = [...townIds, ...neutralIds, ...mineIds, ...portalIds]
    const targets = [...neutralIds, ...mineIds, ...portalIds, ...approachIds]
    const kind = new Uint8Array(area), forbidden = new Uint8Array(area)
    for (let id = 0; id < area; id++) if (layers[id] > radius) forbidden[id] = 1
    for (const id of [...objects, ...approachIds, ...layout.reserved.map(idOf)]) forbidden[id] = 1
    for (const t of layout.players.flatMap(p => p.towns)) for (const o of CIRCLE_OFFSETS3) {
        const x = t.x + o.x, y = t.y + o.y
        if (x >= 0 && y >= 0 && x < side && y < side) forbidden[y * side + x] = 1
    }
    const blocked = new Uint8Array(area), endpoints = new Uint8Array(area), queue = new Int32Array(area)
    const distances = townIds.map(() => new Int32Array(area))
    for (const id of [...neutralIds, ...mineIds, ...portalIds]) endpoints[id] = 1
    const fill = (origin, distance) => {
        distance.fill(-1); distance[origin] = 0; queue[0] = origin
        let tail = 1
        for (let head = 0; head < tail; head++) {
            const c = queue[head]
            if (head > 0 && endpoints[c]) continue
            for (let k = adjacentStart[c]; k < adjacentStart[c + 1]; k++) {
                const n = adjacent[k]
                if (blocked[n] || distance[n] >= 0) continue
                distance[n] = distance[c] + 1; queue[tail++] = n
            }
        }
    }
    const connected = solid => {
        const seen = new Uint8Array(area)
        let total = 0, tail = 0
        for (let id = 0; id < area; id++) {
            if (layers[id] > radius || solid[id]) continue
            total++
            if (!tail) { queue[tail++] = id; seen[id] = 1 }
        }
        for (let head = 0; head < tail; head++) for (let k = adjacentStart[queue[head]]; k < adjacentStart[queue[head] + 1]; k++) {
            const n = adjacent[k]
            if (!seen[n] && !solid[n]) { seen[n] = 1; queue[tail++] = n }
        }
        const touches = id => { for (let k = adjacentStart[id]; k < adjacentStart[id + 1]; k++) if (seen[adjacent[k]]) return true; return false }
        return tail === total && objects.every(touches)
    }
    const nearestSpread = group => {
        if (!group.length) return 0
        let lo = Infinity, hi = -Infinity
        for (const d of distances) {
            let best = Infinity
            for (const id of group) if (d[id] >= 0 && d[id] < best) best = d[id]
            if (best === Infinity) return Infinity
            lo = Math.min(lo, best); hi = Math.max(hi, best)
        }
        return hi - lo
    }
    const spreads = {}
    const accepts = () => {
        const solid = new Uint8Array(area)
        for (let id = 0; id < area; id++) solid[id] = blocked[id] = kind[id] === 1 || kind[id] === 2 ? 1 : 0
        for (const id of objects) solid[id] = 1
        if (!connected(solid)) return false
        for (const id of townIds) blocked[id] = 1
        if (!townIds.every((t, i) => { fill(t, distances[i]); return targets.every(id => distances[i][id] >= 0) })) return false
        Object.assign(spreads, {mines: nearestSpread(mineIds), neutralTowns: nearestSpread(neutralIds), portals: nearestSpread(portalIds)})
        return Object.values(spreads).every(s => s <= CIRCLE_ACCESS_DISPARITY)
    }
    if (!accepts()) throw new Error(`Circle layout breaks access before terrain: size=${plan.size} humans=${humans} seed=${plan.seed}`)
    const open = id => !forbidden[id] && !kind[id]
    const tally = k => kind.reduce((sum, v) => sum + (v === k), 0)
    const frontierOf = k => {
        const list = new Set()
        for (let id = 0; id < area; id++) if (kind[id] === k) for (const n of around(id)) if (open(n)) list.add(n)
        return [...list]
    }
    const report = {}
    const grow = (name, attachShare) => {
        const k = CIRCLE_TERRAIN_KINDS[name], target = counts[name], blocking = name !== 'bushes'
        let placed = tally(k), failures = 0, accepted = 0, rejected = 0
        while (placed < target && failures < CIRCLE_CLUSTER_FAILURES) {
            const remaining = target - placed, frontier = frontierOf(k)
            // Small remainders extend a cluster so every cell keeps a same-kind neighbour.
            const attach = frontier.length > 0 && (remaining < 3 || random() < attachShare)
            // A new cluster keeps clear of same-kind cells outside itself, so it stays a separate group;
            // an attached one may touch only the group it extends, so it never bridges two groups.
            const clear = (id, cluster) => around(id).every(n => kind[n] !== k || cluster.includes(n))
            const groupOf = id => {
                const group = [id]
                for (let i = 0; i < group.length; i++) for (const n of around(group[i])) if (kind[n] === k && !group.includes(n)) group.push(n)
                return group
            }
            let seed, home = []
            if (attach) {
                const single = frontier.filter(id => clear(id, groupOf(around(id).find(n => kind[n] === k))))
                const seeds = single.length ? single : frontier
                seed = seeds[pick(seeds.length)]
                home = groupOf(around(seed).find(n => kind[n] === k))
            } else {
                const free = []
                for (let id = 0; id < area; id++) if (open(id) && clear(id, [])) free.push(id)
                if (!free.length) break
                seed = free[pick(free.length)]
            }
            const size = attach && remaining < 3 ? remaining : Math.min(remaining, 2 + pick(3))
            const cluster = [seed]
            kind[seed] = k
            while (cluster.length < size) {
                const next = [...new Set(cluster.flatMap(around))].filter(id => open(id) && clear(id, [...cluster, ...home]))
                if (!next.length) break
                const id = next[pick(next.length)]
                kind[id] = k; cluster.push(id)
            }
            if ((!attach && cluster.length < 2) || (blocking && !accepts())) {
                for (const id of cluster) kind[id] = 0
                failures++; rejected++
                continue
            }
            placed += cluster.length; accepted++; failures = 0
        }
        report[name] = {target, achieved: placed, deviation: placed - target, acceptedClusters: accepted, rejectedClusters: rejected}
    }
    grow('mountains', 0.1)
    grow('lakes', 0.1)
    grow('bushes', 0.1)
    accepts()
    const cellsOf = k => {
        const list = []
        for (let id = 0; id < area; id++) if (kind[id] === k) list.push(cell(id))
        return list
    }
    const playable = counts.playable
    for (const name of Object.keys(report)) Object.assign(report[name], {density: report[name].achieved / playable,
        targetDensity: report[name].target / playable, densityDeviation: (report[name].achieved - report[name].target) / playable})
    return {
        ...layout,
        stages: [...layout.stages, 'mountains', 'lakes', 'bushes'],
        ring: {...layout.ring, indices: layout.ring.indices.slice()},
        players: layout.players.map(p => ({...p, towns: p.towns.map(t => ({...t}))})),
        reserved: layout.reserved.map(c => ({...c})),
        goldmines: layout.goldmines.map(m => ({...m})),
        assignments: layout.assignments.map(a => ({...a, mine: {...a.mine}})),
        expansions: JSON.parse(JSON.stringify(layout.expansions)),
        portals: layout.portals.map(p => ({...p})),
        portalCategories: {...layout.portalCategories},
        portalApproaches: layout.portalApproaches.map(a => ({portal: {...a.portal}, cells: a.cells.map(c => ({...c}))})),
        mountains: cellsOf(CIRCLE_TERRAIN_KINDS.mountains), lakes: cellsOf(CIRCLE_TERRAIN_KINDS.lakes),
        bushes: cellsOf(CIRCLE_TERRAIN_KINDS.bushes), hills: [],
        terrain: {softTargets: true, playable, spreads: {...spreads}, ...report}
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {planCoopCircle, placeCircleStarts, placeCircleExpansions, placeCirclePortals, placeCircleTerrain, circleRingOrder, circlePassableConnected, circleRadiusPlan, circleCapacityAt, circleRegions, clearCirclePlanCache,
        createCircleRandom, circleNeighbours, COOP_CIRCLE_ELITE_CATEGORIES, CIRCLE_TOWN_DISTANCE, CIRCLE_LEGEND,
        CIRCLE_MAX_GROWTH, CIRCLE_ACCESS_DISPARITY, COOP_CIRCLE_RING_CATEGORIES, COOP_CIRCLE_RING_GROUPS, CIRCLE_TERRAIN_KINDS}
}
