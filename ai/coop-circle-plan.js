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

// Portal categories that live in the elite core, four per human.
const COOP_CIRCLE_ELITE_CATEGORIES = ['chaos', 'heavy', 'siege', 'mage']
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

// Smallest layer whose disc holds 4 lattice cells per human (the elite portals)
// and 12 cells per human (each portal keeps two approach cells).
function circleEliteMinimum(radius, humans) {
    const id = `${radius}:${humans}`
    if (circleEliteCache.has(id)) return circleEliteCache.get(id)
    const center = circleGeometry.coopHexCenter(radius), side = 2 * radius + 1
    const cells = new Array(radius + 1).fill(0), lattice = new Array(radius + 1).fill(0)
    for (let x = 0; x < side; x++) for (let y = 0; y < side; y++) {
        const layer = circleGeometry.coopHexLayer(x, y, center)
        if (layer > radius) continue
        cells[layer]++
        if (circleGeometry.coopHexLattice(x, y)) lattice[layer]++
    }
    let minimum = radius
    for (let layer = 0, total = 0, onLattice = 0; layer <= radius; layer++) {
        total += cells[layer]; onLattice += lattice[layer]
        if (onLattice >= 4 * humans && total >= 4 * humans + 8 * humans) { minimum = layer; break }
    }
    circleEliteCache.set(id, minimum)
    return minimum
}

// Layer bands. The elite core is R/6, grown only when the elite portals would
// not fit. Layer is 1-Lipschitz, so ringOuter <= townRing - D keeps every ring
// cell at hex distance >= D from the whole town ring.
function circleRegions(radius, size, humans) {
    const elite = Math.max(Math.floor(radius / 6), circleEliteMinimum(radius, humans)), townRing = radius - 3
    return {elite, ringInner: elite + 1,
        ringOuter: Math.min(Math.floor(3 * radius / 6), townRing - CIRCLE_TOWN_DISTANCE[size]), townRing}
}

// Capacity numbers and their requirements at one candidate radius.
function circleCapacityAt(humans, size, radius) {
    const counts = circleScaling(humans, size).counts, terrain = circleHexCounts(radius)
    const regions = circleRegions(radius, size, humans), center = circleGeometry.coopHexCenter(radius)
    const side = 2 * radius + 1
    let eliteCells = 0, eliteLattice = 0, ringLattice = 0, townRingLattice = 0, playable = 0
    for (let x = 0; x < side; x++) for (let y = 0; y < side; y++) {
        const layer = circleGeometry.coopHexLayer(x, y, center)
        if (layer > radius) continue
        playable++
        const lattice = circleGeometry.coopHexLattice(x, y)
        if (layer <= regions.elite) { eliteCells++; if (lattice) eliteLattice++ }
        else if (layer <= regions.ringOuter) { if (lattice) ringLattice++ }
        if (layer === regions.townRing && lattice) townRingLattice++
    }
    const elitePortals = 4 * humans
    const outsideReserved = 9 * (humans + counts.neutralTowns) + counts.goldmines + 3 * 11 * humans
    const reserved = eliteCells + outsideReserved
    // Nothing is placed yet, so every elite cell is free; each elite portal keeps two approach cells.
    const rows = {
        eliteLattice: {have: eliteLattice, need: elitePortals},
        eliteApproach: {have: eliteCells - elitePortals, need: 2 * elitePortals},
        ringLattice: {have: ringLattice, need: 7 * humans},
        townRingLattice: {have: townRingLattice, need: humans},
        townRingGap: {have: regions.townRing, need: regions.elite + 2},
        eliteDepth: {have: regions.elite, need: 1},
        outsideElite: {have: playable - eliteCells, need: outsideReserved},
        terrain: {have: playable - reserved, need: terrain.mountains + terrain.lakes + terrain.bushes}
    }
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
// Minimum hex distance between human towns, and seeded shuffles tried before giving up.
const CIRCLE_START_SPACING = 5
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

// Starting towns on the town ring (layer R-3) and one owned mine per human.
// Towns are random ring cells: each attempt walks a seeded shuffle of the ring
// and greedily keeps cells at hex distance >= CIRCLE_START_SPACING and
// Chebyshev >= 3 from every kept town; up to CIRCLE_START_ATTEMPTS shuffles are
// tried. Slots follow ring order. Each town's 3x3
// neighbourhood is reserved, then every human gets the nearest free cell with
// layer > E (BFS with layer > R and other towns solid, mines as endpoints) that
// keeps the passable region connected.
function placeCircleStarts(plan, colorOf = typeof coopPlayerColor === 'function' ? coopPlayerColor : null) {
    if (typeof colorOf !== 'function') throw new TypeError('Circle starts require coopPlayerColor')
    const {side, humans, radius} = plan, elite = plan.regions.elite
    const assets = circleStartScaling(humans, plan.size).startingAssets
    const shuffle = circleShuffler(plan.seed ^ 0x9e3779b9)
    const layers = circleLayerTable(plan), layerOf = id => layers[id]
    const ring = circleRingOrder(plan, plan.regions.townRing), N = ring.length
    let indices = null
    for (let attempt = 0; attempt < CIRCLE_START_ATTEMPTS && !indices; attempt++) {
        const picked = []
        for (const k of shuffle([...Array(N).keys()])) {
            const t = ring[k]
            if (picked.every(j => circleHexDistance(t, ring[j]) >= CIRCLE_START_SPACING && circleChebyshev(t, ring[j]) >= 3)) picked.push(k)
            if (picked.length === humans) { indices = picked.sort((a, b) => a - b); break }
        }
    }
    if (!indices) throw new Error(`Circle has no town ring sites: size=${plan.size} humans=${humans}`)
    const towns = indices.map(k => ring[k]), start = indices[0]
    const idOf = c => c.y * side + c.x, cell = id => ({x: id % side, y: Math.floor(id / side)})
    const reserved = new Set()
    for (const t of towns) for (const o of CIRCLE_OFFSETS3) reserved.add(idOf({x: t.x + o.x, y: t.y + o.y}))
    const townIds = towns.map(idOf), mineIds = new Set(), assigned = new Array(humans)
    const distances = i => {
        const distance = new Int32Array(side * side).fill(-1), queue = [towns[i]]
        distance[townIds[i]] = 0
        for (let k = 0; k < queue.length; k++) {
            const c = queue[k], cid = idOf(c)
            if (k > 0 && mineIds.has(cid)) continue
            for (const n of circleNeighbours(c, side)) {
                const id = idOf(n)
                if (distance[id] >= 0 || layerOf(id) > radius || townIds.includes(id)) continue
                distance[id] = distance[cid] + 1; queue.push(n)
            }
        }
        return distance
    }
    for (let i = 0; i < humans; i++) {
        const d = distances(i), tiers = new Map()
        for (let id = 0; id < side * side; id++) {
            if (d[id] <= 0 || reserved.has(id) || mineIds.has(id) || layerOf(id) <= elite) continue
            if (!tiers.has(d[id])) tiers.set(d[id], [])
            tiers.get(d[id]).push(id)
        }
        search: for (const tier of [...tiers.keys()].sort((a, b) => a - b)) {
            for (const id of shuffle(tiers.get(tier))) {
                mineIds.add(id)
                if (circlePassableConnected(plan, new Set([...townIds, ...mineIds]), [...townIds, ...mineIds])) {
                    assigned[i] = {id, distance: tier}; break search
                }
                mineIds.delete(id)
            }
        }
        if (!assigned[i]) throw new Error(`Circle has no nearby mine: size=${plan.size} humans=${humans} slot=${i + 1}`)
    }
    return {
        version: 1, size: plan.size, humans, seed: plan.seed, side, mapSize: plan.mapSize, radius,
        stages: ['towns', 'reserve-neighbourhoods', 'nearby-mines'],
        ring: {layer: plan.regions.townRing, cells: N, start, indices},
        players: [{slot: 0, rgb: {...CIRCLE_NEUTRAL_RGB}, towns: [], units: [], gold: 0},
            ...towns.map((t, i) => ({slot: i + 1, rgb: colorOf(i + 1), gold: assets.gold, units: [], towns: [{x: t.x, y: t.y}]}))],
        reserved: [...reserved].sort((a, b) => a - b).map(cell),
        goldmines: assigned.map((a, i) => ({...cell(a.id), owner: i + 1, income: 20})),
        assignments: assigned.map((a, i) => ({slot: i + 1, mine: cell(a.id), distance: a.distance}))
    }
}

const CIRCLE_ACCESS_DISPARITY = 4
const CIRCLE_NEUTRAL_TARGET = 2

// Neutral towns and the remaining mines after placeCircleStarts, all strictly
// outside the elite core (layer > E). Neutral towns sit on free cells whose
// whole 3x3 is inside the radius, outside the elite core (so the capacity
// predicate's free elite lattice holds) and clear of every reservation and mine; they
// are chosen greedily so the spread of each human's nearest neutral-town path
// stays within CIRCLE_ACCESS_DISPARITY. Every further mine is strictly farther
// from each human than that human's own starting mine. Paths treat layer > R
// and other humans' towns as solid; neutral towns and mines are endpoints.
// Passable connectivity is re-checked after every placement.
function placeCircleExpansions(plan, starts) {
    const {side, humans, radius, center, counts} = plan, elite = plan.regions.elite
    const shuffle = circleShuffler(plan.seed ^ 0x85ebca6b)
    const cell = id => ({x: id % side, y: Math.floor(id / side)}), idOf = c => c.y * side + c.x
    const layers = new Int32Array(side * side)
    for (let id = 0; id < side * side; id++) layers[id] = circleGeometry.coopHexLayer(id % side, Math.floor(id / side), center)
    const layerOf = id => layers[id]
    const towns = starts.players.slice(1).map(p => p.towns[0]), townIds = towns.map(idOf)
    const neutral = [], mineIds = new Set(starts.goldmines.map(idOf)), extraMines = []
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
    const sites = []
    for (let id = 0; id < side * side; id++) {
        if (layerOf(id) <= elite || layerOf(id) > radius) continue
        const cells = box(id)
        if (cells.every(c => c.x >= 0 && c.y >= 0 && c.x < side && c.y < side && layerOf(idOf(c)) <= radius
            && layerOf(idOf(c)) > elite && !reserved.has(idOf(c)) && !mineIds.has(idOf(c)))) sites.push(id)
    }
    // One greedy pass; false when sites run out or the final spread is too wide.
    const placeNeutral = () => {
        neutral.length = 0
        const taken = new Set()
        for (let k = 0; k < counts.neutralTowns; k++) {
            const d = fields(), current = neutral.length ? nearestNeutral(d) : towns.map(() => Infinity), tiers = new Map()
            for (const id of sites) {
                if (box(id).some(c => taken.has(idOf(c)))) continue
                const next = d.map((di, i) => di[id] < 0 ? Infinity : Math.min(current[i], di[id]))
                if (!next.every(Number.isFinite)) continue
                const tier = Math.max(CIRCLE_NEUTRAL_TARGET, spread(next))
                if (!tiers.has(tier)) tiers.set(tier, [])
                tiers.get(tier).push(id)
            }
            let placed = false
            search: for (const tier of [...tiers.keys()].sort((a, b) => a - b)) {
                for (const id of shuffle(tiers.get(tier))) {
                    neutral.push(id)
                    if (connected()) { box(id).forEach(c => taken.add(idOf(c))); placed = true; break search }
                    neutral.pop()
                }
            }
            if (!placed) return false
        }
        return !neutral.length || spread(nearestNeutral(fields())) <= CIRCLE_ACCESS_DISPARITY
    }
    if (![...Array(6)].some(placeNeutral))
        throw new Error(`Circle has no fair neutral town layout: size=${plan.size} humans=${humans} seed=${plan.seed}`)
    for (const id of neutral) for (const c of box(id)) reserved.add(idOf(c))
    const ownMine = new Map(starts.goldmines.map(m => [m.owner, idOf(m)]))
    for (let k = humans; k < counts.goldmines; k++) {
        const d = fields(), own = towns.map((_, i) => d[i][ownMine.get(i + 1)]), candidates = []
        for (let id = 0; id < side * side; id++) {
            if (layerOf(id) <= elite || layerOf(id) > radius || reserved.has(id) || mineIds.has(id) || townMask[id]) continue
            if (d.every((di, i) => di[id] > own[i])) candidates.push(id)
        }
        let placed = false
        for (const id of shuffle(candidates)) {
            mineIds.add(id)
            if (connected() && (!neutral.length || spread(nearestNeutral(fields())) <= CIRCLE_ACCESS_DISPARITY)) {
                extraMines.push(id); placed = true; break
            }
            mineIds.delete(id)
        }
        if (!placed) throw new Error(`Circle has no further mine site: size=${plan.size} humans=${humans} mine=${k + 1}`)
    }
    const nearest = neutral.length ? nearestNeutral(fields()) : []
    return {
        version: 1, size: plan.size, humans, seed: plan.seed, side, mapSize: plan.mapSize, radius,
        stages: [...starts.stages, 'neutral-towns', 'reserve-neutral-neighbourhoods', 'further-mines'],
        ring: {...starts.ring, indices: starts.ring.indices.slice()},
        players: [{...starts.players[0], towns: neutral.map(cell)},
            ...starts.players.slice(1).map(p => ({...p, towns: p.towns.map(t => ({...t}))}))],
        reserved: [...reserved].sort((a, b) => a - b).map(cell),
        goldmines: [...starts.goldmines.map(m => ({...m})), ...extraMines.map(id => ({...cell(id), owner: 0, income: 20}))],
        assignments: starts.assignments.map(a => ({...a, mine: {...a.mine}})),
        expansions: {neutralTowns: neutral.map(cell), furtherMines: extraMines.map(cell),
            nearestNeutralDistance: nearest, neutralSpread: nearest.length ? spread(nearest) : 0}
    }
}

// Common ring categories in the per-human deal order; COOP_CIRCLE_ELITE_CATEGORIES
// fill the elite core.
const COOP_CIRCLE_RING_CATEGORIES = Object.freeze(['melee', 'ranged', 'support'])

// Portals after placeCircleExpansions. Elite categories sit on elite lattice
// cells (layer <= E); common categories sit in the ring E < layer <= ringOuter,
// which keeps them at hex distance >= D from every human town. Lattice cells
// are preferred; any other band cell is used only if it touches no portal.
// Every portal keeps two distinct free approach cells (bipartite matching) that
// are not portals, towns, mines or reservations, and the passable region stays
// connected after every placement. The first ring portal per human is the
// nearest reachable ring cell to that human's town, keeping the nearest-portal
// path spread level for the terrain stage.
function placeCirclePortals(plan, layout) {
    const {side, humans, radius} = plan, {elite, ringOuter} = plan.regions
    const targets = circleScaling(humans, plan.size).counts.portalCategories
    const shuffle = circleShuffler(plan.seed ^ 0xc2b2ae35)
    const cell = id => ({x: id % side, y: Math.floor(id / side)}), idOf = c => c.y * side + c.x
    const layers = circleLayerTable(plan), layerOf = id => layers[id]
    const townIds = layout.players.flatMap(p => p.towns.map(idOf)), mineIds = layout.goldmines.map(idOf)
    const occupied = new Set([...townIds, ...mineIds]), reserved = new Set(layout.reserved.map(idOf))
    const around = id => circleNeighbours(cell(id), side).map(idOf).filter(n => layerOf(n) <= radius)
    const portals = [], categories = [], portalSet = new Set()
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
    // Each human's share of a region's categories, repeated once per human.
    const deal = list => Array.from({length: humans}, () => list.flatMap(c => Array(targets[c] / humans).fill(c))).flat()
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
    const tryPlace = (id, category) => {
        if (portalSet.has(id) || around(id).some(n => portalSet.has(n))) return false
        portals.push(id); portalSet.add(id)
        if (connected() && approaches()) { categories.push(category); return true }
        portals.pop(); portalSet.delete(id)
        return false
    }
    for (const group of groups) {
        const lattice = [], rest = []
        for (let id = 0; id < side * side; id++) {
            if (!group.inside(layerOf(id)) || occupied.has(id) || reserved.has(id)) continue
            ;(circleGeometry.coopHexLattice(id % side, Math.floor(id / side)) ? lattice : rest).push(id)
        }
        const candidates = [...shuffle(lattice), ...shuffle(rest)]
        let sequence = group.sequence
        // Ring anchors: each human first gets a ring portal at the smallest path
        // distance from their town, so nearest-portal distances start level.
        if (group.region === 'ring') {
            layout.players.slice(1).forEach((p, i) => {
                const d = pathFrom(idOf(p.towns[0])), tiers = new Map()
                for (const id of candidates) if (d[id] > 0) {
                    if (!tiers.has(d[id])) tiers.set(d[id], [])
                    tiers.get(d[id]).push(id)
                }
                const anchored = [...tiers.keys()].sort((a, b) => a - b).some(tier => tiers.get(tier).some(id => tryPlace(id, sequence[i])))
                if (!anchored) throw new Error(`Circle has no ring anchor portal: size=${plan.size} humans=${humans} seed=${plan.seed} slot=${i + 1}`)
            })
            sequence = sequence.slice(humans)
        }
        for (const category of sequence) {
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
        CIRCLE_MAX_GROWTH, CIRCLE_ACCESS_DISPARITY, COOP_CIRCLE_RING_CATEGORIES, CIRCLE_TERRAIN_KINDS}
}
