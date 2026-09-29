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

// Portal categories that live in the elite core; TASK-280 appends 'mage'.
const COOP_CIRCLE_ELITE_CATEGORIES = ['chaos', 'heavy', 'siege']
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

// Layer bands. Layer is 1-Lipschitz, so ringOuter <= townRing - D keeps every
// ring cell at hex distance >= D from the whole town ring.
function circleRegions(radius, size) {
    const elite = Math.floor(radius / 4), townRing = radius - 3
    return {elite, ringInner: elite + 1,
        ringOuter: Math.min(Math.floor(3 * radius / 4), townRing - CIRCLE_TOWN_DISTANCE[size]), townRing}
}

// Capacity numbers and their requirements at one candidate radius.
function circleCapacityAt(humans, size, radius) {
    const counts = circleScaling(humans, size).counts, terrain = circleHexCounts(radius)
    const regions = circleRegions(radius, size), center = circleGeometry.coopHexCenter(radius)
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

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {planCoopCircle, circleRadiusPlan, circleCapacityAt, circleRegions, clearCirclePlanCache,
        createCircleRandom, circleNeighbours, COOP_CIRCLE_ELITE_CATEGORIES, CIRCLE_TOWN_DISTANCE, CIRCLE_LEGEND,
        CIRCLE_MAX_GROWTH}
}
