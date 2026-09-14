// [l, r]
function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;

}

function areCoordsEqual(coord1, coord2) {
    return coord1.x == coord2.x && coord1.y == coord2.y
}

function hasSuchCoord(coords, coord) {
    for (let i = 0; i < coords.length; ++i) {
        if (areCoordsEqual(coords[i], coord)) {
            return true
        }
    }
    return false
}

function createSeededRandom(seed) {
    let state = seed >>> 0
    if (!state) {
        state = 0x9e3779b9
    }
    return function() {
        state = (1664525 * state + 1013904223) >>> 0
        return state / 0x100000000
    }
}

// Absolute differences across humans. Distances count hex edges to the nearest
// target of each category, including the final interaction edge. Every target
// must also be reachable; hostile buildings cannot be used as transit cells.
const COOP_START_BALANCE = Object.freeze({assetDisparity: 0, pathDisparity: 4})

function coopStartBalanceMetrics(map) {
    const key = c => `${c.x},${c.y}`
    const groups = [map.goldmines, map.players[0].towns, map.portals]
    const terminal = new Set([...groups[1], ...groups[2]].map(key))
    return map.players.slice(1, 1 + map.coop.initialHumanCount).map((p, index) => {
        const blocked = new Set([...map.lakes, ...map.mountains,
            ...map.players.slice(1).flatMap((other, i) => i === index ? [] : other.towns)].map(key))
        const start = p.towns[0], distances = new Map(), queue = []
        if (start && !blocked.has(key(start))) { distances.set(key(start), 0); queue.push(start) }
        for (let head = 0; head < queue.length; head++) {
            const c = queue[head]
            if (terminal.has(key(c))) continue
            for (const [dx, dy] of neighborhood[c.x & 1]) {
                const n = {x:c.x+dx, y:c.y+dy}, id = key(n)
                if (n.x < 0 || n.y < 0 || n.x >= map.mapSize.x || n.y >= map.mapSize.y ||
                    blocked.has(id) || distances.has(id)) continue
                distances.set(id, distances.get(key(c)) + 1); queue.push(n)
            }
        }
        return {gold:p.gold, towns:p.towns.length, units:p.units.length + p.towns.length,
            paths:groups.map(group => group.length && group.every(c => distances.has(key(c)))
                ? Math.min(...group.map(c => distances.get(key(c)))) : Infinity)}
    })
}

function coopStartsBalanced(map) {
    const metrics = coopStartBalanceMetrics(map)
    const within = (values, limit) => values.every(Number.isFinite) &&
        Math.max(...values) - Math.min(...values) <= limit
    return ['gold', 'towns', 'units'].every(k => within(metrics.map(m => m[k]), COOP_START_BALANCE.assetDisparity)) &&
        [0, 1, 2].every(k => within(metrics.map(m => m.paths[k]), COOP_START_BALANCE.pathDisparity))
}

const COOP_MAP_SIZES = Object.freeze(Object.fromEntries(
    ['tiny', 'normal', 'big'].map(size => [size, getCoopMapScaling(4, size).side])))

// Transactional, dimension-aware rebuild. Fixed towns and starting assets never
// move during repair; each attempt uses finite placement pools and terrain growth.
function enforceCoopStartBalance(map, force = false) {
    const fail = detail => { throw new Error('Co-op starting balance bound cannot be satisfied: ' + detail) }
    const size = map.coop.generation && map.coop.generation.size
    const humans = map.players.slice(1, 1 + map.coop.initialHumanCount)
    const scaling = getCoopMapScaling(humans.length, size)
    if (map.mapSize.x !== scaling.side || map.mapSize.y !== scaling.side ||
        map.goldmines.length !== scaling.counts.goldmines ||
        map.players[0].towns.length !== scaling.counts.neutralTowns) fail('invalid dimensions or resource count')
    if (humans.some(p => p.gold !== 100 || p.towns.length !== 1 || p.units.length !== 0))
        fail('unequal starting assets')
    const towns = map.players.flatMap(p => p.towns)
    if (towns.some(t => !Number.isInteger(t.x) || !Number.isInteger(t.y) ||
        t.x < 2 || t.y < 2 || t.x >= scaling.side-2 || t.y >= scaling.side-2) ||
        towns.some((t,i) => towns.slice(i+1).some(u => Math.abs(t.x-u.x)<3 && Math.abs(t.y-u.y)<3)))
        fail('invalid fixed towns')
    if (!force && coopStartsBalanced(map)) return {status:'balanced', iterations:0, iterationLimit:8}
    if (map.coop.generation.version === 4) return repairCoopValley(map, fail)
    let diagnostic = 'path disparity'
    for (let iteration=1; iteration<=8; iteration++) {
        const candidate = JSON.parse(JSON.stringify(map))
        candidate.lakes=[]; candidate.mountains=[]; candidate.bushes=[]; candidate.portals=[]
        try {
            placeCoopPortals(candidate, size, iteration - 1)
            if (!coopStartsBalanced(candidate)) continue
            growCoopTerrain(candidate, createSeededRandom((map.coop.generation.seed + iteration - 1) >>> 0))
            if (!coopStartsBalanced(candidate)) continue
            for (const kind of ['portals','lakes','mountains','bushes']) map[kind]=candidate[kind]
            return {status:'balanced', iterations:iteration, iterationLimit:8}
        } catch (error) { diagnostic=error.message }
    }
    fail('attempts=8 last=' + diagnostic)
}

// Pure generation API: callers explicitly start the returned GameMap. Counts
// cover local menu limits and exclude the neutral slot and demon controller.
function generateCoopGame(playerCount, options = {}) {
    if (!Number.isInteger(playerCount) || playerCount < 1 || playerCount > 12) {
        throw new RangeError('Co-op playerCount must be an integer from 1 to 12 humans')
    }
    if (!options || typeof options !== 'object' || Array.isArray(options) ||
        Object.keys(options).some(key => key !== 'seed' && key !== 'size')) {
        throw new TypeError('Co-op options must contain only optional seed and size')
    }
    const seed = options.seed === undefined ? 1 : options.seed
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
        throw new RangeError('Co-op seed must be an unsigned 32-bit integer')
    }
    const size = options.size === undefined ? 'normal' : options.size
    if (typeof size !== 'string' || !Object.prototype.hasOwnProperty.call(COOP_MAP_SIZES, size)) {
        throw new RangeError('Co-op size must be tiny, normal or big')
    }
    const failures = []
    for (let attempt = 0; attempt < COOP_VALLEY_ATTEMPTS; attempt++) {
        try {
            return buildCoopValleyCandidate(playerCount, size, seed, attempt)
        } catch (error) {
            failures.push(error)
        }
    }
    const last = failures[failures.length - 1]
    throw new Error(`Co-op Divided Valley generation failed: size=${size} playerCount=${playerCount} seed=${seed} ` +
        `attempts=${failures.length}/${COOP_VALLEY_ATTEMPTS} constraint=${last.constraint} ` +
        `failures=${failures.map(f => f.attempt + ':' + f.constraint).join(',')} detail=${last.message}`)
}

// Divided Valley candidates (ai/coop-valley-plan.js). Attempt 0 uses the seed
// itself; later attempts use distinct derived seeds, so the at most eight full
// candidates are deterministic. Every stage keeps finite pools and throws on
// exhaustion; no partial map, row layout or relaxed bound is ever returned.
const COOP_VALLEY_ATTEMPTS = 8

function coopValleyAttemptSeed(seed, attempt) {
    return attempt ? (seed ^ Math.imul(attempt, 0x9e3779b9)) >>> 0 : seed
}

// A complete version-4 map detached from the active runtime, or an error
// tagged with the attempt and failed constraint (stage).
function buildCoopValleyCandidate(playerCount, size, seed, attempt) {
    let constraint = 'region-plan'
    try {
        const plan = planDividedValley(playerCount, size, coopValleyAttemptSeed(seed, attempt))
        constraint = 'starting-towns'
        const starts = placeValleyStarts(plan, coopPlayerColor)
        constraint = 'neutral-expansions'
        const expansions = placeValleyExpansions(plan, starts)
        constraint = 'portal-groups'
        const portals = placeValleyPortals(plan, expansions)
        constraint = 'terrain-formations'
        const layout = placeValleyTerrain(plan, portals)
        const copy = c => ({x: c.x, y: c.y})
        const roster = [{rgb: {...layout.players[0].rgb}, towns: layout.players[0].towns.map(copy), units: [], gold: 0},
            ...layout.players.slice(1).map(p => ({rgb: {...p.rgb}, gold: p.gold, units: [], towns: p.towns.map(copy)}))]
        const map = new GameMap({x: plan.side, y: plan.side}, roster,
            layout.goldmines.map(m => ({...copy(m), owner: m.owner, income: m.income})),
            layout.lakes.map(copy), layout.mountains.map(copy), layout.bushes.map(copy), [], {type: 'rectangular'}, {})
        map.coop.generation = {version: 4, playerCount, seed, size, options: {seed, size}}
        map.portals = layout.portals.map(copy)
        constraint = 'starting-balance'
        if (!coopStartsBalanced(map)) throw new Error('starting assets or nearest objective paths exceed the balance bound')
        constraint = 'route-connectivity'
        if (!coopRoutesConnected(map)) throw new Error('an objective is unreachable')
        return map
    } catch (error) {
        const tagged = new Error(error && error.message || String(error))
        tagged.constraint = constraint
        tagged.attempt = attempt
        throw tagged
    }
}

// Version-4 repair never moves towns, resources or assets. It replays the same
// deterministic candidates and restores portals and terrain (with them the
// ridge, passages and laterals) only from a balanced, connected candidate whose
// fixed objects match exactly; otherwise the map is left untouched.
function repairCoopValley(map, fail) {
    const {playerCount, seed, size} = map.coop.generation
    const fixed = m => JSON.stringify([m.mapSize, m.players.slice(0, 1 + m.coop.initialHumanCount), m.goldmines])
    const failures = []
    for (let attempt = 0; attempt < COOP_VALLEY_ATTEMPTS; attempt++) {
        let candidate
        try {
            candidate = buildCoopValleyCandidate(playerCount, size, seed, attempt)
        } catch (error) {
            failures.push(attempt + ':' + error.constraint)
            continue
        }
        if (fixed(candidate) !== fixed(map)) {
            failures.push(attempt + ':fixed-objects')
            continue
        }
        for (const kind of ['portals', 'lakes', 'mountains', 'bushes', 'hills']) map[kind] = candidate[kind]
        return {status:'balanced', strategy:'valley-replay', iterations:attempt + 1, iterationLimit:COOP_VALLEY_ATTEMPTS}
    }
    fail(`version=4 attempts=${COOP_VALLEY_ATTEMPTS} failures=${failures.join(',')}`)
}

// Offset-column hex coordinates converted to axial coordinates. Distances count
// edges on the empty hex grid, independently of terrain/path detours.
function coopPortalDistance(a, b) {
    const dq = a.x - b.x
    const dr = (a.y - Math.floor(a.x / 2)) - (b.y - Math.floor(b.x / 2))
    return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr))
}

function placeCoopPortals(map, size, balanceRows = false) {
    const rules = {tiny: [1, 6], normal: [2, 10], big: [3, 14]}[size]
    if (!rules) throw new Error('Co-op portal placement requires a known size')
    const humans = map.players.slice(1, 1 + map.coop.initialHumanCount)
    const towns = map.players.flatMap(p => p.towns)
    const key = c => `${c.x},${c.y}`
    const occupied = new Set([...towns, ...map.goldmines, ...map.lakes,
        ...map.mountains, ...map.bushes, ...map.hills,
        ...map.players.flatMap(p => p.suburbs || [])].map(key))
    const candidates = []
    for (let x=0; x<map.mapSize.x; x++) for (let y=0; y<map.mapSize.y; y++) {
        const c = {x,y}
        if (!occupied.has(key(c)) &&
            !towns.some(t => Math.abs(t.x-x)<=1 && Math.abs(t.y-y)<=1) &&
            humans.every(p => coopPortalDistance(p.towns[0], c) >= rules[1])) candidates.push(c)
    }
    const portals = []
    // Allocate a portal to each starting lane before adding the next tier.
    // A finite scan preserves exact counts or reports an explicit failure.
    for (let tier=0; tier<rules[0]; tier++) for (const human of humans) {
        // Fallback targets a common travel distance instead of the bottom edge,
        // whose detours around neutral towns can add a parity-dependent edge.
        const ideal = {x:human.towns[0].x, y:Math.min(map.mapSize.y-1, human.towns[0].y+rules[1]+balanceRows)}
        candidates.sort((a,b) => coopPortalDistance(a,ideal)-coopPortalDistance(b,ideal) || b.y-a.y || a.x-b.x)
        const index = candidates.findIndex(c => {
            const proposed = new Set([...portals, c].map(key))
            return [...portals, c].every(p => neighborhood[p.x & 1].some(([dx,dy]) => {
                const n = {x:p.x+dx,y:p.y+dy}
                return n.x>=0 && n.y>=0 && n.x<map.mapSize.x && n.y<map.mapSize.y &&
                    !occupied.has(key(n)) && !proposed.has(key(n))
            }))
        })
        if (index<0) throw new Error(`Co-op portal placement failed: size=${size} humans=${humans.length} wanted=${humans.length*rules[0]} placed=${portals.length}`)
        portals.push(candidates.splice(index,1)[0])
    }
    map.portals = portals
}

// Authored references in options/gamestart.js use short lake bands and groves
// (open field), plus adjoining mountain cells. Grow similar hex formations,
// reserving actual approach paths before placing blockers. The earlier balance
// repair chooses resources; this stage never moves a town, suburb or objective.
function growCoopTerrain(map, rng) {
    const key = c => `${c.x},${c.y}`
    const towns = map.players.flatMap(p => p.towns)
    const targets = [...map.portals, ...map.players[0].towns, ...map.goldmines]
    const terminal = new Set([...map.portals, ...map.players[0].towns].map(key))
    const reserved = new Set([...targets, ...map.hills,
        ...map.players.flatMap(p => p.suburbs || [])].map(key))
    const inside = c => c.x >= 0 && c.y >= 0 && c.x < map.mapSize.x && c.y < map.mapSize.y
    const neighbours = c => neighborhood[c.x & 1].map(([dx, dy]) => ({x:c.x+dx, y:c.y+dy})).filter(inside)
    for (const town of towns) for (let dx=-1; dx<=1; dx++) for (let dy=-1; dy<=1; dy++)
        reserved.add(key({x:town.x+dx, y:town.y+dy}))
    const fixed = new Set(reserved)
    // A shared approach tree avoids reserving H times every shortest route,
    // which can consume all terrain space on densely populated Tiny maps.
    // Town neighborhoods are already clear, so branches at the root can walk
    // around its occupied center; other towns remain interaction endpoints.
    const start = map.players[1].towns[0]
    const endpoints = new Set([...map.portals, ...towns].map(key))
    const queue = [start], parent = new Map([[key(start), null]])
    for (let i=0; i<queue.length; i++) {
        const c = queue[i]
        if (i > 0 && endpoints.has(key(c))) continue
        for (const n of neighbours(c)) if (!parent.has(key(n))) {
            parent.set(key(n), c); queue.push(n)
        }
    }
    for (const target of [...targets, ...towns]) {
        if (!parent.has(key(target))) throw new Error('Co-op terrain requires connected objectives')
        for (let c=target; c; c=parent.get(key(c))) reserved.add(key(c))
    }
    // Keep each human's nearest-category shortest route open, preserving the
    // pre-terrain four-edge bound while the shared tree serves all objectives.
    for (const human of map.players.slice(1, 1 + map.coop.initialHumanCount)) {
        const root = human.towns[0], queue = [root], parent = new Map([[key(root), null]])
        for (let i=0; i<queue.length; i++) {
            const c = queue[i]
            if (i && endpoints.has(key(c))) continue
            for (const n of neighbours(c)) if (!parent.has(key(n))) {
                parent.set(key(n), c); queue.push(n)
            }
        }
        for (const group of [map.portals, map.players[0].towns, map.goldmines]) {
            const ids = new Set(group.map(key)), target = queue.find(c => ids.has(key(c)))
            if (!target) throw new Error('Co-op terrain requires reachable nearest objectives')
            for (let c=target; c; c=parent.get(key(c))) reserved.add(key(c))
        }
    }
    const free = new Map()
    for (let x=0; x<map.mapSize.x; x++) for (let y=0; y<map.mapSize.y; y++) {
        const c = {x,y}; if (!reserved.has(key(c))) free.set(key(c), c)
    }
    // Finite pool growth: select a seeded origin and repeatedly attach a hex.
    // Small components give lakes/groves compact shapes and mountains ridges;
    // a new origin is needed only after the desired patch size or a dead end.
    for (const [kind, density] of [['mountains',0.08], ['lakes',0.06], ['bushes',0.10]]) {
        // Bushes are walkable, so groves may cross the reserved approaches.
        if (kind === 'bushes') for (const id of reserved) if (!fixed.has(id)) {
            const [x,y] = id.split(',').map(Number)
            free.set(id, {x,y})
        }
        const wanted = Math.round(map.mapSize.x * map.mapSize.y * density)
        map[kind] = []
        while (map[kind].length < wanted) {
            const candidates = [...free.values()]
            if (!candidates.length) throw new Error(`Co-op terrain has no space for ${kind}`)
            const joined = candidates.filter(c => neighbours(c).some(n => free.has(key(n))))
            const origins = joined.length ? joined : candidates
            const patch = [origins[randomIntWithRng(rng, 0, origins.length-1)]]
            const limit = Math.min(wanted-map[kind].length, randomIntWithRng(rng, 4, 9))
            for (let i=0; i<limit; i++) {
                const c = patch[patch.length-1]
                free.delete(key(c)); map[kind].push(c)
                const edge = [...new Map(patch.flatMap(neighbours).filter(n => free.has(key(n))).map(n => [key(n),n])).values()]
                if (!edge.length) break
                patch.push(edge[randomIntWithRng(rng, 0, edge.length-1)])
            }
        }
    }
}

// Check long-term melee access without treating hostile towns/portals as
// shortcuts. Humans must reach each target from an adjacent walkable cell;
// allied town centers remain obstacles, as in Way.isCellImpassable.
function coopRoutesConnected(map) {
    const key = c => `${c.x},${c.y}`
    const targets = [...map.portals, ...map.players[0].towns, ...map.goldmines]
    const terminal = new Set([...map.portals, ...map.players[0].towns].map(key))
    const terrain = [...map.lakes, ...map.mountains]
    return map.players.slice(1, 1 + map.coop.initialHumanCount).every((player, index) => {
        const start = player.towns[0]
        const blocked = new Set([...terrain, ...map.players.slice(1).flatMap((p, i) =>
            i === index ? [] : p.towns)].map(key))
        const visited = new Set([key(start)])
        const queue = [start]
        for (let head = 0; head < queue.length; head++) {
            const c = queue[head]
            if (terminal.has(key(c))) continue
            for (const [dx, dy] of neighborhood[c.x & 1]) {
                const next = {x:c.x + dx, y:c.y + dy}, id = key(next)
                if (next.x < 0 || next.y < 0 || next.x >= map.mapSize.x ||
                    next.y >= map.mapSize.y || blocked.has(id) || visited.has(id)) continue
                visited.add(id)
                queue.push(next)
            }
        }
        return targets.every(c => visited.has(key(c)))
    })
}

// Finite deterministic repair: remove at most B blockers, then try at most
// B * width * height placements. Keep every category/count, and fail explicitly
// if the supplied layout cannot accommodate them. No random retries or draws.
function repairCoopConnectivity(map) {
    if (map.coop.generation && !coopRoutesConnected(map)) {
        const result = enforceCoopStartBalance(map, true)
        return {...result, status:'connected', strategy:'rebuild', placementLimit:8 * map.mapSize.x * map.mapSize.y}
    }
    const removed = []
    for (const kind of ['lakes', 'mountains']) {
        while (!coopRoutesConnected(map) && map[kind].length) {
            removed.push({kind, coord:map[kind].pop()})
        }
    }
    if (!coopRoutesConnected(map)) throw new Error('Co-op connectivity repair failed: fixed targets block routes')
    const towns = map.players.flatMap(p => p.towns)
    for (const {kind, coord} of removed) {
        let placed = false
        for (let x = 0; x < map.mapSize.x && !placed; x++) {
            for (let y = 0; y < map.mapSize.y && !placed; y++) {
                const candidate = {x, y}
                const occupied = [...map.lakes, ...map.mountains, ...map.bushes,
                    ...map.hills, ...map.goldmines, ...map.portals]
                if (towns.some(t => Math.abs(t.x-x) <= 1 && Math.abs(t.y-y) <= 1) ||
                    occupied.some(c => areCoordsEqual(c, candidate))) continue
                map[kind].push(candidate)
                if (coopRoutesConnected(map)) placed = true
                else map[kind].pop()
            }
        }
        if (!placed) throw new Error(`Co-op connectivity repair failed: no safe ${kind} placement for ${coord.x},${coord.y}`)
    }
    return {status:'connected', relocated:removed.length,
        placementLimit:removed.length * map.mapSize.x * map.mapSize.y}
}

function randomIntWithRng(rng, min, max) {
    return Math.floor(rng() * (max - min + 1)) + min
}

function coordKey(coord) {
    return coord.x + ':' + coord.y
}

function hasCoordKey(used, coord) {
    return used[coordKey(coord)] === true
}

function markCoordKey(used, coord) {
    used[coordKey(coord)] = true
}

function townTrainingSizeConfig(size) {
    let configs = {
        tiny: {mapSize: {x: 7, y: 7}, neutralTowns: 1, extraUnitsPerPlayer: 1, blockers: 2, minTownDistance: 2, barrackDensity: 0.15, farmDensity: 0.2, externalDensity: 0.15, suburbDensity: 1, suburbDistance: 1, goldmines: 3},
        medium: {mapSize: {x: 13, y: 13}, neutralTowns: 2, extraUnitsPerPlayer: 2, blockers: 8, minTownDistance: 3, barrackDensity: 0.2, farmDensity: 0.3, externalDensity: 0.25, suburbDensity: 1, suburbDistance: 1, goldmines: 5},
        big: {mapSize: {x: 21, y: 21}, neutralTowns: 4, extraUnitsPerPlayer: 4, blockers: 18, minTownDistance: 4, barrackDensity: 0.25, farmDensity: 0.4, externalDensity: 0.35, suburbDensity: 1, suburbDistance: 1, goldmines: 8}
    }
    return configs[size] || configs.tiny
}

const GOLDMINE_TRAINING_INCOME_MIN = 20
const GOLDMINE_TRAINING_INCOME_MAX = 100
const GOLDMINE_TRAINING_STARTING_GOLD_MIN = 50
const GOLDMINE_TRAINING_STARTING_GOLD_MAX = 500
const ECONOMY_GENERATOR_STAGE_1_HP_MIN = 2
const ECONOMY_GENERATOR_STAGE_1_HP_MAX = 5
const ECONOMY_GENERATOR_STAGE_2_HP_MIN = 2
const ECONOMY_GENERATOR_STAGE_2_HP_MAX = 5
const ECONOMY_GENERATOR_STAGE_3_HP_MIN = 2
const ECONOMY_GENERATOR_STAGE_3_HP_MAX = 5
const ECONOMY_GENERATOR_STAGE_4_HP_MIN = 2
const ECONOMY_GENERATOR_STAGE_4_HP_MAX = 5
const ECONOMY_GENERATOR_STAGE_5_HP_MIN = 2
const ECONOMY_GENERATOR_STAGE_5_HP_MAX = 5
const ECONOMY_GENERATOR_STAGE_6_HP_MIN = 2
const ECONOMY_GENERATOR_STAGE_6_HP_MAX = 5
const ECONOMY_GENERATOR_STAGE_7_HP_MIN = 2
const ECONOMY_GENERATOR_STAGE_7_HP_MAX = 5
const ECONOMY_GENERATOR_STAGE_8_HP_MIN = 2
const ECONOMY_GENERATOR_STAGE_8_HP_MAX = 5

function townDistance(a, b) {
    let dx = a.x - b.x
    let dy = a.y - b.y
    return Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dx + dy))
}

function isTownCoordValid(coord, mapSize, used, towns, minTownDistance) {
    if (coord.x <= 0 || coord.y <= 0 || coord.x >= mapSize.x - 1 || coord.y >= mapSize.y - 1) {
        return false
    }
    if (hasCoordKey(used, coord)) {
        return false
    }
    for (let i = 0; i < towns.length; ++i) {
        if (townDistance(coord, towns[i]) < minTownDistance) {
            return false
        }
    }
    return true
}

function pickCoord(rng, mapSize, used, predicate) {
    for (let attempts = 0; attempts < 1000; ++attempts) {
        let coord = {
            x: randomIntWithRng(rng, 0, mapSize.x - 1),
            y: randomIntWithRng(rng, 0, mapSize.y - 1)
        }
        if (!hasCoordKey(used, coord) && (!predicate || predicate(coord))) {
            markCoordKey(used, coord)
            return coord
        }
    }
    let start = randomIntWithRng(rng, 0, mapSize.x * mapSize.y - 1)
    for (let offset = 0; offset < mapSize.x * mapSize.y; ++offset) {
        let index = (start + offset) % (mapSize.x * mapSize.y)
        let coord = {
            x: index % mapSize.x,
            y: Math.floor(index / mapSize.x)
        }
        if (!hasCoordKey(used, coord) && (!predicate || predicate(coord))) {
            markCoordKey(used, coord)
            return coord
        }
    }
    throw new Error('Unable to place generated training map object')
}

function placeTown(rng, mapSize, used, allTowns, minTownDistance) {
    let coord = pickCoord(rng, mapSize, used, function(candidate) {
        return isTownCoordValid(candidate, mapSize, used, allTowns, minTownDistance)
    })
    allTowns.push(coord)
    return coord
}

function placeUnitNearTown(rng, mapSize, used, town, unitType) {
    let candidates = [
        {x: town.x - 1, y: town.y},
        {x: town.x + 1, y: town.y},
        {x: town.x, y: town.y - 1},
        {x: town.x, y: town.y + 1},
        {x: town.x - 1, y: town.y + 1},
        {x: town.x + 1, y: town.y - 1}
    ]
    let start = randomIntWithRng(rng, 0, candidates.length - 1)
    for (let i = 0; i < candidates.length; ++i) {
        let coord = candidates[(start + i) % candidates.length]
        if (coord.x < 0 || coord.y < 0 || coord.x >= mapSize.x || coord.y >= mapSize.y) {
            continue
        }
        if (!hasCoordKey(used, coord)) {
            markCoordKey(used, coord)
            return {type: unitType, x: coord.x, y: coord.y}
        }
    }
    let coord = pickCoord(rng, mapSize, used)
    return {type: unitType, x: coord.x, y: coord.y}
}

function clampProbability(value, fallback) {
    if (!Number.isFinite(value)) {
        return fallback
    }
    return Math.max(0, Math.min(1, value))
}

function townNeighbourCoords(town) {
    return [
        {x: town.x - 1, y: town.y},
        {x: town.x + 1, y: town.y},
        {x: town.x, y: town.y - 1},
        {x: town.x, y: town.y + 1},
        {x: town.x - 1, y: town.y + 1},
        {x: town.x + 1, y: town.y - 1}
    ]
}

function isCoordInsideMap(coord, mapSize) {
    return coord.x >= 0 && coord.y >= 0 &&
        coord.x < mapSize.x && coord.y < mapSize.y
}

function generateSuburbLayout(rng, mapSize, town, density, maxDistance, claimed) {
    let cells = [{x: town.x, y: town.y}]
    let selected = {}
    selected[coordKey(town)] = true
    claimed[coordKey(town)] = true
    let frontier = [town]

    if (density == 1 && maxDistance == 1) {
        let neighbours = townNeighbourCoords(town)
        for (let i = 0; i < neighbours.length; ++i) {
            let coord = neighbours[i]
            let key = coordKey(coord)
            if (isCoordInsideMap(coord, mapSize) && !claimed[key]) {
                claimed[key] = true
                selected[key] = true
                cells.push(coord)
            }
        }
        frontier = []
    }

    while (frontier.length) {
        let source = frontier.shift()
        let candidates = townNeighbourCoords(source)
        let offset = randomIntWithRng(rng, 0, candidates.length - 1)
        for (let i = 0; i < candidates.length; ++i) {
            let coord = candidates[(offset + i) % candidates.length]
            let key = coordKey(coord)
            if (!isCoordInsideMap(coord, mapSize) || selected[key] || claimed[key] ||
                townDistance(coord, town) > maxDistance) {
                continue
            }
            selected[key] = true
            if (rng() >= density) {
                continue
            }
            claimed[key] = true
            cells.push(coord)
            frontier.push(coord)
        }
    }

    if (cells.length == 1) {
        let neighbours = townNeighbourCoords(town).filter(function(coord) {
            return isCoordInsideMap(coord, mapSize) && !claimed[coordKey(coord)]
        })
        if (neighbours.length) {
            let coord = neighbours[randomIntWithRng(rng, 0, neighbours.length - 1)]
            claimed[coordKey(coord)] = true
            cells.push(coord)
        }
    }

    let expansionCells = []
    let expansionSeen = {}
    for (let i = 0; i < cells.length; ++i) {
        let neighbours = townNeighbourCoords(cells[i])
        for (let j = 0; j < neighbours.length; ++j) {
            let coord = neighbours[j]
            let key = coordKey(coord)
            if (!isCoordInsideMap(coord, mapSize) || claimed[key] || expansionSeen[key]) {
                continue
            }
            expansionSeen[key] = true
            expansionCells.push(coord)
        }
    }
    return {
        town: {x: town.x, y: town.y},
        cells: cells,
        expansionCells: expansionCells
    }
}

function generateSuburbLayouts(rng, mapSize, towns, density, maxDistance, claimed) {
    let layouts = []
    for (let i = 0; i < towns.length; ++i) {
        layouts.push(generateSuburbLayout(
            rng, mapSize, towns[i], density, maxDistance, claimed))
    }
    return layouts
}

function configuredSuburbKeys(layouts) {
    let result = {}
    for (let i = 0; i < layouts.length; ++i) {
        for (let j = 0; j < layouts[i].cells.length; ++j) {
            result[coordKey(layouts[i].cells[j])] = true
        }
    }
    return result
}

function reserveSuburbExpansionCells(layouts, claimed, used) {
    for (let i = 0; i < layouts.length; ++i) {
        layouts[i].expansionCells = layouts[i].expansionCells.filter(function(coord) {
            let key = coordKey(coord)
            if (claimed[key]) {
                return false
            }
            claimed[key] = true
            markCoordKey(used, coord)
            return true
        })
    }
}

function generateBarrackScenarios(rng, mapSize, used, towns, density, pendingProbability, suburbs) {
    let barracks = []
    let pendingBarracks = []
    for (let townIndex = 0; townIndex < towns.length; ++townIndex) {
        let town = towns[townIndex]
        let candidates = townNeighbourCoords(town)
        for (let i = 0; i < candidates.length; ++i) {
            let coord = candidates[i]
            if (coord.x < 0 || coord.y < 0 ||
                coord.x >= mapSize.x || coord.y >= mapSize.y ||
                hasCoordKey(used, coord) || !suburbs[coordKey(coord)] ||
                rng() >= density) {
                continue
            }
            markCoordKey(used, coord)
            let scenario = {
                x: coord.x,
                y: coord.y,
                town: {x: town.x, y: town.y}
            }
            if (rng() < pendingProbability) {
                scenario.turns = randomIntWithRng(rng, 1, 3)
                pendingBarracks.push(scenario)
            }
            else {
                barracks.push(scenario)
            }
        }
    }
    return {barracks: barracks, pendingBarracks: pendingBarracks}
}

function generateFarmScenarios(rng, mapSize, used, towns, density, pendingProbability, suburbs) {
    let farms = []
    let pendingFarms = []
    for (let townIndex = 0; townIndex < towns.length; ++townIndex) {
        let town = towns[townIndex]
        let candidates = townNeighbourCoords(town)
        for (let i = 0; i < candidates.length; ++i) {
            let coord = candidates[i]
            if (coord.x < 0 || coord.y < 0 ||
                coord.x >= mapSize.x || coord.y >= mapSize.y ||
                hasCoordKey(used, coord) || !suburbs[coordKey(coord)] ||
                rng() >= density) {
                continue
            }
            markCoordKey(used, coord)
            let scenario = {
                x: coord.x,
                y: coord.y,
                town: {x: town.x, y: town.y}
            }
            if (rng() < pendingProbability) {
                scenario.turns = randomIntWithRng(rng, 1, 2)
                pendingFarms.push(scenario)
            }
            else {
                farms.push(scenario)
            }
        }
    }
    return {farms: farms, pendingFarms: pendingFarms}
}

function buildingDensityProfile(profile, config) {
    let profiles = {
        sparse: {
            barrackDensity: 0.05,
            farmDensity: 0.1,
            externalDensity: 0.1
        },
        normal: {
            barrackDensity: config.barrackDensity,
            farmDensity: config.farmDensity,
            externalDensity: config.externalDensity
        },
        dense: {
            barrackDensity: 0.35,
            farmDensity: 0.35,
            externalDensity: 1
        }
    }
    return profiles[profile] || profiles.normal
}

function generateExternalScenarios(rng, mapSize, used, towns, density, suburbs) {
    let result = {walls: [], bastions: [], towers: []}
    let types = [
        {name: 'walls'},
        {name: 'bastions'},
        {name: 'towers'}
    ]
    for (let townIndex = 0; townIndex < towns.length; ++townIndex) {
        let candidates = townNeighbourCoords(towns[townIndex])
        let offset = randomIntWithRng(rng, 0, types.length - 1)
        let placed = 0
        for (let i = 0; i < candidates.length; ++i) {
            let coord = candidates[i]
            if (coord.x < 0 || coord.y < 0 ||
                coord.x >= mapSize.x || coord.y >= mapSize.y ||
                hasCoordKey(used, coord) || !suburbs[coordKey(coord)] ||
                rng() >= density) {
                continue
            }
            markCoordKey(used, coord)
            let type = types[(offset + placed) % types.length]
            result[type.name].push({x: coord.x, y: coord.y})
            ++placed
        }
    }
    return result
}

function boundedInteger(value, fallback, min, max) {
    if (!Number.isFinite(value)) {
        return fallback
    }
    return Math.max(min, Math.min(max, Math.floor(value)))
}

function unitCompositionWeights(composition) {
    let profiles = {
        noob: {Noob: 1},
        balanced: {Noob: 1, Archer: 1, KOHb: 1, Normchel: 1, Catapult: 1},
        all: {Noob: 1, Archer: 1, KOHb: 1, Normchel: 1, Catapult: 1},
        combat: {Noob: 3, Archer: 3, KOHb: 2, Normchel: 1, Catapult: 2},
        economy: {Noob: 5, Archer: 1, KOHb: 1, Normchel: 2, Catapult: 0}
    }
    if (typeof composition == 'string') {
        return profiles[composition] || profiles.noob
    }
    if (!composition || typeof composition != 'object') {
        return profiles.noob
    }
    let weights = {}
    let names = ['Noob', 'Archer', 'KOHb', 'Normchel', 'Catapult']
    for (let i = 0; i < names.length; ++i) {
        let weight = Number(composition[names[i]])
        weights[names[i]] = Number.isFinite(weight) ? Math.max(0, weight) : 0
    }
    return weights
}

function unitTypeByName(name) {
    return {
        Noob: Noob,
        Archer: Archer,
        KOHb: KOHb,
        Normchel: Normchel,
        Catapult: Catapult
    }[name]
}

function createUnitComposition(rng, count, composition) {
    let weights = unitCompositionWeights(composition)
    let names = Object.keys(weights).filter(function(name) {
        return weights[name] > 0
    })
    if (!names.length) {
        names = ['Noob']
        weights.Noob = 1
    }

    let result = []
    if (composition == 'all' && count >= names.length) {
        let offset = randomIntWithRng(rng, 0, names.length - 1)
        for (let i = 0; i < names.length; ++i) {
            result.push(unitTypeByName(names[(offset + i) % names.length]))
        }
    }

    let totalWeight = names.reduce(function(total, name) {
        return total + weights[name]
    }, 0)
    while (result.length < count) {
        let choice = rng() * totalWeight
        for (let i = 0; i < names.length; ++i) {
            choice -= weights[names[i]]
            if (choice <= 0 || i == names.length - 1) {
                result.push(unitTypeByName(names[i]))
                break
            }
        }
    }
    return result
}

function generateGoldmineScenarios(rng, mapSize, used, count, incomeMin, incomeMax, maxOwner) {
    let goldmines = []
    for (let i = 0; i < count; ++i) {
        let coord = pickCoord(rng, mapSize, used)
        goldmines.push({
            x: coord.x,
            y: coord.y,
            income: randomIntWithRng(rng, incomeMin, incomeMax),
            owner: i <= maxOwner ? i : randomIntWithRng(rng, 0, maxOwner)
        })
    }
    return goldmines
}

// Co-op ownership is the numeric slot, independent of this display palette.
function coopPlayerColor(playerIndex) {
    const colors = [
        {r: 255, g: 0, b: 0},
        {r: 98, g: 168, b: 222},
        {r: 60, g: 190, b: 100},
        {r: 230, g: 170, b: 40},
        {r: 0, g: 110, b: 120},
        {r: 245, g: 120, b: 180},
        {r: 100, g: 70, b: 210},
        {r: 135, g: 80, b: 35},
        {r: 170, g: 200, b: 40},
        {r: 20, g: 55, b: 125},
        {r: 255, g: 110, b: 0},
        {r: 80, g: 80, b: 80}
    ]
    if (!Number.isInteger(playerIndex) || playerIndex < 1 || playerIndex > colors.length)
        throw new RangeError('Co-op human slot must be an integer from 1 to 12')
    return colors[playerIndex - 1]
}

function trainingPlayerColor(playerIndex) {
    let colors = [
        {r: 255, g: 0, b: 0},
        {r: 98, g: 168, b: 222},
        {r: 60, g: 190, b: 100},
        {r: 230, g: 170, b: 40}
    ]
    return colors[(playerIndex - 1) % colors.length]
}

function generateTownTrainingMap(options) {
    options = options || {}
    let config = townTrainingSizeConfig(options.size || 'tiny')
    let rng = createSeededRandom(options.seed || 1)
    let playerCount = boundedInteger(options.playerCount, 2, 2, 4)
    let densityProfile = buildingDensityProfile(options.buildingDensity || 'normal', config)
    let barrackDensity =
        clampProbability(options.barrackDensity, densityProfile.barrackDensity)
    let pendingBarrackProbability =
        clampProbability(options.pendingBarrackProbability, 0.5)
    let farmDensity = clampProbability(options.farmDensity, densityProfile.farmDensity)
    let pendingFarmProbability =
        clampProbability(options.pendingFarmProbability, 0.5)
    let externalDensity =
        clampProbability(options.externalDensity, densityProfile.externalDensity)
    let suburbDensity = clampProbability(options.suburbDensity, config.suburbDensity)
    let suburbDistance = boundedInteger(
        options.suburbDistance, config.suburbDistance, 1, 8)
    let goldmineCount = boundedInteger(options.goldmineCount, config.goldmines, 0, 32)
    let goldmineIncomeMin = boundedInteger(
        options.goldmineIncomeMin,
        GOLDMINE_TRAINING_INCOME_MIN,
        1,
        GOLDMINE_TRAINING_INCOME_MAX)
    let goldmineIncomeMax = boundedInteger(
        options.goldmineIncomeMax,
        GOLDMINE_TRAINING_INCOME_MAX,
        goldmineIncomeMin,
        1000)
    let startingGoldMin = boundedInteger(
        options.startingGoldMin,
        GOLDMINE_TRAINING_STARTING_GOLD_MIN,
        0,
        GOLDMINE_TRAINING_STARTING_GOLD_MAX)
    let startingGoldMax = boundedInteger(
        options.startingGoldMax,
        GOLDMINE_TRAINING_STARTING_GOLD_MAX,
        startingGoldMin,
        100000)
    let unitsPerPlayer = boundedInteger(
        options.unitsPerPlayer,
        config.extraUnitsPerPlayer,
        0,
        32)
    let unitComposition = options.unitComposition || 'noob'
    let mapSize = {x: config.mapSize.x, y: config.mapSize.y}
    let used = {}
    let allTowns = []
    let suburbTownDistance = Math.max(
        config.minTownDistance, suburbDistance * 2 + 1)

    let neutralTowns = []
    let playerTowns = []

    for (let playerIndex = 1; playerIndex <= playerCount; ++playerIndex) {
        playerTowns.push([placeTown(rng, mapSize, used, allTowns, suburbTownDistance)])
    }
    for (let i = 0; i < config.neutralTowns; ++i) {
        neutralTowns.push(placeTown(rng, mapSize, used, allTowns, suburbTownDistance))
    }

    let claimedSuburbs = {}
    for (let i = 0; i < allTowns.length; ++i) {
        claimedSuburbs[coordKey(allTowns[i])] = true
    }
    let playerSuburbs = []
    for (let playerIndex = 0; playerIndex < playerTowns.length; ++playerIndex) {
        delete claimedSuburbs[coordKey(playerTowns[playerIndex][0])]
        playerSuburbs.push(generateSuburbLayouts(
            rng, mapSize, playerTowns[playerIndex], suburbDensity, suburbDistance,
            claimedSuburbs))
    }
    for (let playerIndex = 0; playerIndex < playerSuburbs.length; ++playerIndex) {
        reserveSuburbExpansionCells(playerSuburbs[playerIndex], claimedSuburbs, used)
    }
    let playerSuburbKeys = playerSuburbs.map(function(suburbs) {
        return configuredSuburbKeys(suburbs)
    })

    let mountains = []
    let lakes = []
    for (let i = 0; i < config.blockers; ++i) {
        let coord = pickCoord(rng, mapSize, used)
        if (i % 2) {
            lakes.push(coord)
        }
        else {
            mountains.push(coord)
        }
    }

    let playerScenarios = []
    for (let playerIndex = 0; playerIndex < playerTowns.length; ++playerIndex) {
        let units = []
        let unitTypes = createUnitComposition(rng, unitsPerPlayer, unitComposition)
        for (let i = 0; i < unitsPerPlayer; ++i) {
            units.push(placeUnitNearTown(
                rng, mapSize, used, playerTowns[playerIndex][0], unitTypes[i]))
        }
        playerScenarios.push({
            units: units,
            barracks: generateBarrackScenarios(
                rng, mapSize, used, playerTowns[playerIndex], barrackDensity,
                pendingBarrackProbability, playerSuburbKeys[playerIndex]),
            farms: generateFarmScenarios(
                rng, mapSize, used, playerTowns[playerIndex], farmDensity,
                pendingFarmProbability, playerSuburbKeys[playerIndex]),
            external: generateExternalScenarios(
                rng, mapSize, used, playerTowns[playerIndex], externalDensity,
                playerSuburbKeys[playerIndex])
        })
    }
    let generatedGoldmines = generateGoldmineScenarios(
        rng, mapSize, used, goldmineCount, goldmineIncomeMin, goldmineIncomeMax,
        playerCount)

    let generatedPlayers = [{
        rgb: {r: 208, g: 208, b: 208},
        towns: neutralTowns
    }]
    for (let playerIndex = 1; playerIndex <= playerCount; ++playerIndex) {
        let scenario = playerScenarios[playerIndex - 1]
        generatedPlayers.push({
            rgb: trainingPlayerColor(playerIndex),
            gold: randomIntWithRng(rng, startingGoldMin, startingGoldMax),
            towns: playerTowns[playerIndex - 1],
            suburbs: playerSuburbs[playerIndex - 1],
            ai: playerIndex == 1 ? !gameSettings.testAI : true,
            units: scenario.units,
            barracks: scenario.barracks.barracks,
            pendingBarracks: scenario.barracks.pendingBarracks,
            farms: scenario.farms.farms,
            pendingFarms: scenario.farms.pendingFarms,
            walls: scenario.external.walls,
            bastions: scenario.external.bastions,
            towers: scenario.external.towers
        })
    }

    return new GameMap(
        mapSize,
        generatedPlayers,
        generatedGoldmines,
        lakes,
        mountains)
}

function generateTinyTownTrainingMap(seed) {
    return generateTownTrainingMap({size: 'tiny', seed: seed})
}

function generateMediumTownTrainingMap(seed) {
    return generateTownTrainingMap({size: 'medium', seed: seed})
}

function generateBigTownTrainingMap(seed) {
    return generateTownTrainingMap({size: 'big', seed: seed})
}

function generateEconomyStage1TrainingMap(options) {
    options = options || {}
    let seed = options.seed || 1
    let rng = createSeededRandom(seed)
    let mapSize = {x: 7, y: 5}
    let leftTown = {x: 1, y: 2}
    let rightTown = {x: 5, y: 2}
    rng()
    let buildingType = randomIntWithRng(rng, 0, 1) == 0 ? 'towers' : 'bastions'
    let buildingHp = randomIntWithRng(
        rng,
        ECONOMY_GENERATOR_STAGE_1_HP_MIN,
        ECONOMY_GENERATOR_STAGE_1_HP_MAX)
    let leftBuilding = {x: 2, y: 2, town: leftTown, hp: buildingHp}
    let rightBuilding = {x: 4, y: 2, town: rightTown, hp: buildingHp}
    let leftSuburbCells = [
        leftTown,
        {x: 1, y: 1},
        {x: 1, y: 3},
        {x: 2, y: 2}
    ]
    let rightSuburbCells = [
        rightTown,
        {x: 5, y: 1},
        {x: 5, y: 3},
        {x: 4, y: 2}
    ]
    let generatedPlayers = [
        {
            rgb: {r: 208, g: 208, b: 208},
            towns: []
        },
        {
            rgb: trainingPlayerColor(1),
            playerType: 'AIPlayerWithEconomy',
            ai: true,
            gold: 90,
            towns: [leftTown],
            units: [
                {type: Noob, x: 2, y: 1},
                {type: Noob, x: 2, y: 3}
            ],
            suburbs: [{
                town: leftTown,
                cells: leftSuburbCells,
                expansionCells: [{x: 0, y: 2}, {x: 2, y: 0}, {x: 2, y: 4}]
            }],
            towers: buildingType == 'towers' ? [leftBuilding] : [],
            bastions: buildingType == 'bastions' ? [leftBuilding] : []
        },
        {
            rgb: trainingPlayerColor(2),
            playerType: 'SimpleAiPlayerWithEconomy',
            ai: true,
            gold: 90,
            towns: [rightTown],
            units: [
                {type: Noob, x: 4, y: 1},
                {type: Noob, x: 4, y: 3}
            ],
            suburbs: [{
                town: rightTown,
                cells: rightSuburbCells,
                expansionCells: [{x: 6, y: 2}, {x: 4, y: 0}, {x: 4, y: 4}]
            }],
            towers: buildingType == 'towers' ? [rightBuilding] : [],
            bastions: buildingType == 'bastions' ? [rightBuilding] : []
        }
    ]
    let map = new GameMap(
        mapSize,
        generatedPlayers,
        [],
        [],
        [])
    map.testName = 'economy-stage-1-' + seed
    map.suddenDeathRound = options.suddenDeathRound || 40
    map.economyStage = 1
    map.economyGenerator = {
        stage: 1,
        seed: seed,
        playerOne: 'AIPlayerWithEconomy',
        playerTwo: 'SimpleAiPlayerWithEconomy',
        buildingType: buildingType == 'towers' ? 'tower' : 'bastion',
        hp: buildingHp,
        hpMin: ECONOMY_GENERATOR_STAGE_1_HP_MIN,
        hpMax: ECONOMY_GENERATOR_STAGE_1_HP_MAX
    }
    map.economyObjects = {
        farms: 0,
        barracks: 0,
        goldmines: 0,
        towns: 2,
        productionActions: 0,
        resources: 180,
        towers: buildingType == 'towers' ? 2 : 0,
        bastions: buildingType == 'bastions' ? 2 : 0
    }
    return map
}

function generateEconomyStage2TrainingMap(options) {
    options = options || {}
    let seed = options.seed || 1
    let rng = createSeededRandom(seed)
    let mapSize = {x: 9, y: 7}
    let leftTown = {x: 1, y: 3}
    let rightTown = {x: 7, y: 3}
    rng()
    let buildingType = randomIntWithRng(rng, 0, 1) == 0 ? 'towers' : 'bastions'
    let buildingHp = randomIntWithRng(
        rng,
        ECONOMY_GENERATOR_STAGE_2_HP_MIN,
        ECONOMY_GENERATOR_STAGE_2_HP_MAX)
    let leftBuilding = {x: 3, y: 3, town: leftTown, hp: buildingHp}
    let rightBuilding = {x: 5, y: 3, town: rightTown, hp: buildingHp}
    let leftSuburbCells = [
        leftTown,
        {x: 1, y: 2},
        {x: 1, y: 4},
        {x: 2, y: 2},
        {x: 2, y: 3},
        {x: 2, y: 4},
        {x: 3, y: 3}
    ]
    let rightSuburbCells = [
        rightTown,
        {x: 7, y: 2},
        {x: 7, y: 4},
        {x: 6, y: 2},
        {x: 6, y: 3},
        {x: 6, y: 4},
        {x: 5, y: 3}
    ]
    let generatedPlayers = [
        {
            rgb: {r: 208, g: 208, b: 208},
            towns: []
        },
        {
            rgb: trainingPlayerColor(1),
            playerType: 'AIPlayerWithEconomy',
            ai: true,
            gold: 110,
            towns: [leftTown],
            units: [
                {type: Noob, x: 2, y: 2},
                {type: Noob, x: 2, y: 4}
            ],
            suburbs: [{
                town: leftTown,
                cells: leftSuburbCells,
                expansionCells: [{x: 0, y: 3}, {x: 3, y: 2}, {x: 3, y: 4}]
            }],
            towers: buildingType == 'towers' ? [leftBuilding] : [],
            bastions: buildingType == 'bastions' ? [leftBuilding] : []
        },
        {
            rgb: trainingPlayerColor(2),
            playerType: 'SimpleAiPlayerWithEconomy',
            ai: true,
            gold: 110,
            towns: [rightTown],
            units: [
                {type: Noob, x: 6, y: 2},
                {type: Noob, x: 6, y: 4}
            ],
            suburbs: [{
                town: rightTown,
                cells: rightSuburbCells,
                expansionCells: [{x: 8, y: 3}, {x: 5, y: 2}, {x: 5, y: 4}]
            }],
            towers: buildingType == 'towers' ? [rightBuilding] : [],
            bastions: buildingType == 'bastions' ? [rightBuilding] : []
        }
    ]
    let map = new GameMap(
        mapSize,
        generatedPlayers,
        [],
        [],
        [])
    map.testName = 'economy-stage-2-' + seed
    map.suddenDeathRound = options.suddenDeathRound || 50
    map.economyStage = 2
    map.economyGenerator = {
        stage: 2,
        seed: seed,
        playerOne: 'AIPlayerWithEconomy',
        playerTwo: 'SimpleAiPlayerWithEconomy',
        buildingType: buildingType == 'towers' ? 'tower' : 'bastion',
        hp: buildingHp,
        hpMin: ECONOMY_GENERATOR_STAGE_2_HP_MIN,
        hpMax: ECONOMY_GENERATOR_STAGE_2_HP_MAX
    }
    map.economyObjects = {
        farms: 0,
        barracks: 0,
        goldmines: 0,
        towns: 2,
        productionActions: 0,
        resources: 220,
        towers: buildingType == 'towers' ? 2 : 0,
        bastions: buildingType == 'bastions' ? 2 : 0
    }
    return map
}

function generateEconomyStage3TrainingMap(options) {
    options = options || {}
    let seed = options.seed || 1
    let rng = createSeededRandom(seed)
    let mapSize = {x: 11, y: 9}
    let leftTown = {x: 1, y: 4}
    let rightTown = {x: 9, y: 4}
    rng()
    let buildingType = randomIntWithRng(rng, 0, 1) == 0 ? 'towers' : 'bastions'
    let buildingHp = randomIntWithRng(
        rng,
        ECONOMY_GENERATOR_STAGE_3_HP_MIN,
        ECONOMY_GENERATOR_STAGE_3_HP_MAX)
    let leftBuilding = {x: 4, y: 4, town: leftTown, hp: buildingHp}
    let rightBuilding = {x: 6, y: 4, town: rightTown, hp: buildingHp}
    let leftSuburbCells = [
        leftTown,
        {x: 1, y: 3},
        {x: 1, y: 5},
        {x: 2, y: 2},
        {x: 2, y: 3},
        {x: 2, y: 4},
        {x: 2, y: 5},
        {x: 2, y: 6},
        {x: 3, y: 3},
        {x: 3, y: 5},
        {x: 4, y: 4}
    ]
    let rightSuburbCells = [
        rightTown,
        {x: 9, y: 3},
        {x: 9, y: 5},
        {x: 8, y: 2},
        {x: 8, y: 3},
        {x: 8, y: 4},
        {x: 8, y: 5},
        {x: 8, y: 6},
        {x: 7, y: 3},
        {x: 7, y: 5},
        {x: 6, y: 4}
    ]
    let leftUnits = [
        {type: Noob, x: 3, y: 2},
        {type: Noob, x: 3, y: 4},
        {type: Noob, x: 3, y: 6},
        {type: Noob, x: 4, y: 3}
    ]
    let rightUnits = [
        {type: Noob, x: 7, y: 2},
        {type: Noob, x: 7, y: 4},
        {type: Noob, x: 7, y: 6},
        {type: Noob, x: 6, y: 3}
    ]
    let generatedPlayers = [
        {
            rgb: {r: 208, g: 208, b: 208},
            towns: []
        },
        {
            rgb: trainingPlayerColor(1),
            playerType: 'AIPlayerWithEconomy',
            ai: true,
            gold: 130,
            towns: [leftTown],
            units: leftUnits,
            suburbs: [{
                town: leftTown,
                cells: leftSuburbCells,
                expansionCells: [{x: 0, y: 4}, {x: 4, y: 2}, {x: 4, y: 6}]
            }],
            towers: buildingType == 'towers' ? [leftBuilding] : [],
            bastions: buildingType == 'bastions' ? [leftBuilding] : []
        },
        {
            rgb: trainingPlayerColor(2),
            playerType: 'SimpleAiPlayerWithEconomy',
            ai: true,
            gold: 130,
            towns: [rightTown],
            units: rightUnits,
            suburbs: [{
                town: rightTown,
                cells: rightSuburbCells,
                expansionCells: [{x: 10, y: 4}, {x: 6, y: 2}, {x: 6, y: 6}]
            }],
            towers: buildingType == 'towers' ? [rightBuilding] : [],
            bastions: buildingType == 'bastions' ? [rightBuilding] : []
        }
    ]
    let map = new GameMap(
        mapSize,
        generatedPlayers,
        [],
        [],
        [])
    map.testName = 'economy-stage-3-' + seed
    map.suddenDeathRound = options.suddenDeathRound || 60
    map.economyStage = 3
    map.economyGenerator = {
        stage: 3,
        seed: seed,
        playerOne: 'AIPlayerWithEconomy',
        playerTwo: 'SimpleAiPlayerWithEconomy',
        buildingType: buildingType == 'towers' ? 'tower' : 'bastion',
        hp: buildingHp,
        hpMin: ECONOMY_GENERATOR_STAGE_3_HP_MIN,
        hpMax: ECONOMY_GENERATOR_STAGE_3_HP_MAX,
        noobsPerPlayer: leftUnits.length
    }
    map.economyObjects = {
        farms: 0,
        barracks: 0,
        goldmines: 0,
        towns: 2,
        productionActions: 0,
        resources: 260,
        noobs: leftUnits.length + rightUnits.length,
        towers: buildingType == 'towers' ? 2 : 0,
        bastions: buildingType == 'bastions' ? 2 : 0
    }
    return map
}

function generateEconomyStage4TrainingMap(options) {
    options = options || {}
    let seed = options.seed || 1
    let rng = createSeededRandom(seed)
    let mapSize = {x: 11, y: 9}
    let leftTown = {x: 1, y: 4}
    let rightTown = {x: 9, y: 4}
    rng()
    let towerHp = randomIntWithRng(
        rng,
        ECONOMY_GENERATOR_STAGE_4_HP_MIN,
        ECONOMY_GENERATOR_STAGE_4_HP_MAX)
    let bastionHp = randomIntWithRng(
        rng,
        ECONOMY_GENERATOR_STAGE_4_HP_MIN,
        ECONOMY_GENERATOR_STAGE_4_HP_MAX)
    let leftTower = {x: 4, y: 3, town: leftTown, hp: towerHp}
    let rightTower = {x: 6, y: 3, town: rightTown, hp: towerHp}
    let leftBastion = {x: 4, y: 5, town: leftTown, hp: bastionHp}
    let rightBastion = {x: 6, y: 5, town: rightTown, hp: bastionHp}
    let leftSuburbCells = [
        leftTown,
        {x: 1, y: 3},
        {x: 1, y: 5},
        {x: 2, y: 2},
        {x: 2, y: 3},
        {x: 2, y: 4},
        {x: 2, y: 5},
        {x: 2, y: 6},
        {x: 3, y: 3},
        {x: 3, y: 5},
        {x: 4, y: 3},
        {x: 4, y: 5}
    ]
    let rightSuburbCells = [
        rightTown,
        {x: 9, y: 3},
        {x: 9, y: 5},
        {x: 8, y: 2},
        {x: 8, y: 3},
        {x: 8, y: 4},
        {x: 8, y: 5},
        {x: 8, y: 6},
        {x: 7, y: 3},
        {x: 7, y: 5},
        {x: 6, y: 3},
        {x: 6, y: 5}
    ]
    let leftUnits = [
        {type: Noob, x: 3, y: 2},
        {type: Noob, x: 3, y: 4},
        {type: Noob, x: 3, y: 6},
        {type: Noob, x: 4, y: 2}
    ]
    let rightUnits = [
        {type: Noob, x: 7, y: 2},
        {type: Noob, x: 7, y: 4},
        {type: Noob, x: 7, y: 6},
        {type: Noob, x: 6, y: 2}
    ]
    let generatedPlayers = [
        {
            rgb: {r: 208, g: 208, b: 208},
            towns: []
        },
        {
            rgb: trainingPlayerColor(1),
            playerType: 'AIPlayerWithEconomy',
            ai: true,
            gold: 140,
            towns: [leftTown],
            units: leftUnits,
            suburbs: [{
                town: leftTown,
                cells: leftSuburbCells,
                expansionCells: [{x: 0, y: 4}, {x: 4, y: 1}, {x: 4, y: 7}]
            }],
            towers: [leftTower],
            bastions: [leftBastion]
        },
        {
            rgb: trainingPlayerColor(2),
            playerType: 'SimpleAiPlayerWithEconomy',
            ai: true,
            gold: 140,
            towns: [rightTown],
            units: rightUnits,
            suburbs: [{
                town: rightTown,
                cells: rightSuburbCells,
                expansionCells: [{x: 10, y: 4}, {x: 6, y: 1}, {x: 6, y: 7}]
            }],
            towers: [rightTower],
            bastions: [rightBastion]
        }
    ]
    let map = new GameMap(
        mapSize,
        generatedPlayers,
        [],
        [],
        [])
    map.testName = 'economy-stage-4-' + seed
    map.suddenDeathRound = options.suddenDeathRound || 70
    map.economyStage = 4
    map.economyGenerator = {
        stage: 4,
        seed: seed,
        playerOne: 'AIPlayerWithEconomy',
        playerTwo: 'SimpleAiPlayerWithEconomy',
        buildingTypes: ['tower', 'bastion'],
        hpByType: {
            tower: towerHp,
            bastion: bastionHp
        },
        hpMin: ECONOMY_GENERATOR_STAGE_4_HP_MIN,
        hpMax: ECONOMY_GENERATOR_STAGE_4_HP_MAX,
        noobsPerPlayer: leftUnits.length,
        defensiveBuildingsPerPlayer: 2
    }
    map.economyObjects = {
        farms: 0,
        barracks: 0,
        goldmines: 0,
        towns: 2,
        productionActions: 0,
        resources: 280,
        noobs: leftUnits.length + rightUnits.length,
        towers: 2,
        bastions: 2
    }
    return map
}

function stage5UnitsFromCoords(coords, archerIndexes) {
    let units = []
    for (let i = 0; i < coords.length; ++i) {
        units.push({
            type: archerIndexes[i] === true ? Archer : Noob,
            x: coords[i].x,
            y: coords[i].y
        })
    }
    return units
}

function stage6UnitsFromCoords(coords, archerIndexes, catapultIndexes) {
    let units = []
    for (let i = 0; i < coords.length; ++i) {
        let type = Noob
        if (catapultIndexes[i] === true) {
            type = Catapult
        }
        else if (archerIndexes[i] === true) {
            type = Archer
        }
        units.push({
            type: type,
            x: coords[i].x,
            y: coords[i].y
        })
    }
    return units
}

function stage7UnitsFromCoords(coords, offset) {
    let unitTypes = [Noob, Archer, KOHb, Normchel, Catapult]
    let units = []
    for (let i = 0; i < coords.length; ++i) {
        units.push({
            type: unitTypes[(offset + i) % unitTypes.length],
            x: coords[i].x,
            y: coords[i].y
        })
    }
    return units
}

function generateEconomyStage5TrainingMap(options) {
    options = options || {}
    let seed = options.seed || 1
    let rng = createSeededRandom(seed)
    let mapSize = {x: 11, y: 9}
    let leftTown = {x: 1, y: 4}
    let rightTown = {x: 9, y: 4}
    rng()
    let towerHp = randomIntWithRng(
        rng,
        ECONOMY_GENERATOR_STAGE_5_HP_MIN,
        ECONOMY_GENERATOR_STAGE_5_HP_MAX)
    let bastionHp = randomIntWithRng(
        rng,
        ECONOMY_GENERATOR_STAGE_5_HP_MIN,
        ECONOMY_GENERATOR_STAGE_5_HP_MAX)
    let leftTower = {x: 4, y: 3, town: leftTown, hp: towerHp}
    let rightTower = {x: 6, y: 3, town: rightTown, hp: towerHp}
    let leftBastion = {x: 4, y: 5, town: leftTown, hp: bastionHp}
    let rightBastion = {x: 6, y: 5, town: rightTown, hp: bastionHp}
    let leftSuburbCells = [
        leftTown,
        {x: 1, y: 3},
        {x: 1, y: 5},
        {x: 2, y: 2},
        {x: 2, y: 3},
        {x: 2, y: 4},
        {x: 2, y: 5},
        {x: 2, y: 6},
        {x: 3, y: 3},
        {x: 3, y: 5},
        {x: 4, y: 3},
        {x: 4, y: 5}
    ]
    let rightSuburbCells = [
        rightTown,
        {x: 9, y: 3},
        {x: 9, y: 5},
        {x: 8, y: 2},
        {x: 8, y: 3},
        {x: 8, y: 4},
        {x: 8, y: 5},
        {x: 8, y: 6},
        {x: 7, y: 3},
        {x: 7, y: 5},
        {x: 6, y: 3},
        {x: 6, y: 5}
    ]
    let leftCoords = [
        {x: 3, y: 2},
        {x: 3, y: 4},
        {x: 3, y: 6},
        {x: 4, y: 2}
    ]
    let rightCoords = [
        {x: 7, y: 2},
        {x: 7, y: 4},
        {x: 7, y: 6},
        {x: 6, y: 2}
    ]
    let archerCount = randomIntWithRng(rng, 0, 9999) % 2 + 1
    let archerIndexes = {}
    while (Object.keys(archerIndexes).length < archerCount) {
        archerIndexes[randomIntWithRng(rng, 0, leftCoords.length - 1)] = true
    }
    let leftUnits = stage5UnitsFromCoords(leftCoords, archerIndexes)
    let rightUnits = stage5UnitsFromCoords(rightCoords, archerIndexes)
    let generatedPlayers = [
        {
            rgb: {r: 208, g: 208, b: 208},
            towns: []
        },
        {
            rgb: trainingPlayerColor(1),
            playerType: 'AIPlayerWithEconomy',
            ai: true,
            gold: 140,
            towns: [leftTown],
            units: leftUnits,
            suburbs: [{
                town: leftTown,
                cells: leftSuburbCells,
                expansionCells: [{x: 0, y: 4}, {x: 4, y: 1}, {x: 4, y: 7}]
            }],
            towers: [leftTower],
            bastions: [leftBastion]
        },
        {
            rgb: trainingPlayerColor(2),
            playerType: 'SimpleAiPlayerWithEconomy',
            ai: true,
            gold: 140,
            towns: [rightTown],
            units: rightUnits,
            suburbs: [{
                town: rightTown,
                cells: rightSuburbCells,
                expansionCells: [{x: 10, y: 4}, {x: 6, y: 1}, {x: 6, y: 7}]
            }],
            towers: [rightTower],
            bastions: [rightBastion]
        }
    ]
    let map = new GameMap(
        mapSize,
        generatedPlayers,
        [],
        [],
        [])
    map.testName = 'economy-stage-5-' + seed
    map.suddenDeathRound = options.suddenDeathRound || 70
    map.economyStage = 5
    map.economyGenerator = {
        stage: 5,
        seed: seed,
        playerOne: 'AIPlayerWithEconomy',
        playerTwo: 'SimpleAiPlayerWithEconomy',
        buildingTypes: ['tower', 'bastion'],
        hpByType: {
            tower: towerHp,
            bastion: bastionHp
        },
        hpMin: ECONOMY_GENERATOR_STAGE_5_HP_MIN,
        hpMax: ECONOMY_GENERATOR_STAGE_5_HP_MAX,
        unitsPerPlayer: leftUnits.length,
        noobsPerPlayer: leftUnits.length - archerCount,
        archersPerPlayer: archerCount,
        archerRatio: archerCount + '/' + leftUnits.length,
        archerIndexes: Object.keys(archerIndexes).map(function(index) {
            return Number(index)
        }).sort(function(a, b) {
            return a - b
        }),
        defensiveBuildingsPerPlayer: 2
    }
    map.economyObjects = {
        farms: 0,
        barracks: 0,
        goldmines: 0,
        towns: 2,
        productionActions: 0,
        resources: 280,
        noobs: (leftUnits.length - archerCount) + (rightUnits.length - archerCount),
        archers: archerCount * 2,
        towers: 2,
        bastions: 2
    }
    return map
}

function generateEconomyStage6TrainingMap(options) {
    options = options || {}
    let seed = options.seed || 1
    let rng = createSeededRandom(seed)
    let mapSize = {x: 11, y: 9}
    let leftTown = {x: 1, y: 4}
    let rightTown = {x: 9, y: 4}
    rng()
    let towerHp = randomIntWithRng(
        rng,
        ECONOMY_GENERATOR_STAGE_6_HP_MIN,
        ECONOMY_GENERATOR_STAGE_6_HP_MAX)
    let bastionHp = randomIntWithRng(
        rng,
        ECONOMY_GENERATOR_STAGE_6_HP_MIN,
        ECONOMY_GENERATOR_STAGE_6_HP_MAX)
    let leftTower = {x: 4, y: 3, town: leftTown, hp: towerHp}
    let rightTower = {x: 6, y: 3, town: rightTown, hp: towerHp}
    let leftBastion = {x: 4, y: 5, town: leftTown, hp: bastionHp}
    let rightBastion = {x: 6, y: 5, town: rightTown, hp: bastionHp}
    let leftSuburbCells = [
        leftTown,
        {x: 1, y: 3},
        {x: 1, y: 5},
        {x: 2, y: 2},
        {x: 2, y: 3},
        {x: 2, y: 4},
        {x: 2, y: 5},
        {x: 2, y: 6},
        {x: 3, y: 3},
        {x: 3, y: 5},
        {x: 4, y: 3},
        {x: 4, y: 5}
    ]
    let rightSuburbCells = [
        rightTown,
        {x: 9, y: 3},
        {x: 9, y: 5},
        {x: 8, y: 2},
        {x: 8, y: 3},
        {x: 8, y: 4},
        {x: 8, y: 5},
        {x: 8, y: 6},
        {x: 7, y: 3},
        {x: 7, y: 5},
        {x: 6, y: 3},
        {x: 6, y: 5}
    ]
    let leftCoords = [
        {x: 3, y: 2},
        {x: 3, y: 4},
        {x: 3, y: 6},
        {x: 4, y: 2}
    ]
    let rightCoords = [
        {x: 7, y: 2},
        {x: 7, y: 4},
        {x: 7, y: 6},
        {x: 6, y: 2}
    ]
    let archerCount = randomIntWithRng(rng, 0, 9999) % 2 + 1
    let catapultCount = 1
    let archerIndexes = {}
    while (Object.keys(archerIndexes).length < archerCount) {
        archerIndexes[randomIntWithRng(rng, 0, leftCoords.length - 1)] = true
    }
    let catapultIndexes = {}
    while (Object.keys(catapultIndexes).length < catapultCount) {
        let index = randomIntWithRng(rng, 0, leftCoords.length - 1)
        if (archerIndexes[index] !== true) {
            catapultIndexes[index] = true
        }
    }
    let leftUnits = stage6UnitsFromCoords(leftCoords, archerIndexes, catapultIndexes)
    let rightUnits = stage6UnitsFromCoords(rightCoords, archerIndexes, catapultIndexes)
    let generatedPlayers = [
        {
            rgb: {r: 208, g: 208, b: 208},
            towns: []
        },
        {
            rgb: trainingPlayerColor(1),
            playerType: 'AIPlayerWithEconomy',
            ai: true,
            gold: 140,
            towns: [leftTown],
            units: leftUnits,
            suburbs: [{
                town: leftTown,
                cells: leftSuburbCells,
                expansionCells: [{x: 0, y: 4}, {x: 4, y: 1}, {x: 4, y: 7}]
            }],
            towers: [leftTower],
            bastions: [leftBastion]
        },
        {
            rgb: trainingPlayerColor(2),
            playerType: 'SimpleAiPlayerWithEconomy',
            ai: true,
            gold: 140,
            towns: [rightTown],
            units: rightUnits,
            suburbs: [{
                town: rightTown,
                cells: rightSuburbCells,
                expansionCells: [{x: 10, y: 4}, {x: 6, y: 1}, {x: 6, y: 7}]
            }],
            towers: [rightTower],
            bastions: [rightBastion]
        }
    ]
    let map = new GameMap(
        mapSize,
        generatedPlayers,
        [],
        [],
        [])
    map.testName = 'economy-stage-6-' + seed
    map.suddenDeathRound = options.suddenDeathRound || 70
    map.economyStage = 6
    map.economyGenerator = {
        stage: 6,
        seed: seed,
        playerOne: 'AIPlayerWithEconomy',
        playerTwo: 'SimpleAiPlayerWithEconomy',
        buildingTypes: ['tower', 'bastion'],
        hpByType: {
            tower: towerHp,
            bastion: bastionHp
        },
        hpMin: ECONOMY_GENERATOR_STAGE_6_HP_MIN,
        hpMax: ECONOMY_GENERATOR_STAGE_6_HP_MAX,
        unitsPerPlayer: leftUnits.length,
        noobsPerPlayer: leftUnits.length - archerCount - catapultCount,
        archersPerPlayer: archerCount,
        catapultsPerPlayer: catapultCount,
        archerRatio: archerCount + '/' + leftUnits.length,
        catapultRatio: catapultCount + '/' + leftUnits.length,
        archerIndexes: Object.keys(archerIndexes).map(function(index) {
            return Number(index)
        }).sort(function(a, b) {
            return a - b
        }),
        catapultIndexes: Object.keys(catapultIndexes).map(function(index) {
            return Number(index)
        }).sort(function(a, b) {
            return a - b
        }),
        defensiveBuildingsPerPlayer: 2
    }
    map.economyObjects = {
        farms: 0,
        barracks: 0,
        goldmines: 0,
        towns: 2,
        productionActions: 0,
        resources: 280,
        noobs: (leftUnits.length - archerCount - catapultCount) +
            (rightUnits.length - archerCount - catapultCount),
        archers: archerCount * 2,
        catapults: catapultCount * 2,
        towers: 2,
        bastions: 2
    }
    return map
}

function generateEconomyStage7TrainingMap(options) {
    options = options || {}
    let seed = options.seed || 1
    let rng = createSeededRandom(seed)
    let mapSize = {x: 9, y: 9}
    let leftTown = {x: 1, y: 4}
    let rightTown = {x: 7, y: 4}
    rng()
    let towerHp = randomIntWithRng(
        rng,
        ECONOMY_GENERATOR_STAGE_7_HP_MIN,
        ECONOMY_GENERATOR_STAGE_7_HP_MAX)
    let bastionHp = randomIntWithRng(
        rng,
        ECONOMY_GENERATOR_STAGE_7_HP_MIN,
        ECONOMY_GENERATOR_STAGE_7_HP_MAX)
    let leftTower = {x: 3, y: 3, town: leftTown, hp: towerHp}
    let rightTower = {x: 5, y: 3, town: rightTown, hp: towerHp}
    let leftBastion = {x: 3, y: 5, town: leftTown, hp: bastionHp}
    let rightBastion = {x: 5, y: 5, town: rightTown, hp: bastionHp}
    let leftSuburbCells = [
        leftTown,
        {x: 1, y: 3},
        {x: 1, y: 5},
        {x: 2, y: 2},
        {x: 2, y: 3},
        {x: 2, y: 4},
        {x: 2, y: 5},
        {x: 2, y: 6},
        {x: 3, y: 3},
        {x: 3, y: 5}
    ]
    let rightSuburbCells = [
        rightTown,
        {x: 7, y: 3},
        {x: 7, y: 5},
        {x: 6, y: 2},
        {x: 6, y: 3},
        {x: 6, y: 4},
        {x: 6, y: 5},
        {x: 6, y: 6},
        {x: 5, y: 3},
        {x: 5, y: 5}
    ]
    let leftCoords = [
        {x: 2, y: 1},
        {x: 2, y: 4},
        {x: 2, y: 7},
        {x: 3, y: 1},
        {x: 3, y: 7}
    ]
    let rightCoords = [
        {x: 6, y: 1},
        {x: 6, y: 4},
        {x: 6, y: 7},
        {x: 5, y: 1},
        {x: 5, y: 7}
    ]
    let unitTypeOffset = randomIntWithRng(rng, 0, 4)
    let leftUnits = stage7UnitsFromCoords(leftCoords, unitTypeOffset)
    let rightUnits = stage7UnitsFromCoords(rightCoords, unitTypeOffset)
    let generatedPlayers = [
        {
            rgb: {r: 208, g: 208, b: 208},
            towns: []
        },
        {
            rgb: trainingPlayerColor(1),
            playerType: 'AIPlayerWithEconomy',
            ai: true,
            gold: 160,
            towns: [leftTown],
            units: leftUnits,
            suburbs: [{
                town: leftTown,
                cells: leftSuburbCells,
                expansionCells: [{x: 0, y: 4}, {x: 4, y: 2}, {x: 4, y: 6}]
            }],
            towers: [leftTower],
            bastions: [leftBastion]
        },
        {
            rgb: trainingPlayerColor(2),
            playerType: 'SimpleAiPlayerWithEconomy',
            ai: true,
            gold: 160,
            towns: [rightTown],
            units: rightUnits,
            suburbs: [{
                town: rightTown,
                cells: rightSuburbCells,
                expansionCells: [{x: 8, y: 4}, {x: 4, y: 2}, {x: 4, y: 6}]
            }],
            towers: [rightTower],
            bastions: [rightBastion]
        }
    ]
    let map = new GameMap(
        mapSize,
        generatedPlayers,
        [],
        [],
        [])
    map.testName = 'economy-stage-7-' + seed
    map.suddenDeathRound = options.suddenDeathRound || 80
    map.economyStage = 7
    map.economyGenerator = {
        stage: 7,
        seed: seed,
        playerOne: 'AIPlayerWithEconomy',
        playerTwo: 'SimpleAiPlayerWithEconomy',
        buildingTypes: ['tower', 'bastion'],
        hpByType: {
            tower: towerHp,
            bastion: bastionHp
        },
        hpMin: ECONOMY_GENERATOR_STAGE_7_HP_MIN,
        hpMax: ECONOMY_GENERATOR_STAGE_7_HP_MAX,
        unitsPerPlayer: leftUnits.length,
        noobsPerPlayer: 1,
        archersPerPlayer: 1,
        KOHbsPerPlayer: 1,
        normchelsPerPlayer: 1,
        catapultsPerPlayer: 1,
        unitTypes: ['Noob', 'Archer', 'KOHb', 'Normchel', 'Catapult'],
        unitTypeOffset: unitTypeOffset,
        defensiveBuildingsPerPlayer: 2
    }
    map.economyObjects = {
        farms: 0,
        barracks: 0,
        goldmines: 0,
        towns: 2,
        productionActions: 0,
        resources: 320,
        noobs: 2,
        archers: 2,
        KOHbs: 2,
        normchels: 2,
        catapults: 2,
        towers: 2,
        bastions: 2
    }
    return map
}

function generateEconomyStage8TrainingMap(options) {
    options = options || {}
    let seed = options.seed || 1
    let map = generateEconomyStage7TrainingMap(options)
    let rng = createSeededRandom(seed)
    rng()
    rng()
    rng()
    let upperLane = rng() < 0.5
    let lowerLane = rng() < 0.5
    let mapSize = map.mapSize
    let mountainY = upperLane ? 1 : 7
    let lakeY = lowerLane ? 1 : 7
    let bushY = upperLane ? 2 : 6

    map.lakes = [
        {x: 4, y: lakeY}
    ]
    map.mountains = [
        {x: 0, y: mountainY},
        {x: mapSize.x - 1, y: mountainY}
    ]
    map.bushes = [
        {x: 0, y: bushY},
        {x: mapSize.x - 1, y: bushY}
    ]
    map.testName = 'economy-stage-8-' + seed
    map.suddenDeathRound = options.suddenDeathRound || 90
    map.economyStage = 8
    map.economyGenerator = Object.assign({}, map.economyGenerator, {
        stage: 8,
        seed: seed,
        terrainTypes: ['mountain', 'bush', 'lake'],
        terrainCounts: {
            mountains: map.mountains.length,
            bushes: map.bushes.length,
            lakes: map.lakes.length
        },
        terrainSymmetry: {
            axis: 'vertical',
            mirror: 'x',
            fairForBothSides: true
        },
        stage7RequirementsPreserved: true,
        hpMin: ECONOMY_GENERATOR_STAGE_8_HP_MIN,
        hpMax: ECONOMY_GENERATOR_STAGE_8_HP_MAX
    })
    return map
}

function generateAdvancedEconomyStage1TrainingMap(options) {
    options = options || {}
    let seed = options.seed || 1
    let mapSize = {x: 3, y: 3}
    let redTown = {x: 1, y: 0}
    let blueTown = {x: 1, y: 2}
    let generatedPlayers = [
        {
            rgb: {r: 208, g: 208, b: 208},
            towns: []
        },
        {
            rgb: trainingPlayerColor(1),
            playerType: 'AIPlayerWithEconomy',
            ai: true,
            gold: 90,
            towns: [redTown],
            units: []
        },
        {
            rgb: trainingPlayerColor(2),
            playerType: 'SimpleAiPlayerWithEconomy',
            ai: true,
            gold: 90,
            towns: [blueTown],
            units: []
        }
    ]
    let map = new GameMap(
        mapSize,
        generatedPlayers,
        [],
        [],
        [])
    map.testName = 'advanced-economy-stage-1-' + seed
    map.suddenDeathRound = options.suddenDeathRound || 40
    map.economyStage = 'advanced-1'
    map.advancedEconomyStage = 1
    map.economyGenerator = {
        stage: 'advanced-1',
        seed: seed,
        playerOne: 'AIPlayerWithEconomy',
        playerTwo: 'SimpleAiPlayerWithEconomy',
        mapSize: mapSize,
        townLayout: 'vertical-mirror',
        townCount: 2,
        emptyMap: true
    }
    map.economyObjects = {
        farms: 0,
        barracks: 0,
        goldmines: 0,
        towns: 2,
        productionActions: 0,
        resources: 180,
        units: 0,
        towers: 0,
        bastions: 0,
        lakes: 0,
        mountains: 0,
        bushes: 0
    }
    return map
}

function generateAdvancedEconomyStage2TrainingMap(options) {
    options = options || {}
    let seed = options.seed || 1
    let mapSize = {x: 5, y: 5}
    let lane = ((Number(seed) || 1) % 3) + 1
    let redTown = {x: lane, y: 1}
    let blueTown = {x: lane, y: 3}
    let generatedPlayers = [
        {
            rgb: {r: 208, g: 208, b: 208},
            towns: []
        },
        {
            rgb: trainingPlayerColor(1),
            playerType: 'AIPlayerWithEconomy',
            ai: true,
            gold: 90,
            towns: [redTown],
            units: []
        },
        {
            rgb: trainingPlayerColor(2),
            playerType: 'SimpleAiPlayerWithEconomy',
            ai: true,
            gold: 90,
            towns: [blueTown],
            units: []
        }
    ]
    let map = new GameMap(
        mapSize,
        generatedPlayers,
        [],
        [],
        [])
    map.testName = 'advanced-economy-stage-2-' + seed
    map.suddenDeathRound = options.suddenDeathRound || 50
    map.economyStage = 'advanced-2'
    map.advancedEconomyStage = 2
    map.economyGenerator = {
        stage: 'advanced-2',
        seed: seed,
        playerOne: 'AIPlayerWithEconomy',
        playerTwo: 'SimpleAiPlayerWithEconomy',
        mapSize: mapSize,
        townLayout: 'vertical-mirror',
        townLane: lane,
        townCount: 2,
        emptyMap: true
    }
    map.economyObjects = {
        farms: 0,
        barracks: 0,
        goldmines: 0,
        towns: 2,
        productionActions: 0,
        resources: 180,
        units: 0,
        towers: 0,
        bastions: 0,
        lakes: 0,
        mountains: 0,
        bushes: 0
    }
    return map
}

function generateAdvancedEconomyStage3TrainingMap(options) {
    options = options || {}
    let seed = options.seed || 1
    let mapSize = {x: 5, y: 5}
    let lane = ((Number(seed) || 1) % 3) + 1
    let redTown = {x: lane, y: 1}
    let blueTown = {x: lane, y: 3}
    let goldmineIncomeOptions = [10, 25, 50, 100]
    let goldmineIncome = goldmineIncomeOptions[
        ((Number(seed) || 1) * 17 + 3) % goldmineIncomeOptions.length]
    let mineLane = ((Number(seed) || 1) * 31 + 7) % mapSize.x
    let goldmines = [
        {x: mineLane, y: 0, income: goldmineIncome, owner: 0},
        {x: mineLane, y: 4, income: goldmineIncome, owner: 0}
    ]
    let generatedPlayers = [
        {
            rgb: {r: 208, g: 208, b: 208},
            towns: []
        },
        {
            rgb: trainingPlayerColor(1),
            playerType: 'AIPlayerWithEconomy',
            ai: true,
            gold: 90,
            towns: [redTown],
            units: []
        },
        {
            rgb: trainingPlayerColor(2),
            playerType: 'SimpleAiPlayerWithEconomy',
            ai: true,
            gold: 90,
            towns: [blueTown],
            units: []
        }
    ]
    let map = new GameMap(
        mapSize,
        generatedPlayers,
        goldmines,
        [],
        [])
    map.testName = 'advanced-economy-stage-3-' + seed
    map.suddenDeathRound = options.suddenDeathRound || 50
    map.economyStage = 'advanced-3'
    map.advancedEconomyStage = 3
    map.economyGenerator = {
        stage: 'advanced-3',
        seed: seed,
        playerOne: 'AIPlayerWithEconomy',
        playerTwo: 'SimpleAiPlayerWithEconomy',
        mapSize: mapSize,
        townLayout: 'vertical-mirror',
        townLane: lane,
        townCount: 2,
        goldmineCount: goldmines.length,
        goldmineLane: mineLane,
        goldmineIncomeOptions: goldmineIncomeOptions,
        goldmineIncome: goldmineIncome,
        goldmineOwnership: 'neutral',
        goldmineSymmetry: {
            axis: 'horizontal',
            mirror: 'y',
            fairForBothSides: true
        }
    }
    map.economyObjects = {
        farms: 0,
        barracks: 0,
        goldmines: goldmines.length,
        towns: 2,
        productionActions: 0,
        resources: 180,
        units: 0,
        towers: 0,
        bastions: 0,
        lakes: 0,
        mountains: 0,
        bushes: 0
    }
    return map
}

function generateAdvancedEconomyStage4TrainingMap(options) {
    options = options || {}
    let seed = options.seed || 1
    let rng = createSeededRandom(seed)
    let mapSize = {x: 5, y: 5}
    let lane = ((Number(seed) || 1) % 3) + 1
    let redTown = {x: lane, y: 1}
    let blueTown = {x: lane, y: 3}
    let suburbCandidatePairs = [
        {
            red: {x: lane, y: 0},
            blue: {x: lane, y: 4}
        },
        {
            red: {x: Math.max(0, lane - 1), y: 1},
            blue: {x: Math.max(0, lane - 1), y: 3}
        },
        {
            red: {x: Math.min(mapSize.x - 1, lane + 1), y: 1},
            blue: {x: Math.min(mapSize.x - 1, lane + 1), y: 3}
        },
        {
            red: {x: Math.min(mapSize.x - 1, lane + 1), y: 0},
            blue: {x: Math.max(0, lane - 1), y: 4}
        }
    ]
    let redCells = [redTown]
    let blueCells = [blueTown]
    let capturedPairs = []
    for (let i = 0; i < suburbCandidatePairs.length; ++i) {
        if (rng() >= 0.55) {
            continue
        }
        let redCoord = suburbCandidatePairs[i].red
        let blueCoord = suburbCandidatePairs[i].blue
        redCells.push(redCoord)
        blueCells.push(blueCoord)
        capturedPairs.push({
            red: redCoord,
            blue: blueCoord
        })
    }
    if (capturedPairs.length == 0) {
        let fallbackIndex = Math.floor(rng() * suburbCandidatePairs.length)
        let redCoord = suburbCandidatePairs[fallbackIndex].red
        let blueCoord = suburbCandidatePairs[fallbackIndex].blue
        redCells.push(redCoord)
        blueCells.push(blueCoord)
        capturedPairs.push({
            red: redCoord,
            blue: blueCoord
        })
    }
    let redExpansionCells = [
        {x: Math.max(0, lane - 1), y: 2},
        {x: Math.min(mapSize.x - 1, lane + 1), y: 2}
    ]
    let blueExpansionCells = redExpansionCells.map(function(coord) {
        return {x: coord.x, y: mapSize.y - 1 - coord.y}
    })
    let generatedPlayers = [
        {
            rgb: {r: 208, g: 208, b: 208},
            towns: []
        },
        {
            rgb: trainingPlayerColor(1),
            playerType: 'AIPlayerWithEconomy',
            ai: true,
            gold: 90,
            towns: [redTown],
            units: [],
            suburbs: [{
                town: redTown,
                cells: redCells,
                expansionCells: redExpansionCells
            }]
        },
        {
            rgb: trainingPlayerColor(2),
            playerType: 'SimpleAiPlayerWithEconomy',
            ai: true,
            gold: 90,
            towns: [blueTown],
            units: [],
            suburbs: [{
                town: blueTown,
                cells: blueCells,
                expansionCells: blueExpansionCells
            }]
        }
    ]
    let map = new GameMap(
        mapSize,
        generatedPlayers,
        [],
        [],
        [])
    map.testName = 'advanced-economy-stage-4-' + seed
    map.suddenDeathRound = options.suddenDeathRound || 50
    map.economyStage = 'advanced-4'
    map.advancedEconomyStage = 4
    map.economyGenerator = {
        stage: 'advanced-4',
        seed: seed,
        playerOne: 'AIPlayerWithEconomy',
        playerTwo: 'SimpleAiPlayerWithEconomy',
        mapSize: mapSize,
        townLayout: 'vertical-mirror',
        townLane: lane,
        townCount: 2,
        capturedSuburbPairs: capturedPairs,
        capturedSuburbCountPerPlayer: capturedPairs.length,
        suburbSymmetry: {
            axis: 'horizontal',
            mirror: 'y',
            fairForBothSides: true
        }
    }
    map.economyObjects = {
        farms: 0,
        barracks: 0,
        goldmines: 0,
        towns: 2,
        productionActions: 0,
        resources: 180,
        units: 0,
        towers: 0,
        bastions: 0,
        lakes: 0,
        mountains: 0,
        bushes: 0,
        capturedSuburbs: capturedPairs.length * 2
    }
    return map
}

function generateAdvancedEconomyStage5TrainingMap(options) {
    options = options || {}
    let seed = options.seed || 1
    let rng = createSeededRandom((Number(seed) || 1) ^ 0x5a5a5a5a)
    let map = generateAdvancedEconomyStage4TrainingMap(options)
    let barrackDensity = options.barrackDensity
    if (barrackDensity === undefined) {
        barrackDensity = 0.65
    }
    let barrackPairs = []
    let used = {}
    for (let playerIndex = 1; playerIndex <= 2; ++playerIndex) {
        for (let i = 0; i < map.players[playerIndex].towns.length; ++i) {
            markCoordKey(used, map.players[playerIndex].towns[i])
        }
    }
    function addBarrackForPlayer(playerIndex) {
        let player = map.players[playerIndex]
        let layout = player.suburbs[0]
        let townKey = coordKey(layout.town)
        let candidates = []
        for (let i = 0; i < layout.cells.length; ++i) {
            let cell = layout.cells[i]
            if (coordKey(cell) != townKey && !hasCoordKey(used, cell)) {
                candidates.push(cell)
            }
        }
        let selected = []
        for (let i = 0; i < candidates.length; ++i) {
            if (rng() < barrackDensity) {
                selected.push(candidates[i])
            }
        }
        if (selected.length == 0 && candidates.length > 0 && barrackDensity > 0) {
            selected.push(candidates[Math.floor(rng() * candidates.length)])
        }
        player.barracks = []
        for (let i = 0; i < selected.length; ++i) {
            let coord = selected[i]
            markCoordKey(used, coord)
            player.barracks.push({
                x: coord.x,
                y: coord.y,
                town: {x: layout.town.x, y: layout.town.y}
            })
        }
    }
    addBarrackForPlayer(1)
    addBarrackForPlayer(2)
    let redBarracks = map.players[1].barracks || []
    let blueBarracks = map.players[2].barracks || []
    for (let i = 0; i < Math.min(redBarracks.length, blueBarracks.length); ++i) {
        barrackPairs.push({
            red: {x: redBarracks[i].x, y: redBarracks[i].y},
            blue: {x: blueBarracks[i].x, y: blueBarracks[i].y}
        })
    }
    map.testName = 'advanced-economy-stage-5-' + seed
    map.economyStage = 'advanced-5'
    map.advancedEconomyStage = 5
    map.economyGenerator.stage = 'advanced-5'
    map.economyGenerator.barrackDensity = barrackDensity
    map.economyGenerator.barrackPairs = barrackPairs
    map.economyGenerator.barrackCountPerPlayer = {
        red: redBarracks.length,
        blue: blueBarracks.length
    }
    map.economyGenerator.stage4RequirementsPreserved = true
    map.economyObjects.barracks = redBarracks.length + blueBarracks.length
    map.economyObjects.productionActions = map.economyObjects.barracks
    return map
}

function advancedEconomyStage4SuburbCandidatePairs(map) {
    let mapSize = {x: 5, y: 5}
    let lane = map.economyGenerator && map.economyGenerator.townLane !== undefined ?
        map.economyGenerator.townLane : 2
    return [
        {
            red: {x: lane, y: 0},
            blue: {x: lane, y: 4}
        },
        {
            red: {x: Math.max(0, lane - 1), y: 1},
            blue: {x: Math.max(0, lane - 1), y: 3}
        },
        {
            red: {x: Math.min(mapSize.x - 1, lane + 1), y: 1},
            blue: {x: Math.min(mapSize.x - 1, lane + 1), y: 3}
        },
        {
            red: {x: Math.min(mapSize.x - 1, lane + 1), y: 0},
            blue: {x: Math.max(0, lane - 1), y: 4}
        }
    ]
}

function generateAdvancedEconomyStage6TrainingMap(options) {
    options = options || {}
    let seed = options.seed || 1
    let stage5Options = Object.assign({barrackDensity: 0.5}, options)
    let rng = createSeededRandom((Number(seed) || 1) ^ 0x6b6b6b6b)
    let map = generateAdvancedEconomyStage5TrainingMap(stage5Options)
    let farmDensity = options.farmDensity
    if (farmDensity === undefined) {
        farmDensity = 0.65
    }

    let candidatePairs = advancedEconomyStage4SuburbCandidatePairs(map)
    function addCapturedPairIfNeeded() {
        let redLayout = map.players[1].suburbs[0]
        let blueLayout = map.players[2].suburbs[0]
        let redExisting = {}
        let blueExisting = {}
        for (let i = 0; i < redLayout.cells.length; ++i) {
            markCoordKey(redExisting, redLayout.cells[i])
        }
        for (let i = 0; i < blueLayout.cells.length; ++i) {
            markCoordKey(blueExisting, blueLayout.cells[i])
        }
        for (let i = 0; i < candidatePairs.length; ++i) {
            let pair = candidatePairs[i]
            if (!hasCoordKey(redExisting, pair.red) && !hasCoordKey(blueExisting, pair.blue)) {
                redLayout.cells.push({x: pair.red.x, y: pair.red.y})
                blueLayout.cells.push({x: pair.blue.x, y: pair.blue.y})
                map.economyGenerator.capturedSuburbPairs.push({
                    red: {x: pair.red.x, y: pair.red.y},
                    blue: {x: pair.blue.x, y: pair.blue.y}
                })
                map.economyGenerator.capturedSuburbCountPerPlayer =
                    map.economyGenerator.capturedSuburbPairs.length
                map.economyObjects.capturedSuburbs =
                    map.economyGenerator.capturedSuburbPairs.length * 2
                return true
            }
        }
        return false
    }

    function nonTownSuburbCells(playerIndex) {
        let player = map.players[playerIndex]
        let layout = player.suburbs[0]
        let townKey = coordKey(layout.town)
        let cells = []
        for (let i = 0; i < layout.cells.length; ++i) {
            if (coordKey(layout.cells[i]) != townKey) {
                cells.push(layout.cells[i])
            }
        }
        return cells
    }

    function trimBarracksForFarmSpace(playerIndex) {
        let player = map.players[playerIndex]
        player.barracks = player.barracks || []
        while (nonTownSuburbCells(playerIndex).length <= player.barracks.length) {
            if (addCapturedPairIfNeeded()) {
                continue
            }
            if (player.barracks.length <= 1) {
                break
            }
            player.barracks.pop()
        }
    }

    trimBarracksForFarmSpace(1)
    trimBarracksForFarmSpace(2)

    let used = {}
    for (let playerIndex = 1; playerIndex <= 2; ++playerIndex) {
        let player = map.players[playerIndex]
        for (let i = 0; i < player.towns.length; ++i) {
            markCoordKey(used, player.towns[i])
        }
        for (let i = 0; i < (player.barracks || []).length; ++i) {
            markCoordKey(used, player.barracks[i])
        }
    }

    function addFarmsForPlayer(playerIndex) {
        let player = map.players[playerIndex]
        let layout = player.suburbs[0]
        let townKey = coordKey(layout.town)
        let candidates = []
        for (let i = 0; i < layout.cells.length; ++i) {
            let cell = layout.cells[i]
            if (coordKey(cell) != townKey && !hasCoordKey(used, cell)) {
                candidates.push(cell)
            }
        }
        let selected = []
        for (let i = 0; i < candidates.length; ++i) {
            if (rng() < farmDensity) {
                selected.push(candidates[i])
            }
        }
        if (selected.length == 0 && candidates.length > 0 && farmDensity > 0) {
            selected.push(candidates[Math.floor(rng() * candidates.length)])
        }
        player.farms = []
        for (let i = 0; i < selected.length; ++i) {
            let coord = selected[i]
            markCoordKey(used, coord)
            player.farms.push({
                x: coord.x,
                y: coord.y,
                town: {x: layout.town.x, y: layout.town.y}
            })
        }
    }

    addFarmsForPlayer(1)
    addFarmsForPlayer(2)

    let redBarracks = map.players[1].barracks || []
    let blueBarracks = map.players[2].barracks || []
    let redFarms = map.players[1].farms || []
    let blueFarms = map.players[2].farms || []
    let farmPairs = []
    for (let i = 0; i < Math.min(redFarms.length, blueFarms.length); ++i) {
        farmPairs.push({
            red: {x: redFarms[i].x, y: redFarms[i].y},
            blue: {x: blueFarms[i].x, y: blueFarms[i].y}
        })
    }

    map.testName = 'advanced-economy-stage-6-' + seed
    map.economyStage = 'advanced-6'
    map.advancedEconomyStage = 6
    map.economyGenerator.stage = 'advanced-6'
    map.economyGenerator.farmDensity = farmDensity
    map.economyGenerator.farmPairs = farmPairs
    map.economyGenerator.farmCountPerPlayer = {
        red: redFarms.length,
        blue: blueFarms.length
    }
    map.economyGenerator.barrackCountPerPlayer = {
        red: redBarracks.length,
        blue: blueBarracks.length
    }
    map.economyGenerator.stage5RequirementsPreserved = true
    map.economyObjects.farms = redFarms.length + blueFarms.length
    map.economyObjects.barracks = redBarracks.length + blueBarracks.length
    map.economyObjects.productionActions =
        map.economyObjects.farms + map.economyObjects.barracks
    return map
}

function advancedEconomyStage7SuburbCandidatePairs(mapSize, town) {
    let candidates = []
    for (let y = 0; y < mapSize.y; ++y) {
        for (let x = 0; x < mapSize.x; ++x) {
            let coord = {x: x, y: y}
            if (coordKey(coord) == coordKey(town) || townDistance(coord, town) > 2 || y >= 4) {
                continue
            }
            candidates.push({
                red: coord,
                blue: {x: town.x * 2 - x, y: mapSize.y - 1 - y}
            })
        }
    }
    candidates.sort(function(a, b) {
        return townDistance(a.red, town) - townDistance(b.red, town) ||
            a.red.y - b.red.y ||
            a.red.x - b.red.x
    })
    return candidates
}

function connectedSuburbExpansionCells(mapSize, claimed) {
    let expansionCells = []
    let expansionSeen = {}
    let claimedCells = Object.keys(claimed).map(function(key) {
        let parts = key.split(':')
        return {x: Number(parts[0]), y: Number(parts[1])}
    })
    for (let i = 0; i < claimedCells.length; ++i) {
        let neighbours = townNeighbourCoords(claimedCells[i])
        for (let j = 0; j < neighbours.length; ++j) {
            let coord = neighbours[j]
            let key = coordKey(coord)
            if (!isCoordInsideMap(coord, mapSize) || claimed[key] || expansionSeen[key]) {
                continue
            }
            expansionSeen[key] = true
            expansionCells.push(coord)
        }
    }
    return expansionCells
}

function generateAdvancedEconomyStage7TrainingMap(options) {
    options = options || {}
    let seed = options.seed || 1
    let rng = createSeededRandom(seed)
    let mapSize = {x: 9, y: 9}
    let lane = ((Number(seed) || 1) % 5) + 2
    let redTown = {x: lane, y: 2}
    let blueTown = {x: lane, y: 6}
    let candidatePairs = advancedEconomyStage7SuburbCandidatePairs(mapSize, redTown)
    let redCells = [redTown]
    let blueCells = [blueTown]
    let redClaimed = {}
    let blueClaimed = {}
    let capturedPairs = []
    markCoordKey(redClaimed, redTown)
    markCoordKey(blueClaimed, blueTown)

    for (let i = 0; i < candidatePairs.length; ++i) {
        let pair = candidatePairs[i]
        let redDistance = townDistance(pair.red, redTown)
        if (redDistance > 1 && !redCells.some(function(cell) {
            return townDistance(cell, pair.red) == 1
        })) {
            continue
        }
        if (rng() >= 0.48) {
            continue
        }
        if (hasCoordKey(redClaimed, pair.red) || hasCoordKey(blueClaimed, pair.blue)) {
            continue
        }
        redCells.push(pair.red)
        blueCells.push(pair.blue)
        markCoordKey(redClaimed, pair.red)
        markCoordKey(blueClaimed, pair.blue)
        capturedPairs.push({
            red: pair.red,
            blue: pair.blue
        })
    }

    if (capturedPairs.length == 0) {
        let fallbackCandidates = candidatePairs.filter(function(pair) {
            return townDistance(pair.red, redTown) == 1
        })
        let fallback = fallbackCandidates[randomIntWithRng(rng, 0, fallbackCandidates.length - 1)]
        redCells.push(fallback.red)
        blueCells.push(fallback.blue)
        markCoordKey(redClaimed, fallback.red)
        markCoordKey(blueClaimed, fallback.blue)
        capturedPairs.push({
            red: fallback.red,
            blue: fallback.blue
        })
    }

    let generatedPlayers = [
        {
            rgb: {r: 208, g: 208, b: 208},
            towns: []
        },
        {
            rgb: trainingPlayerColor(1),
            playerType: 'AIPlayerWithEconomy',
            ai: true,
            gold: 90,
            towns: [redTown],
            units: [],
            suburbs: [{
                town: redTown,
                cells: redCells,
                expansionCells: connectedSuburbExpansionCells(mapSize, redClaimed)
            }]
        },
        {
            rgb: trainingPlayerColor(2),
            playerType: 'SimpleAiPlayerWithEconomy',
            ai: true,
            gold: 90,
            towns: [blueTown],
            units: [],
            suburbs: [{
                town: blueTown,
                cells: blueCells,
                expansionCells: connectedSuburbExpansionCells(mapSize, blueClaimed)
            }]
        }
    ]
    let map = new GameMap(
        mapSize,
        generatedPlayers,
        [],
        [],
        [])
    map.testName = 'advanced-economy-stage-7-' + seed
    map.suddenDeathRound = options.suddenDeathRound || 60
    map.economyStage = 'advanced-7'
    map.advancedEconomyStage = 7
    map.economyGenerator = {
        stage: 'advanced-7',
        seed: seed,
        playerOne: 'AIPlayerWithEconomy',
        playerTwo: 'SimpleAiPlayerWithEconomy',
        mapSize: mapSize,
        townLayout: 'rotated-mirror',
        townLane: lane,
        townCount: 2,
        capturedSuburbPairs: capturedPairs,
        capturedSuburbCountPerPlayer: capturedPairs.length,
        suburbSymmetry: {
            axis: 'town-center',
            mirror: 'rotate-180',
            fairForBothSides: true
        },
        mapExpansion: '9x9'
    }
    map.economyObjects = {
        farms: 0,
        barracks: 0,
        goldmines: 0,
        towns: 2,
        productionActions: 0,
        resources: 180,
        units: 0,
        towers: 0,
        bastions: 0,
        lakes: 0,
        mountains: 0,
        bushes: 0,
        capturedSuburbs: capturedPairs.length * 2
    }
    return map
}

function generateAdvancedEconomyStage8TrainingMap(options) {
    options = options || {}
    let seed = options.seed || 1
    let rng = createSeededRandom(seed * 17 + 8)
    let farmDensity = options.farmDensity
    if (farmDensity === undefined) {
        farmDensity = 0.55
    }
    let map = generateAdvancedEconomyStage7TrainingMap(options)
    let farmPairs = []
    let candidatePairs = map.economyGenerator.capturedSuburbPairs || []

    for (let i = 0; i < candidatePairs.length; ++i) {
        if (rng() < farmDensity) {
            farmPairs.push(candidatePairs[i])
        }
    }
    if (farmPairs.length == 0 && candidatePairs.length > 0 && farmDensity > 0) {
        farmPairs.push(candidatePairs[randomIntWithRng(rng, 0, candidatePairs.length - 1)])
    }

    map.players[1].farms = []
    map.players[2].farms = []
    for (let i = 0; i < farmPairs.length; ++i) {
        let pair = farmPairs[i]
        map.players[1].farms.push({
            x: pair.red.x,
            y: pair.red.y,
            town: {
                x: map.players[1].towns[0].x,
                y: map.players[1].towns[0].y
            }
        })
        map.players[2].farms.push({
            x: pair.blue.x,
            y: pair.blue.y,
            town: {
                x: map.players[2].towns[0].x,
                y: map.players[2].towns[0].y
            }
        })
    }

    map.testName = 'advanced-economy-stage-8-' + seed
    map.economyStage = 'advanced-8'
    map.advancedEconomyStage = 8
    map.economyGenerator.stage = 'advanced-8'
    map.economyGenerator.farmDensity = farmDensity
    map.economyGenerator.farmPairs = farmPairs.map(function(pair) {
        return {
            red: {x: pair.red.x, y: pair.red.y},
            blue: {x: pair.blue.x, y: pair.blue.y}
        }
    })
    map.economyGenerator.farmCountPerPlayer = farmPairs.length
    map.economyGenerator.stage7RequirementsPreserved = true
    map.economyObjects.farms = farmPairs.length * 2
    map.economyObjects.productionActions = map.economyObjects.farms
    return map
}

function ensureAdvancedEconomyStageCapturedPairs(map, minPairs) {
    let redTown = map.players[1].towns[0]
    let blueTown = map.players[2].towns[0]
    let redLayout = map.players[1].suburbs[0]
    let blueLayout = map.players[2].suburbs[0]
    let redClaimed = {}
    let blueClaimed = {}
    for (let i = 0; i < redLayout.cells.length; ++i) {
        markCoordKey(redClaimed, redLayout.cells[i])
    }
    for (let i = 0; i < blueLayout.cells.length; ++i) {
        markCoordKey(blueClaimed, blueLayout.cells[i])
    }
    let candidatePairs = advancedEconomyStage7SuburbCandidatePairs(map.mapSize, redTown)
    let capturedPairs = map.economyGenerator.capturedSuburbPairs || []

    function hasConnectedNeighbour(coord, claimed) {
        let neighbours = townNeighbourCoords(coord)
        for (let i = 0; i < neighbours.length; ++i) {
            if (claimed[coordKey(neighbours[i])]) {
                return true
            }
        }
        return false
    }

    for (let i = 0; capturedPairs.length < minPairs && i < candidatePairs.length; ++i) {
        let pair = candidatePairs[i]
        if (hasCoordKey(redClaimed, pair.red) || hasCoordKey(blueClaimed, pair.blue) ||
            !hasConnectedNeighbour(pair.red, redClaimed) ||
            !hasConnectedNeighbour(pair.blue, blueClaimed)) {
            continue
        }
        let redCoord = {x: pair.red.x, y: pair.red.y}
        let blueCoord = {x: pair.blue.x, y: pair.blue.y}
        redLayout.cells.push(redCoord)
        blueLayout.cells.push(blueCoord)
        markCoordKey(redClaimed, redCoord)
        markCoordKey(blueClaimed, blueCoord)
        capturedPairs.push({
            red: redCoord,
            blue: blueCoord
        })
    }

    redLayout.expansionCells = connectedSuburbExpansionCells(map.mapSize, redClaimed)
    blueLayout.expansionCells = connectedSuburbExpansionCells(map.mapSize, blueClaimed)
    map.economyGenerator.capturedSuburbPairs = capturedPairs
    map.economyGenerator.capturedSuburbCountPerPlayer = capturedPairs.length
    map.economyObjects.capturedSuburbs = capturedPairs.length * 2
}

function selectAdvancedEconomyStagePairs(rng, candidatePairs, density, minimum, excluded) {
    let selected = []
    for (let i = 0; i < candidatePairs.length; ++i) {
        let pair = candidatePairs[i]
        if (excluded && (excluded[coordKey(pair.red)] || excluded[coordKey(pair.blue)])) {
            continue
        }
        if (rng() < density) {
            selected.push(pair)
        }
    }
    if (selected.length < minimum) {
        for (let i = 0; selected.length < minimum && i < candidatePairs.length; ++i) {
            let pair = candidatePairs[i]
            if (excluded && (excluded[coordKey(pair.red)] || excluded[coordKey(pair.blue)])) {
                continue
            }
            if (!selected.some(function(existing) {
                return coordKey(existing.red) == coordKey(pair.red) ||
                    coordKey(existing.blue) == coordKey(pair.blue)
            })) {
                selected.push(pair)
            }
        }
    }
    return selected
}

function addAdvancedEconomyStagePairBuildings(map, pairs, field) {
    map.players[1][field] = []
    map.players[2][field] = []
    for (let i = 0; i < pairs.length; ++i) {
        let pair = pairs[i]
        map.players[1][field].push({
            x: pair.red.x,
            y: pair.red.y,
            town: {
                x: map.players[1].towns[0].x,
                y: map.players[1].towns[0].y
            }
        })
        map.players[2][field].push({
            x: pair.blue.x,
            y: pair.blue.y,
            town: {
                x: map.players[2].towns[0].x,
                y: map.players[2].towns[0].y
            }
        })
    }
}

function generateAdvancedEconomyStage9TrainingMap(options) {
    options = options || {}
    let seed = options.seed || 1
    let rng = createSeededRandom(seed * 19 + 9)
    let farmDensity = options.farmDensity
    if (farmDensity === undefined) {
        farmDensity = 0.45
    }
    let barrackDensity = options.barrackDensity
    if (barrackDensity === undefined) {
        barrackDensity = 0.55
    }
    farmDensity = clampProbability(farmDensity, 0.45)
    barrackDensity = clampProbability(barrackDensity, 0.55)

    let map = generateAdvancedEconomyStage7TrainingMap(options)
    ensureAdvancedEconomyStageCapturedPairs(map, 2)
    let candidatePairs = map.economyGenerator.capturedSuburbPairs || []
    let farmPairs = selectAdvancedEconomyStagePairs(rng, candidatePairs, farmDensity, 1)
    if (farmPairs.length >= candidatePairs.length && candidatePairs.length > 1) {
        farmPairs = farmPairs.slice(0, candidatePairs.length - 1)
    }
    let farmOccupied = {}
    for (let i = 0; i < farmPairs.length; ++i) {
        markCoordKey(farmOccupied, farmPairs[i].red)
        markCoordKey(farmOccupied, farmPairs[i].blue)
    }
    let barrackPairs = selectAdvancedEconomyStagePairs(
        rng, candidatePairs, barrackDensity, 1, farmOccupied)

    addAdvancedEconomyStagePairBuildings(map, farmPairs, 'farms')
    addAdvancedEconomyStagePairBuildings(map, barrackPairs, 'barracks')

    map.testName = 'advanced-economy-stage-9-' + seed
    map.economyStage = 'advanced-9'
    map.advancedEconomyStage = 9
    map.economyGenerator.stage = 'advanced-9'
    map.economyGenerator.farmDensity = farmDensity
    map.economyGenerator.barrackDensity = barrackDensity
    map.economyGenerator.farmPairs = farmPairs.map(function(pair) {
        return {
            red: {x: pair.red.x, y: pair.red.y},
            blue: {x: pair.blue.x, y: pair.blue.y}
        }
    })
    map.economyGenerator.barrackPairs = barrackPairs.map(function(pair) {
        return {
            red: {x: pair.red.x, y: pair.red.y},
            blue: {x: pair.blue.x, y: pair.blue.y}
        }
    })
    map.economyGenerator.farmCountPerPlayer = farmPairs.length
    map.economyGenerator.barrackCountPerPlayer = barrackPairs.length
    map.economyGenerator.stage8RequirementsPreserved = true
    map.economyObjects.farms = farmPairs.length * 2
    map.economyObjects.barracks = barrackPairs.length * 2
    map.economyObjects.productionActions =
        map.economyObjects.farms + map.economyObjects.barracks
    return map
}

function selectableAdvancedEconomyStage10UnitCells(map, occupied) {
    let cells = []
    let redTown = map.players[1].towns[0]
    let candidatePairs = advancedEconomyStage7SuburbCandidatePairs(map.mapSize, redTown)
    for (let i = 0; i < candidatePairs.length; ++i) {
        let pair = candidatePairs[i]
        if (!hasCoordKey(occupied, pair.red) && !hasCoordKey(occupied, pair.blue)) {
            cells.push(pair)
        }
    }
    return cells
}

function addAdvancedEconomyStage10Units(map, options) {
    options = options || {}
    let seed = options.seed || 1
    let rng = createSeededRandom(seed * 23 + 10)
    let unitCountPerPlayer = boundedInteger(options.unitCountPerPlayer, 4, 1, 6)
    let composition = options.unitComposition || 'all'
    let occupied = {}

    for (let playerIndex = 1; playerIndex <= 2; ++playerIndex) {
        for (let i = 0; i < map.players[playerIndex].towns.length; ++i) {
            markCoordKey(occupied, map.players[playerIndex].towns[i])
        }
        for (let i = 0; i < (map.players[playerIndex].farms || []).length; ++i) {
            markCoordKey(occupied, map.players[playerIndex].farms[i])
        }
        for (let i = 0; i < (map.players[playerIndex].barracks || []).length; ++i) {
            markCoordKey(occupied, map.players[playerIndex].barracks[i])
        }
    }

    let candidatePairs = selectableAdvancedEconomyStage10UnitCells(map, occupied)
    let selectedPairs = []
    let offset = candidatePairs.length ? randomIntWithRng(rng, 0, candidatePairs.length - 1) : 0
    for (let i = 0; i < candidatePairs.length && selectedPairs.length < unitCountPerPlayer; ++i) {
        let pair = candidatePairs[(offset + i) % candidatePairs.length]
        selectedPairs.push(pair)
        markCoordKey(occupied, pair.red)
        markCoordKey(occupied, pair.blue)
    }

    let unitTypes = createUnitComposition(rng, selectedPairs.length, composition)
    map.players[1].units = []
    map.players[2].units = []
    let unitTypeCounts = {
        Noob: 0,
        Archer: 0,
        KOHb: 0,
        Normchel: 0,
        Catapult: 0
    }
    for (let i = 0; i < selectedPairs.length; ++i) {
        let type = unitTypes[i]
        map.players[1].units.push({
            type: type,
            x: selectedPairs[i].red.x,
            y: selectedPairs[i].red.y
        })
        map.players[2].units.push({
            type: type,
            x: selectedPairs[i].blue.x,
            y: selectedPairs[i].blue.y
        })
        unitTypeCounts[type.name] += 2
    }

    map.economyGenerator.unitComposition = composition
    map.economyGenerator.unitCountPerPlayer = selectedPairs.length
    map.economyGenerator.unitPairs = selectedPairs.map(function(pair, index) {
        return {
            red: {x: pair.red.x, y: pair.red.y},
            blue: {x: pair.blue.x, y: pair.blue.y},
            type: unitTypes[index].name
        }
    })
    map.economyGenerator.unitTypes = Object.keys(unitTypeCounts).filter(function(name) {
        return unitTypeCounts[name] > 0
    })
    map.economyObjects.units = selectedPairs.length * 2
    map.economyObjects.noobs = unitTypeCounts.Noob
    map.economyObjects.archers = unitTypeCounts.Archer
    map.economyObjects.KOHbs = unitTypeCounts.KOHb
    map.economyObjects.normchels = unitTypeCounts.Normchel
    map.economyObjects.catapults = unitTypeCounts.Catapult
}

function generateAdvancedEconomyStage10TrainingMap(options) {
    options = options || {}
    let seed = options.seed || 1
    let map = generateAdvancedEconomyStage9TrainingMap(options)
    addAdvancedEconomyStage10Units(map, {
        seed: seed,
        unitCountPerPlayer: options.unitCountPerPlayer,
        unitComposition: options.unitComposition
    })

    map.testName = 'advanced-economy-stage-10-' + seed
    map.economyStage = 'advanced-10'
    map.advancedEconomyStage = 10
    map.economyGenerator.stage = 'advanced-10'
    map.economyGenerator.stage9RequirementsPreserved = true
    return map
}

function advancedEconomyStage11MaxHpForUnit(type) {
    let byName = {
        Noob: 2,
        Archer: 1,
        KOHb: 3,
        Normchel: 5,
        Catapult: 1
    }
    return type.maxHP || byName[type.name]
}

function advancedEconomyStage11BuildingMaxHp(field) {
    return {
        towns: 10,
        farms: 1,
        barracks: 1,
        towers: 5,
        bastions: 5
    }[field]
}

function advancedEconomyStage11RandomHp(rng, maxHp) {
    return randomIntWithRng(rng, 1, maxHp)
}

function advancedEconomyStage11RandomCoord(rng, mapSize, used, predicate) {
    return pickCoord(rng, mapSize, used, function(coord) {
        return (!predicate || predicate(coord))
    })
}

function advancedEconomyStage11BuildSuburbLayout(rng, mapSize, town, claimed, occupied) {
    let cells = [{x: town.x, y: town.y}]
    claimed[coordKey(town)] = true
    let neighbours = townNeighbourCoords(town).filter(function(coord) {
        return isCoordInsideMap(coord, mapSize) &&
            !claimed[coordKey(coord)] &&
            !hasCoordKey(occupied, coord)
    })
    let desired = randomIntWithRng(rng, 1, Math.min(4, neighbours.length))
    let offset = neighbours.length ? randomIntWithRng(rng, 0, neighbours.length - 1) : 0
    for (let i = 0; i < neighbours.length && cells.length <= desired; ++i) {
        let coord = neighbours[(offset + i) % neighbours.length]
        if (claimed[coordKey(coord)]) {
            continue
        }
        claimed[coordKey(coord)] = true
        cells.push({x: coord.x, y: coord.y})
    }
    return {
        town: {x: town.x, y: town.y},
        cells: cells,
        expansionCells: connectedSuburbExpansionCells(mapSize, claimed)
    }
}

function advancedEconomyStage11HasFreeNeighbour(coord, mapSize, claimed, occupied) {
    let neighbours = townNeighbourCoords(coord)
    for (let i = 0; i < neighbours.length; ++i) {
        let neighbour = neighbours[i]
        if (isCoordInsideMap(neighbour, mapSize) &&
            !claimed[coordKey(neighbour)] &&
            !hasCoordKey(occupied, neighbour)) {
            return true
        }
    }
    return false
}

function advancedEconomyStage11OwnedBuildCells(player) {
    let cells = []
    let townKeys = {}
    for (let i = 0; i < player.towns.length; ++i) {
        townKeys[coordKey(player.towns[i])] = true
    }
    for (let layoutIndex = 0; layoutIndex < (player.suburbs || []).length; ++layoutIndex) {
        let layout = player.suburbs[layoutIndex]
        for (let cellIndex = 0; cellIndex < layout.cells.length; ++cellIndex) {
            let cell = layout.cells[cellIndex]
            if (!townKeys[coordKey(cell)]) {
                cells.push({
                    x: cell.x,
                    y: cell.y,
                    town: {x: layout.town.x, y: layout.town.y}
                })
            }
        }
    }
    return cells
}

function generateAdvancedEconomyStage11TrainingMap(options) {
    options = options || {}
    let seed = options.seed || 1
    let rng = createSeededRandom(seed * 29 + 11)
    let mapSize = {x: 9, y: 9}
    let usedObjects = {}
    let claimed = {}
    let unitTypes = [Noob, Archer, KOHb, Normchel, Catapult]
    let playersConfig = [
        {
            rgb: {r: 208, g: 208, b: 208},
            towns: []
        }
    ]
    let summary = {
        towns: 0,
        units: 0,
        farms: 0,
        barracks: 0,
        towers: 0,
        bastions: 0,
        capturedSuburbs: 0
    }
    let playerTownCounts = {}

    for (let playerIndex = 1; playerIndex <= 2; ++playerIndex) {
        let townCount = randomIntWithRng(rng, 0, 3)
        let player = {
            rgb: trainingPlayerColor(playerIndex),
            playerType: playerIndex == 1 ? 'AIPlayerWithEconomy' : 'SimpleAiPlayerWithEconomy',
            ai: true,
            gold: randomIntWithRng(rng, 70, 130),
            towns: [],
            units: [],
            suburbs: [],
            farms: [],
            barracks: [],
            towers: [],
            bastions: []
        }
        playerTownCounts[playerIndex] = townCount

        for (let i = 0; i < townCount; ++i) {
            let town = advancedEconomyStage11RandomCoord(
                rng,
                mapSize,
                usedObjects,
                function(coord) {
                    return coord.x > 0 && coord.y > 0 &&
                        coord.x < mapSize.x - 1 && coord.y < mapSize.y - 1 &&
                        !claimed[coordKey(coord)] &&
                        advancedEconomyStage11HasFreeNeighbour(
                            coord, mapSize, claimed, usedObjects)
                })
            town.hp = advancedEconomyStage11RandomHp(
                rng, advancedEconomyStage11BuildingMaxHp('towns'))
            player.towns.push(town)
            summary.towns += 1
            let layout = advancedEconomyStage11BuildSuburbLayout(
                rng, mapSize, town, claimed, usedObjects)
            player.suburbs.push(layout)
            summary.capturedSuburbs += layout.cells.length
        }

        let buildCells = advancedEconomyStage11OwnedBuildCells(player)
        let offset = buildCells.length ? randomIntWithRng(rng, 0, buildCells.length - 1) : 0
        for (let i = 0; i < buildCells.length; ++i) {
            let cell = buildCells[(offset + i) % buildCells.length]
            if (hasCoordKey(usedObjects, cell) || rng() >= 0.5) {
                continue
            }
            let field = rng() < 0.5 ? 'farms' : 'barracks'
            let building = {
                x: cell.x,
                y: cell.y,
                town: {x: cell.town.x, y: cell.town.y},
                hp: advancedEconomyStage11RandomHp(
                    rng, advancedEconomyStage11BuildingMaxHp(field))
            }
            player[field].push(building)
            markCoordKey(usedObjects, cell)
            summary[field] += 1
        }

        for (let i = 0; i < buildCells.length; ++i) {
            let cell = buildCells[(offset + i) % buildCells.length]
            if (hasCoordKey(usedObjects, cell) || rng() >= 0.45) {
                continue
            }
            let field = rng() < 0.5 ? 'towers' : 'bastions'
            let building = {
                x: cell.x,
                y: cell.y,
                hp: advancedEconomyStage11RandomHp(
                    rng, advancedEconomyStage11BuildingMaxHp(field))
            }
            player[field].push(building)
            markCoordKey(usedObjects, cell)
            summary[field] += 1
        }

        let unitCount = randomIntWithRng(rng, 1, 5)
        for (let i = 0; i < unitCount; ++i) {
            let coord = advancedEconomyStage11RandomCoord(rng, mapSize, usedObjects)
            let type = unitTypes[randomIntWithRng(rng, 0, unitTypes.length - 1)]
            player.units.push({
                type: type,
                x: coord.x,
                y: coord.y,
                hp: advancedEconomyStage11RandomHp(
                    rng, advancedEconomyStage11MaxHpForUnit(type))
            })
            summary.units += 1
        }

        playersConfig.push(player)
    }

    let map = new GameMap(
        mapSize,
        playersConfig,
        [],
        [],
        [])
    map.testName = 'advanced-economy-stage-11-' + seed
    map.suddenDeathRound = options.suddenDeathRound || 60
    map.economyStage = 'advanced-11'
    map.advancedEconomyStage = 11
    map.economyGenerator = {
        stage: 'advanced-11',
        seed: seed,
        playerOne: 'AIPlayerWithEconomy',
        playerTwo: 'SimpleAiPlayerWithEconomy',
        mapSize: mapSize,
        townCounts: playerTownCounts,
        randomHp: true,
        randomUnits: true,
        randomBuildings: true,
        capturedCells: true,
        stage10RequirementsExtended: true
    }
    map.economyObjects = {
        farms: summary.farms,
        barracks: summary.barracks,
        goldmines: 0,
        towns: summary.towns,
        productionActions: summary.farms + summary.barracks,
        resources: playersConfig[1].gold + playersConfig[2].gold,
        units: summary.units,
        towers: summary.towers,
        bastions: summary.bastions,
        lakes: 0,
        mountains: 0,
        bushes: 0,
        capturedSuburbs: summary.capturedSuburbs
    }
    return map
}

function advancedEconomyStage12MirrorCoord(coord, mapSize) {
    return mirrorXCoord(coord, mapSize)
}

function advancedEconomyStage12SymmetricCoordPair(rng, mapSize, used, predicate) {
    function isValid(left) {
        let right = advancedEconomyStage12MirrorCoord(left, mapSize)
        return coordKey(left) != coordKey(right) &&
            !hasCoordKey(used, left) &&
            !hasCoordKey(used, right) &&
            (!predicate || predicate(left, right))
    }

    for (let attempts = 0; attempts < 1000; ++attempts) {
        let left = {
            x: randomIntWithRng(rng, 0, Math.floor(mapSize.x / 2) - 1),
            y: randomIntWithRng(rng, 0, mapSize.y - 1)
        }
        if (isValid(left)) {
            let right = advancedEconomyStage12MirrorCoord(left, mapSize)
            markCoordKey(used, left)
            markCoordKey(used, right)
            return {
                left: left,
                right: right
            }
        }
    }

    let leftHalfWidth = Math.floor(mapSize.x / 2)
    let start = randomIntWithRng(rng, 0, leftHalfWidth * mapSize.y - 1)
    for (let offset = 0; offset < leftHalfWidth * mapSize.y; ++offset) {
        let index = (start + offset) % (leftHalfWidth * mapSize.y)
        let left = {
            x: index % leftHalfWidth,
            y: Math.floor(index / leftHalfWidth)
        }
        if (isValid(left)) {
            let right = advancedEconomyStage12MirrorCoord(left, mapSize)
            markCoordKey(used, left)
            markCoordKey(used, right)
            return {
                left: left,
                right: right
            }
        }
    }
    throw new Error('Unable to place symmetrical advanced economy object')
}

function advancedEconomyStage12FreeNeighbourPairs(town, mapSize, claimed, occupied) {
    let candidates = []
    let neighbours = townNeighbourCoords(town)
    for (let i = 0; i < neighbours.length; ++i) {
        let left = neighbours[i]
        let right = advancedEconomyStage12MirrorCoord(left, mapSize)
        if (coordKey(left) == coordKey(right) ||
            !isCoordInsideMap(left, mapSize) ||
            !isCoordInsideMap(right, mapSize) ||
            claimed[coordKey(left)] ||
            claimed[coordKey(right)] ||
            hasCoordKey(occupied, left) ||
            hasCoordKey(occupied, right)) {
            continue
        }
        candidates.push({
            left: {x: left.x, y: left.y},
            right: {x: right.x, y: right.y}
        })
    }
    return candidates
}

function advancedEconomyStage12BuildSuburbLayouts(rng, mapSize, leftTown, rightTown, claimed, occupied) {
    let leftCells = [{x: leftTown.x, y: leftTown.y}]
    let rightCells = [{x: rightTown.x, y: rightTown.y}]
    claimed[coordKey(leftTown)] = true
    claimed[coordKey(rightTown)] = true

    let candidates = advancedEconomyStage12FreeNeighbourPairs(
        leftTown, mapSize, claimed, occupied)
    let desired = Math.min(4, candidates.length)
    let offset = candidates.length ? randomIntWithRng(rng, 0, candidates.length - 1) : 0
    for (let i = 0; i < candidates.length && leftCells.length <= desired; ++i) {
        let pair = candidates[(offset + i) % candidates.length]
        if (claimed[coordKey(pair.left)] || claimed[coordKey(pair.right)]) {
            continue
        }
        claimed[coordKey(pair.left)] = true
        claimed[coordKey(pair.right)] = true
        leftCells.push({x: pair.left.x, y: pair.left.y})
        rightCells.push({x: pair.right.x, y: pair.right.y})
    }

    let leftExpansion = []
    let leftExpansionSeen = {}
    for (let i = 0; i < leftCells.length; ++i) {
        let neighbours = townNeighbourCoords(leftCells[i])
        for (let j = 0; j < neighbours.length; ++j) {
            let left = neighbours[j]
            let right = advancedEconomyStage12MirrorCoord(left, mapSize)
            let key = coordKey(left)
            if (coordKey(left) == coordKey(right) ||
                !isCoordInsideMap(left, mapSize) ||
                !isCoordInsideMap(right, mapSize) ||
                claimed[key] ||
                claimed[coordKey(right)] ||
                leftExpansionSeen[key]) {
                continue
            }
            leftExpansionSeen[key] = true
            leftExpansion.push({x: left.x, y: left.y})
        }
    }

    return {
        left: {
            town: {x: leftTown.x, y: leftTown.y},
            cells: leftCells,
            expansionCells: leftExpansion
        },
        right: {
            town: {x: rightTown.x, y: rightTown.y},
            cells: rightCells,
            expansionCells: leftExpansion.map(function(coord) {
                return advancedEconomyStage12MirrorCoord(coord, mapSize)
            })
        }
    }
}

function advancedEconomyStage12MirrorBuilding(building, mapSize) {
    let mirrored = advancedEconomyStage12MirrorCoord(building, mapSize)
    let result = {
        x: mirrored.x,
        y: mirrored.y
    }
    if (building.town) {
        result.town = advancedEconomyStage12MirrorCoord(building.town, mapSize)
    }
    if (Object.prototype.hasOwnProperty.call(building, 'hp')) {
        result.hp = building.hp
    }
    return result
}

function generateAdvancedEconomyStage12TrainingMap(options) {
    options = options || {}
    let seed = options.seed || 1
    let rng = createSeededRandom(seed * 31 + 12)
    let mapSize = {x: 9, y: 9}
    let usedObjects = {}
    let claimed = {}
    let unitTypes = [Noob, Archer, KOHb, Normchel, Catapult]
    let startingGold = randomIntWithRng(rng, 70, 130)
    let playersConfig = [
        {
            rgb: {r: 208, g: 208, b: 208},
            towns: []
        },
        {
            rgb: trainingPlayerColor(1),
            playerType: 'AIPlayerWithEconomy',
            ai: true,
            gold: startingGold,
            towns: [],
            units: [],
            suburbs: [],
            farms: [],
            barracks: [],
            towers: [],
            bastions: []
        },
        {
            rgb: trainingPlayerColor(2),
            playerType: 'SimpleAiPlayerWithEconomy',
            ai: true,
            gold: startingGold,
            towns: [],
            units: [],
            suburbs: [],
            farms: [],
            barracks: [],
            towers: [],
            bastions: []
        }
    ]
    let summary = {
        towns: 0,
        units: 0,
        farms: 0,
        barracks: 0,
        towers: 0,
        bastions: 0,
        capturedSuburbs: 0
    }
    let townCount = randomIntWithRng(rng, 1, 3)

    for (let i = 0; i < townCount; ++i) {
        let pair = advancedEconomyStage12SymmetricCoordPair(
            rng,
            mapSize,
            usedObjects,
            function(left, right) {
                return left.x > 0 && left.y > 0 &&
                    right.x < mapSize.x - 1 && right.y < mapSize.y - 1 &&
                    !claimed[coordKey(left)] &&
                    !claimed[coordKey(right)] &&
                    advancedEconomyStage12FreeNeighbourPairs(
                        left, mapSize, claimed, usedObjects).length >= 4
            })
        let townHp = advancedEconomyStage11RandomHp(
            rng, advancedEconomyStage11BuildingMaxHp('towns'))
        pair.left.hp = townHp
        pair.right.hp = townHp
        playersConfig[1].towns.push(pair.left)
        playersConfig[2].towns.push(pair.right)
        summary.towns += 2

        let layouts = advancedEconomyStage12BuildSuburbLayouts(
            rng, mapSize, pair.left, pair.right, claimed, usedObjects)
        playersConfig[1].suburbs.push(layouts.left)
        playersConfig[2].suburbs.push(layouts.right)
        summary.capturedSuburbs += layouts.left.cells.length + layouts.right.cells.length
    }

    let leftBuildCells = advancedEconomyStage11OwnedBuildCells(playersConfig[1])
    let mandatoryFields = ['farms', 'barracks', 'towers', 'bastions']
    let buildOffset = leftBuildCells.length ? randomIntWithRng(rng, 0, leftBuildCells.length - 1) : 0
    let nextBuildIndex = 0
    for (let fieldIndex = 0; fieldIndex < mandatoryFields.length && nextBuildIndex < leftBuildCells.length; ++fieldIndex) {
        while (nextBuildIndex < leftBuildCells.length) {
            let cell = leftBuildCells[(buildOffset + nextBuildIndex) % leftBuildCells.length]
            nextBuildIndex += 1
            let rightCell = advancedEconomyStage12MirrorCoord(cell, mapSize)
            if (hasCoordKey(usedObjects, cell) || hasCoordKey(usedObjects, rightCell)) {
                continue
            }
            let field = mandatoryFields[fieldIndex]
            let hp = advancedEconomyStage11RandomHp(
                rng, advancedEconomyStage11BuildingMaxHp(field))
            let leftBuilding = {
                x: cell.x,
                y: cell.y,
                town: {x: cell.town.x, y: cell.town.y},
                hp: hp
            }
            let rightBuilding = advancedEconomyStage12MirrorBuilding(leftBuilding, mapSize)
            playersConfig[1][field].push(leftBuilding)
            playersConfig[2][field].push(rightBuilding)
            markCoordKey(usedObjects, cell)
            markCoordKey(usedObjects, rightCell)
            summary[field] += 2
            break
        }
    }

    for (let i = nextBuildIndex; i < leftBuildCells.length; ++i) {
        let cell = leftBuildCells[(buildOffset + i) % leftBuildCells.length]
        let rightCell = advancedEconomyStage12MirrorCoord(cell, mapSize)
        if (hasCoordKey(usedObjects, cell) || hasCoordKey(usedObjects, rightCell) || rng() >= 0.35) {
            continue
        }
        let field = mandatoryFields[randomIntWithRng(rng, 0, mandatoryFields.length - 1)]
        let hp = advancedEconomyStage11RandomHp(
            rng, advancedEconomyStage11BuildingMaxHp(field))
        let leftBuilding = {
            x: cell.x,
            y: cell.y,
            town: {x: cell.town.x, y: cell.town.y},
            hp: hp
        }
        let rightBuilding = advancedEconomyStage12MirrorBuilding(leftBuilding, mapSize)
        playersConfig[1][field].push(leftBuilding)
        playersConfig[2][field].push(rightBuilding)
        markCoordKey(usedObjects, cell)
        markCoordKey(usedObjects, rightCell)
        summary[field] += 2
    }

    let unitCount = randomIntWithRng(rng, 1, 5)
    for (let i = 0; i < unitCount; ++i) {
        let pair = advancedEconomyStage12SymmetricCoordPair(rng, mapSize, usedObjects)
        let type = unitTypes[randomIntWithRng(rng, 0, unitTypes.length - 1)]
        let hp = advancedEconomyStage11RandomHp(
            rng, advancedEconomyStage11MaxHpForUnit(type))
        playersConfig[1].units.push({
            type: type,
            x: pair.left.x,
            y: pair.left.y,
            hp: hp
        })
        playersConfig[2].units.push({
            type: type,
            x: pair.right.x,
            y: pair.right.y,
            hp: hp
        })
        summary.units += 2
    }

    let map = new GameMap(
        mapSize,
        playersConfig,
        [],
        [],
        [])
    map.testName = 'advanced-economy-stage-12-symmetric-' + seed
    map.suddenDeathRound = options.suddenDeathRound || 80
    map.economyStage = 'advanced-12'
    map.advancedEconomyStage = 12
    map.symmetry = {
        axis: 'vertical',
        mirror: 'x',
        seed: seed,
        playerOne: 'AIPlayerWithEconomy',
        playerTwo: 'SimpleAiPlayerWithEconomy',
        benchmarkSpecificAdvantage: false
    }
    map.economyGenerator = {
        stage: 'advanced-12',
        baseStage: 'advanced-11',
        seed: seed,
        playerOne: 'AIPlayerWithEconomy',
        playerTwo: 'SimpleAiPlayerWithEconomy',
        mapSize: mapSize,
        townCountPerPlayer: townCount,
        symmetric: true,
        randomHp: true,
        randomUnits: true,
        randomBuildings: true,
        capturedCells: true,
        benchmarkSpecificAdvantage: false
    }
    map.economyObjects = {
        farms: summary.farms,
        barracks: summary.barracks,
        goldmines: 0,
        towns: summary.towns,
        productionActions: summary.farms + summary.barracks,
        resources: playersConfig[1].gold + playersConfig[2].gold,
        units: summary.units,
        towers: summary.towers,
        bastions: summary.bastions,
        lakes: 0,
        mountains: 0,
        bushes: 0,
        capturedSuburbs: summary.capturedSuburbs
    }
    return map
}

function generateAdvancedEconomyStage13TrainingMap(options) {
    options = options || {}
    let seed = options.seed || 1
    let rng = createSeededRandom(seed * 37 + 13)
    let mapSize = {x: 20, y: 20}
    let usedObjects = {}
    let claimed = {}
    let unitTypes = [Noob, Archer, KOHb, Normchel, Catapult]
    let playersConfig = [
        {
            rgb: {r: 208, g: 208, b: 208},
            towns: []
        }
    ]
    let summary = {
        towns: 0,
        units: 0,
        farms: 0,
        barracks: 0,
        towers: 0,
        bastions: 0,
        capturedSuburbs: 0
    }
    let playerTownCounts = {}

    for (let playerIndex = 1; playerIndex <= 2; ++playerIndex) {
        let townCount = randomIntWithRng(rng, 0, 3)
        let player = {
            rgb: trainingPlayerColor(playerIndex),
            playerType: playerIndex == 1 ? 'AIPlayerWithEconomy' : 'SimpleAiPlayerWithEconomy',
            ai: true,
            gold: randomIntWithRng(rng, 70, 130),
            towns: [],
            units: [],
            suburbs: [],
            farms: [],
            barracks: [],
            towers: [],
            bastions: []
        }
        playerTownCounts[playerIndex] = townCount

        for (let i = 0; i < townCount; ++i) {
            let town = advancedEconomyStage11RandomCoord(
                rng,
                mapSize,
                usedObjects,
                function(coord) {
                    return coord.x > 0 && coord.y > 0 &&
                        coord.x < mapSize.x - 1 && coord.y < mapSize.y - 1 &&
                        !claimed[coordKey(coord)] &&
                        advancedEconomyStage11HasFreeNeighbour(
                            coord, mapSize, claimed, usedObjects)
                })
            town.hp = advancedEconomyStage11RandomHp(
                rng, advancedEconomyStage11BuildingMaxHp('towns'))
            player.towns.push(town)
            markCoordKey(usedObjects, town)
            summary.towns += 1
            let layout = advancedEconomyStage11BuildSuburbLayout(
                rng, mapSize, town, claimed, usedObjects)
            player.suburbs.push(layout)
            summary.capturedSuburbs += layout.cells.length
        }

        let buildCells = advancedEconomyStage11OwnedBuildCells(player)
        let offset = buildCells.length ? randomIntWithRng(rng, 0, buildCells.length - 1) : 0
        for (let i = 0; i < buildCells.length; ++i) {
            let cell = buildCells[(offset + i) % buildCells.length]
            if (hasCoordKey(usedObjects, cell) || rng() >= 0.55) {
                continue
            }
            let field = rng() < 0.5 ? 'farms' : 'barracks'
            let building = {
                x: cell.x,
                y: cell.y,
                town: {x: cell.town.x, y: cell.town.y},
                hp: advancedEconomyStage11RandomHp(
                    rng, advancedEconomyStage11BuildingMaxHp(field))
            }
            player[field].push(building)
            markCoordKey(usedObjects, cell)
            summary[field] += 1
        }

        for (let i = 0; i < buildCells.length; ++i) {
            let cell = buildCells[(offset + i) % buildCells.length]
            if (hasCoordKey(usedObjects, cell) || rng() >= 0.45) {
                continue
            }
            let field = rng() < 0.5 ? 'towers' : 'bastions'
            let building = {
                x: cell.x,
                y: cell.y,
                hp: advancedEconomyStage11RandomHp(
                    rng, advancedEconomyStage11BuildingMaxHp(field))
            }
            player[field].push(building)
            markCoordKey(usedObjects, cell)
            summary[field] += 1
        }

        let unitCount = randomIntWithRng(rng, 1, 8)
        for (let i = 0; i < unitCount; ++i) {
            let coord = advancedEconomyStage11RandomCoord(rng, mapSize, usedObjects)
            let type = unitTypes[randomIntWithRng(rng, 0, unitTypes.length - 1)]
            player.units.push({
                type: type,
                x: coord.x,
                y: coord.y,
                hp: advancedEconomyStage11RandomHp(
                    rng, advancedEconomyStage11MaxHpForUnit(type))
            })
            markCoordKey(usedObjects, coord)
            summary.units += 1
        }

        playersConfig.push(player)
    }

    let map = new GameMap(
        mapSize,
        playersConfig,
        [],
        [],
        [])
    map.testName = 'advanced-economy-stage-13-' + seed
    map.suddenDeathRound = options.suddenDeathRound || 100
    map.economyStage = 'advanced-13'
    map.advancedEconomyStage = 13
    map.economyGenerator = {
        stage: 'advanced-13',
        baseStage: 'advanced-11',
        seed: seed,
        playerOne: 'AIPlayerWithEconomy',
        playerTwo: 'SimpleAiPlayerWithEconomy',
        mapSize: mapSize,
        townCounts: playerTownCounts,
        randomHp: true,
        randomUnits: true,
        randomBuildings: true,
        capturedCells: true,
        stage11MechanicsExtended: true
    }
    map.economyObjects = {
        farms: summary.farms,
        barracks: summary.barracks,
        goldmines: 0,
        towns: summary.towns,
        productionActions: summary.farms + summary.barracks,
        resources: playersConfig[1].gold + playersConfig[2].gold,
        units: summary.units,
        towers: summary.towers,
        bastions: summary.bastions,
        lakes: 0,
        mountains: 0,
        bushes: 0,
        capturedSuburbs: summary.capturedSuburbs
    }
    return map
}

function generateAdvancedEconomyStage14TrainingMap(options) {
    options = options || {}
    let seed = options.seed || 1
    let rng = createSeededRandom(seed * 41 + 14)
    let mapSize = {x: 20, y: 20}
    let usedObjects = {}
    let claimed = {}
    let unitTypes = [Noob, Archer, KOHb, Normchel, Catapult]
    let startingGold = randomIntWithRng(rng, 70, 130)
    let playersConfig = [
        {
            rgb: {r: 208, g: 208, b: 208},
            towns: []
        },
        {
            rgb: trainingPlayerColor(1),
            playerType: 'AIPlayerWithEconomy',
            ai: true,
            gold: startingGold,
            towns: [],
            units: [],
            suburbs: [],
            farms: [],
            barracks: [],
            towers: [],
            bastions: []
        },
        {
            rgb: trainingPlayerColor(2),
            playerType: 'SimpleAiPlayerWithEconomy',
            ai: true,
            gold: startingGold,
            towns: [],
            units: [],
            suburbs: [],
            farms: [],
            barracks: [],
            towers: [],
            bastions: []
        }
    ]
    let summary = {
        towns: 0,
        units: 0,
        farms: 0,
        barracks: 0,
        towers: 0,
        bastions: 0,
        capturedSuburbs: 0
    }
    let townCount = randomIntWithRng(rng, 0, 3)

    for (let i = 0; i < townCount; ++i) {
        let pair = advancedEconomyStage12SymmetricCoordPair(
            rng,
            mapSize,
            usedObjects,
            function(left, right) {
                return left.x > 0 && left.y > 0 &&
                    left.x < Math.floor(mapSize.x / 2) - 1 &&
                    right.x > Math.floor(mapSize.x / 2) &&
                    right.x < mapSize.x - 1 && right.y < mapSize.y - 1 &&
                    !claimed[coordKey(left)] &&
                    !claimed[coordKey(right)] &&
                    advancedEconomyStage12FreeNeighbourPairs(
                        left, mapSize, claimed, usedObjects).length >= 4
            })
        let townHp = advancedEconomyStage11RandomHp(
            rng, advancedEconomyStage11BuildingMaxHp('towns'))
        pair.left.hp = townHp
        pair.right.hp = townHp
        playersConfig[1].towns.push(pair.left)
        playersConfig[2].towns.push(pair.right)
        summary.towns += 2

        let layouts = advancedEconomyStage12BuildSuburbLayouts(
            rng, mapSize, pair.left, pair.right, claimed, usedObjects)
        playersConfig[1].suburbs.push(layouts.left)
        playersConfig[2].suburbs.push(layouts.right)
        summary.capturedSuburbs += layouts.left.cells.length + layouts.right.cells.length
    }

    let leftBuildCells = advancedEconomyStage11OwnedBuildCells(playersConfig[1])
    let mandatoryFields = ['farms', 'barracks', 'towers', 'bastions']
    let buildOffset = leftBuildCells.length ? randomIntWithRng(rng, 0, leftBuildCells.length - 1) : 0
    let nextBuildIndex = 0
    for (let fieldIndex = 0; fieldIndex < mandatoryFields.length && nextBuildIndex < leftBuildCells.length; ++fieldIndex) {
        while (nextBuildIndex < leftBuildCells.length) {
            let cell = leftBuildCells[(buildOffset + nextBuildIndex) % leftBuildCells.length]
            nextBuildIndex += 1
            let rightCell = advancedEconomyStage12MirrorCoord(cell, mapSize)
            if (hasCoordKey(usedObjects, cell) || hasCoordKey(usedObjects, rightCell)) {
                continue
            }
            let field = mandatoryFields[fieldIndex]
            let hp = advancedEconomyStage11RandomHp(
                rng, advancedEconomyStage11BuildingMaxHp(field))
            let leftBuilding = {
                x: cell.x,
                y: cell.y,
                town: {x: cell.town.x, y: cell.town.y},
                hp: hp
            }
            let rightBuilding = advancedEconomyStage12MirrorBuilding(leftBuilding, mapSize)
            playersConfig[1][field].push(leftBuilding)
            playersConfig[2][field].push(rightBuilding)
            markCoordKey(usedObjects, cell)
            markCoordKey(usedObjects, rightCell)
            summary[field] += 2
            break
        }
    }

    for (let i = nextBuildIndex; i < leftBuildCells.length; ++i) {
        let cell = leftBuildCells[(buildOffset + i) % leftBuildCells.length]
        let rightCell = advancedEconomyStage12MirrorCoord(cell, mapSize)
        if (hasCoordKey(usedObjects, cell) || hasCoordKey(usedObjects, rightCell) || rng() >= 0.45) {
            continue
        }
        let field = mandatoryFields[randomIntWithRng(rng, 0, mandatoryFields.length - 1)]
        let hp = advancedEconomyStage11RandomHp(
            rng, advancedEconomyStage11BuildingMaxHp(field))
        let leftBuilding = {
            x: cell.x,
            y: cell.y,
            town: {x: cell.town.x, y: cell.town.y},
            hp: hp
        }
        let rightBuilding = advancedEconomyStage12MirrorBuilding(leftBuilding, mapSize)
        playersConfig[1][field].push(leftBuilding)
        playersConfig[2][field].push(rightBuilding)
        markCoordKey(usedObjects, cell)
        markCoordKey(usedObjects, rightCell)
        summary[field] += 2
    }

    let unitCount = randomIntWithRng(rng, 1, 8)
    for (let i = 0; i < unitCount; ++i) {
        let pair = advancedEconomyStage12SymmetricCoordPair(rng, mapSize, usedObjects)
        let type = unitTypes[randomIntWithRng(rng, 0, unitTypes.length - 1)]
        let hp = advancedEconomyStage11RandomHp(
            rng, advancedEconomyStage11MaxHpForUnit(type))
        playersConfig[1].units.push({
            type: type,
            x: pair.left.x,
            y: pair.left.y,
            hp: hp
        })
        playersConfig[2].units.push({
            type: type,
            x: pair.right.x,
            y: pair.right.y,
            hp: hp
        })
        summary.units += 2
    }

    let map = new GameMap(
        mapSize,
        playersConfig,
        [],
        [],
        [])
    map.testName = 'advanced-economy-stage-14-symmetric-' + seed
    map.suddenDeathRound = options.suddenDeathRound || 100
    map.economyStage = 'advanced-14'
    map.advancedEconomyStage = 14
    map.symmetry = {
        axis: 'vertical',
        mirror: 'x',
        seed: seed,
        playerOne: 'AIPlayerWithEconomy',
        playerTwo: 'SimpleAiPlayerWithEconomy',
        benchmarkSpecificAdvantage: false
    }
    map.economyGenerator = {
        stage: 'advanced-14',
        baseStage: 'advanced-13',
        seed: seed,
        playerOne: 'AIPlayerWithEconomy',
        playerTwo: 'SimpleAiPlayerWithEconomy',
        mapSize: mapSize,
        townCountPerPlayer: townCount,
        symmetric: true,
        randomHp: true,
        randomUnits: true,
        randomBuildings: true,
        capturedCells: true,
        stage13MechanicsExtended: true,
        benchmarkSpecificAdvantage: false
    }
    map.economyObjects = {
        farms: summary.farms,
        barracks: summary.barracks,
        goldmines: 0,
        towns: summary.towns,
        productionActions: summary.farms + summary.barracks,
        resources: playersConfig[1].gold + playersConfig[2].gold,
        units: summary.units,
        towers: summary.towers,
        bastions: summary.bastions,
        lakes: 0,
        mountains: 0,
        bushes: 0,
        capturedSuburbs: summary.capturedSuburbs
    }
    return map
}

function generateSymmetricalEconomy9v9AllUnitMap(options) {
    options = options || {}
    let seed = options.seed || 1
    let rng = createSeededRandom(seed)
    let mapSize = {x: 9, y: 9}
    let leftTown = {x: 1, y: 4}
    let rightTown = {x: 7, y: 4}
    let towerHp = randomIntWithRng(rng, 2, 5)
    let bastionHp = randomIntWithRng(rng, 2, 5)
    let noobHp = randomIntWithRng(rng, 1, 2)
    let kohbHp = randomIntWithRng(rng, 1, 3)
    let normchelHp = randomIntWithRng(rng, 1, 5)
    let unitTypeOffset = randomIntWithRng(rng, 0, 4)
    let leftCoords = [
        {x: 2, y: 1},
        {x: 2, y: 4},
        {x: 2, y: 7},
        {x: 3, y: 1},
        {x: 3, y: 7}
    ]
    let rightCoords = leftCoords.map(function(coord) {
        return mirrorXCoord(coord, mapSize)
    })
    let leftUnits = stage7UnitsFromCoords(leftCoords, unitTypeOffset)
    let rightUnits = stage7UnitsFromCoords(rightCoords, unitTypeOffset)
    let hpByUnitType = {
        Noob: noobHp,
        Archer: 1,
        KOHb: kohbHp,
        Normchel: normchelHp,
        Catapult: 1
    }
    for (let i = 0; i < leftUnits.length; ++i) {
        let unitName = leftUnits[i].type.name
        leftUnits[i].hp = hpByUnitType[unitName]
        rightUnits[i].hp = hpByUnitType[unitName]
    }
    let leftSuburbCells = [
        leftTown,
        {x: 1, y: 3},
        {x: 1, y: 5},
        {x: 2, y: 2},
        {x: 2, y: 3},
        {x: 2, y: 4},
        {x: 2, y: 5},
        {x: 2, y: 6},
        {x: 3, y: 3},
        {x: 3, y: 5}
    ]
    let rightSuburbCells = leftSuburbCells.map(function(coord) {
        return mirrorXCoord(coord, mapSize)
    })
    let leftTower = {x: 3, y: 3, town: leftTown, hp: towerHp}
    let leftBastion = {x: 3, y: 5, town: leftTown, hp: bastionHp}
    let rightTower = Object.assign(
        {town: rightTown, hp: towerHp},
        mirrorXCoord(leftTower, mapSize))
    let rightBastion = Object.assign(
        {town: rightTown, hp: bastionHp},
        mirrorXCoord(leftBastion, mapSize))
    let leftFarm = {x: 1, y: 3, town: leftTown}
    let leftBarrack = {x: 1, y: 5, town: leftTown}
    let rightFarm = Object.assign(
        {town: rightTown},
        mirrorXCoord(leftFarm, mapSize))
    let rightBarrack = Object.assign(
        {town: rightTown},
        mirrorXCoord(leftBarrack, mapSize))
    let goldmineIncome = randomIntWithRng(rng, 20, 40)
    let neutralGoldmineIncome = randomIntWithRng(rng, 20, 40)
    let goldmines = [
        {x: 0, y: 4, income: goldmineIncome, owner: 1},
        {x: 8, y: 4, income: goldmineIncome, owner: 2},
        {x: 4, y: 8, income: neutralGoldmineIncome, owner: 0}
    ]
    let generatedPlayers = [
        {
            rgb: {r: 208, g: 208, b: 208},
            towns: []
        },
        {
            rgb: trainingPlayerColor(1),
            playerType: 'AIPlayerWithEconomy',
            ai: true,
            gold: 180,
            towns: [leftTown],
            units: leftUnits,
            suburbs: [{
                town: leftTown,
                cells: leftSuburbCells,
                expansionCells: [{x: 0, y: 3}, {x: 0, y: 5}, {x: 4, y: 4}]
            }],
            farms: [leftFarm],
            barracks: [leftBarrack],
            towers: [leftTower],
            bastions: [leftBastion]
        },
        {
            rgb: trainingPlayerColor(2),
            playerType: 'SimpleAiPlayerWithEconomy',
            ai: true,
            gold: 180,
            towns: [rightTown],
            units: rightUnits,
            suburbs: [{
                town: rightTown,
                cells: rightSuburbCells,
                expansionCells: [{x: 8, y: 3}, {x: 8, y: 5}, {x: 4, y: 4}]
            }],
            farms: [rightFarm],
            barracks: [rightBarrack],
            towers: [rightTower],
            bastions: [rightBastion]
        }
    ]
    let lakes = [{x: 4, y: 0}]
    let mountains = [{x: 0, y: 1}, {x: 8, y: 1}]
    let bushes = [{x: 0, y: 7}, {x: 8, y: 7}]
    let hills = [{x: 4, y: 2}, {x: 4, y: 6}]
    let map = new GameMap(
        mapSize,
        generatedPlayers,
        goldmines,
        lakes,
        mountains,
        bushes,
        hills)
    map.testName = 'symmetrical-economy-9v9-all-unit-' + seed
    map.suddenDeathRound = options.suddenDeathRound || 120
    map.economyStage = 'symmetrical-9v9-all-unit'
    map.symmetry = {
        axis: 'vertical',
        mirror: 'x',
        seed: seed,
        playerOne: 'AIPlayerWithEconomy',
        playerTwo: 'SimpleAiPlayerWithEconomy',
        benchmarkSpecificAdvantage: false
    }
    map.economyGenerator = {
        name: 'symmetrical-economy-9v9-all-unit',
        seed: seed,
        mapSize: mapSize,
        playerOne: 'AIPlayerWithEconomy',
        playerTwo: 'SimpleAiPlayerWithEconomy',
        unitTypes: ['Noob', 'Archer', 'KOHb', 'Normchel', 'Catapult'],
        unitTypeOffset: unitTypeOffset,
        unitsPerPlayer: leftUnits.length,
        buildingTypes: ['farm', 'barrack', 'tower', 'bastion'],
        hpByType: Object.assign({}, hpByUnitType, {
            tower: towerHp,
            bastion: bastionHp
        }),
        goldmineIncome: goldmineIncome,
        neutralGoldmineIncome: neutralGoldmineIncome,
        startingGold: 180,
        terrainTypes: ['lake', 'mountain', 'bush', 'hill'],
        benchmarkSpecificAdvantage: false
    }
    map.economyObjects = {
        farms: 2,
        barracks: 2,
        goldmines: goldmines.length,
        towns: 2,
        productionActions: 0,
        resources: 360,
        noobs: 2,
        archers: 2,
        KOHbs: 2,
        normchels: 2,
        catapults: 2,
        towers: 2,
        bastions: 2
    }
    return map
}

function generateCombatStageATrainingMap(options) {
    options = options || {}
    let rng = createSeededRandom(options.seed || 1)
    let mirrored = rng() >= 0.5
    let firstUnit = mirrored ? {x: 0, y: 1} : {x: 0, y: 0}
    let secondUnit = mirrored ? {x: 1, y: 0} : {x: 1, y: 1}
    let generatedPlayers = [
        {
            rgb: {r: 208, g: 208, b: 208},
            towns: []
        },
        {
            rgb: trainingPlayerColor(1),
            towns: [],
            ai: true,
            units: [{type: Noob, x: firstUnit.x, y: firstUnit.y}]
        },
        {
            rgb: trainingPlayerColor(2),
            towns: [],
            ai: true,
            units: [{type: Noob, x: secondUnit.x, y: secondUnit.y}]
        }
    ]
    let map = new GameMap(
        {x: 2, y: 2},
        generatedPlayers,
        [],
        [],
        [])
    map.suddenDeathRound = 0
    map.combatStage = 'A'
    map.combatOnly = true
    map.economyObjects = {
        farms: 0,
        barracks: 0,
        goldmines: 0,
        towns: 0,
        productionActions: 0,
        resources: 0
    }
    return map
}

function clampCombatProgress(progress) {
    if (!Number.isFinite(progress)) {
        return 0
    }
    return Math.max(0, Math.min(1, progress))
}

function coordInList(coords, coord) {
    for (let i = 0; i < coords.length; ++i) {
        if (coords[i].x == coord.x && coords[i].y == coord.y) {
            return true
        }
    }
    return false
}

function stageBPlayableCells(mapSize, progress) {
    let cells = []
    let centerY = Math.floor(mapSize.y / 2)
    let maxWidth = Math.max(1, Math.floor(1 + progress * 3))
    for (let x = 0; x < mapSize.x; ++x) {
        let wave = x % 3 == 0 ? -1 : (x % 3 == 1 ? 0 : 1)
        let center = Math.max(0, Math.min(mapSize.y - 1, centerY + wave))
        for (let y = 0; y < mapSize.y; ++y) {
            if (Math.abs(y - center) <= maxWidth - 1) {
                cells.push({x: x, y: y})
            }
        }
    }
    return cells
}

function generateCombatStageBTrainingMap(options) {
    options = options || {}
    let progress = clampCombatProgress(
        options.progress === undefined ? 0 : options.progress)
    let rng = createSeededRandom(options.seed || 1)
    let maxBound = options.maxBound || 9
    let bound = Math.min(9, Math.max(3,
        Math.floor(3 + progress * (maxBound - 3))))
    let mapSize = {x: bound, y: bound}
    let playable = stageBPlayableCells(mapSize, progress)
    let firstUnit = playable[0]
    let secondUnit = playable[playable.length - 1]
    if (rng() >= 0.5) {
        firstUnit = playable[playable.length - 1]
        secondUnit = playable[0]
    }
    let lakes = []
    for (let x = 0; x < mapSize.x; ++x) {
        for (let y = 0; y < mapSize.y; ++y) {
            let coord = {x: x, y: y}
            if (!coordInList(playable, coord)) {
                lakes.push(coord)
            }
        }
    }
    let generatedPlayers = [
        {
            rgb: {r: 208, g: 208, b: 208},
            towns: []
        },
        {
            rgb: trainingPlayerColor(1),
            towns: [],
            ai: true,
            units: [{type: Noob, x: firstUnit.x, y: firstUnit.y}]
        },
        {
            rgb: trainingPlayerColor(2),
            towns: [],
            ai: true,
            units: [{type: Noob, x: secondUnit.x, y: secondUnit.y}]
        }
    ]
    let map = new GameMap(
        mapSize,
        generatedPlayers,
        [],
        lakes,
        [])
    map.suddenDeathRound = 0
    map.combatStage = 'B'
    map.combatStageProgress = progress
    map.combatOnly = true
    map.floodedCellCount = lakes.length
    map.playableCellCount = playable.length
    map.economyObjects = {
        farms: 0,
        barracks: 0,
        goldmines: 0,
        towns: 0,
        productionActions: 0,
        resources: 0
    }
    return map
}

function stageCPlayableCells(mapSize, progress) {
    let cells = []
    let center = {
        x: Math.floor(mapSize.x / 2),
        y: Math.floor(mapSize.y / 2)
    }
    for (let x = 0; x < mapSize.x; ++x) {
        for (let y = 0; y < mapSize.y; ++y) {
            cells.push({x: x, y: y})
        }
    }
    cells.sort((left, right) => {
        let leftDistance = Math.abs(left.x - center.x) +
            Math.abs(left.y - center.y)
        let rightDistance = Math.abs(right.x - center.x) +
            Math.abs(right.y - center.y)
        return leftDistance - rightDistance || left.x - right.x ||
            left.y - right.y
    })
    let minimumPlayable = Math.min(2, cells.length)
    let playableCount = minimumPlayable + Math.floor(
        clampCombatProgress(progress) * (cells.length - minimumPlayable))
    return cells.slice(0, playableCount)
}

function generateCombatStageCTrainingMap(options) {
    options = options || {}
    let progress = clampCombatProgress(
        options.progress === undefined ? 0 : options.progress)
    let rng = createSeededRandom(options.seed || 1)
    let bound = Math.min(9, Math.max(3, options.bound || 9))
    let mapSize = {x: bound, y: bound}
    let playable = stageCPlayableCells(mapSize, progress)
    let firstUnit = playable[0]
    let secondUnit = playable[playable.length - 1]
    if (rng() >= 0.5) {
        firstUnit = playable[playable.length - 1]
        secondUnit = playable[0]
    }
    let lakes = []
    for (let x = 0; x < mapSize.x; ++x) {
        for (let y = 0; y < mapSize.y; ++y) {
            let coord = {x: x, y: y}
            if (!coordInList(playable, coord)) {
                lakes.push(coord)
            }
        }
    }
    let generatedPlayers = [
        {
            rgb: {r: 208, g: 208, b: 208},
            towns: []
        },
        {
            rgb: trainingPlayerColor(1),
            towns: [],
            ai: true,
            units: [{type: Noob, x: firstUnit.x, y: firstUnit.y}]
        },
        {
            rgb: trainingPlayerColor(2),
            towns: [],
            ai: true,
            units: [{type: Noob, x: secondUnit.x, y: secondUnit.y}]
        }
    ]
    let map = new GameMap(
        mapSize,
        generatedPlayers,
        [],
        lakes,
        [])
    map.suddenDeathRound = Math.max(0, Math.round(progress * 10))
    map.combatStage = 'C'
    map.combatStageProgress = progress
    map.combatOnly = true
    map.floodedCellCount = lakes.length
    map.playableCellCount = playable.length
    map.economyObjects = {
        farms: 0,
        barracks: 0,
        goldmines: 0,
        towns: 0,
        productionActions: 0,
        resources: 0
    }
    return map
}

function stageDNoobCounts(progress, rng) {
    let strongerCount = Math.min(4, Math.max(2,
        2 + Math.floor(clampCombatProgress(progress) * 3)))
    let weakerCount = Math.max(1, strongerCount - 1)
    if (rng() >= 0.5) {
        return {playerOne: strongerCount, playerTwo: weakerCount}
    }
    return {playerOne: weakerCount, playerTwo: strongerCount}
}

function stageDUnitCoords(mapSize, fromRight, count, rng) {
    let centerY = Math.floor(mapSize.y / 2)
    let x = fromRight ? mapSize.x - 2 : 1
    let offsets = [0, -1, 1, -2]
    if (rng() >= 0.5) {
        offsets = [0, 1, -1, 2]
    }
    let coords = []
    for (let i = 0; i < count; ++i) {
        coords.push({
            x: x,
            y: Math.max(0, Math.min(mapSize.y - 1, centerY + offsets[i]))
        })
    }
    return coords
}

function noobUnitsFromCoords(coords) {
    let units = []
    for (let i = 0; i < coords.length; ++i) {
        units.push({type: Noob, x: coords[i].x, y: coords[i].y})
    }
    return units
}

function stageDGatePassed(curriculum) {
    if (!curriculum) {
        return false
    }
    if (curriculum.currentStageIndex >= 4) {
        return true
    }
    let history = curriculum.gateHistory || []
    for (let i = 0; i < history.length; ++i) {
        if (history[i].advancedToStageIndex >= 4 ||
                history[i].advancedToStage == 'combat-stage-4' ||
                history[i].advancedToStage == 'combat-stage-E') {
            return true
        }
    }
    return false
}

function requireStageDGateForStageE(options) {
    if (!stageDGatePassed(options.curriculum)) {
        throw new Error(
            'Combat Stage E is unavailable until the Stage D gate has passed')
    }
}

function stageEGatePassed(curriculum) {
    if (!curriculum) {
        return false
    }
    if (curriculum.currentStageIndex >= 5) {
        return true
    }
    let history = curriculum.gateHistory || []
    for (let i = 0; i < history.length; ++i) {
        if (history[i].advancedToStageIndex >= 5 ||
                history[i].advancedToStage == 'combat-stage-5' ||
                history[i].advancedToStage == 'combat-stage-F') {
            return true
        }
    }
    return false
}

function requireStageEGateForStageF(options) {
    if (!stageEGatePassed(options.curriculum)) {
        throw new Error(
            'Combat Stage F is unavailable until the Stage E gate has passed')
    }
}

function stageFGatePassed(curriculum) {
    if (!curriculum) {
        return false
    }
    if (curriculum.currentStageIndex >= 6) {
        return true
    }
    let history = curriculum.gateHistory || []
    for (let i = 0; i < history.length; ++i) {
        if (history[i].advancedToStageIndex >= 6 ||
                history[i].advancedToStage == 'combat-stage-6' ||
                history[i].advancedToStage == 'combat-stage-G') {
            return true
        }
    }
    return false
}

function requireStageFGateForStageG(options) {
    if (!stageFGatePassed(options.curriculum)) {
        throw new Error(
            'Combat Stage G is unavailable until the Stage F gate has passed')
    }
}

function stageEUnitsFromCoords(coords, useNormchel) {
    let units = []
    for (let i = 0; i < coords.length; ++i) {
        let unitType = useNormchel && i == 0 ? Normchel : Noob
        units.push({type: unitType, x: coords[i].x, y: coords[i].y})
    }
    return units
}

function stageFUnitsFromCoords(coords, useKOHb, useNormchel) {
    let units = []
    for (let i = 0; i < coords.length; ++i) {
        let unitType = Noob
        if (useKOHb && i == 0) {
            unitType = KOHb
        } else if (useNormchel && i == 1) {
            unitType = Normchel
        }
        units.push({type: unitType, x: coords[i].x, y: coords[i].y})
    }
    return units
}

function stageGUnitsFromCoords(coords, useArcher, useKOHb, useNormchel) {
    let units = []
    for (let i = 0; i < coords.length; ++i) {
        let unitType = Noob
        if (useArcher && i == 0) {
            unitType = Archer
        } else if (useKOHb && i == 1) {
            unitType = KOHb
        } else if (useNormchel && i == 2) {
            unitType = Normchel
        }
        units.push({type: unitType, x: coords[i].x, y: coords[i].y})
    }
    return units
}

function mirrorXCoord(coord, mapSize) {
    let mirrored = {x: mapSize.x - 1 - coord.x, y: coord.y}
    if ('hp' in coord) {
        mirrored.hp = coord.hp
    }
    if ('turns' in coord) {
        mirrored.turns = coord.turns
    }
    if ('income' in coord) {
        mirrored.income = coord.income
    }
    if ('owner' in coord) {
        mirrored.owner = coord.owner
    }
    return mirrored
}

function mirrorConfiguredUnit(unit, mapSize) {
    let mirrored = mirrorXCoord(unit, mapSize)
    mirrored.type = unit.type
    return mirrored
}

function mirrorConfiguredBuilding(building, mapSize) {
    let mirrored = mirrorXCoord(building, mapSize)
    mirrored.town = mirrorXCoord(building.town, mapSize)
    return mirrored
}

function countUnitsByType(units, unitType) {
    return units.filter(function(unit) {
        return unit.type == unitType
    }).length
}

function generateSymmetricalCombatStageGMap(options) {
    options = options || {}
    let seed = options.seed || 1
    let rng = createSeededRandom(seed)
    let mapSize = {
        x: options.width || 11,
        y: options.height || 9
    }
    if (mapSize.x < 9 || mapSize.y < 7 || mapSize.x % 2 == 0) {
        throw new Error('Symmetrical combat Stage G maps require odd width >= 9 and height >= 7')
    }

    let centerX = Math.floor(mapSize.x / 2)
    let centerY = Math.floor(mapSize.y / 2)
    let leftTown = {x: 1, y: centerY, hp: 10}
    let rightTown = mirrorXCoord(leftTown, mapSize)
    let hpOffset = randomIntWithRng(rng, 0, 1)
    let leftUnits = [
        {type: Noob, x: 2, y: centerY - 2, hp: 2},
        {type: Normchel, x: 2, y: centerY, hp: 4 + hpOffset},
        {type: KOHb, x: 2, y: centerY + 2, hp: 2 + hpOffset},
        {type: Archer, x: 3, y: centerY - 1, hp: 1},
        {type: Catapult, x: 3, y: centerY + 1, hp: 1}
    ]
    let leftWalls = [
        {x: 1, y: centerY - 1, hp: 3 + hpOffset, town: leftTown},
        {x: 1, y: centerY + 1, hp: 4, town: leftTown}
    ]
    let leftBastions = [
        {x: 2, y: centerY - 1, hp: 4 + hpOffset, town: leftTown}
    ]
    let leftTowers = [
        {x: 2, y: centerY + 1, hp: 5 - hpOffset, town: leftTown}
    ]
    let leftSuburbCells = [leftTown]
        .concat(leftWalls)
        .concat(leftBastions)
        .concat(leftTowers)
        .map(function(coord) {
            return {x: coord.x, y: coord.y}
        })
    let rightUnits = leftUnits.map(function(unit) {
        return mirrorConfiguredUnit(unit, mapSize)
    })
    let rightWalls = leftWalls.map(function(building) {
        return mirrorConfiguredBuilding(building, mapSize)
    })
    let rightBastions = leftBastions.map(function(building) {
        return mirrorConfiguredBuilding(building, mapSize)
    })
    let rightTowers = leftTowers.map(function(building) {
        return mirrorConfiguredBuilding(building, mapSize)
    })
    let mirroredTerrainPairs = [
        {x: centerX - 1, y: centerY - 3},
        {x: centerX - 1, y: centerY + 3}
    ]
    let mountains = mirroredTerrainPairs
        .concat(mirroredTerrainPairs.map(function(coord) {
            return mirrorXCoord(coord, mapSize)
        }))
    let lakes = [
        {x: centerX, y: centerY - 1},
        {x: centerX, y: centerY + 1}
    ]
    let bushes = [
        {x: centerX - 2, y: centerY},
        {x: centerX + 2, y: centerY}
    ]
    let hills = [
        {x: centerX - 1, y: centerY},
        {x: centerX + 1, y: centerY}
    ]
    let generatedPlayers = [
        {
            rgb: {r: 208, g: 208, b: 208},
            towns: []
        },
        {
            rgb: trainingPlayerColor(1),
            playerType: 'AIPlayer',
            ai: true,
            towns: [leftTown],
            units: leftUnits,
            suburbs: [{
                town: leftTown,
                cells: leftSuburbCells,
                expansionCells: []
            }],
            walls: leftWalls,
            bastions: leftBastions,
            towers: leftTowers
        },
        {
            rgb: trainingPlayerColor(2),
            playerType: 'SimpleAiPlayer',
            ai: true,
            towns: [rightTown],
            units: rightUnits,
            suburbs: [{
                town: rightTown,
                cells: leftSuburbCells.map(function(coord) {
                    return mirrorXCoord(coord, mapSize)
                }),
                expansionCells: []
            }],
            walls: rightWalls,
            bastions: rightBastions,
            towers: rightTowers
        }
    ]
    let map = new GameMap(
        mapSize,
        generatedPlayers,
        [],
        lakes,
        mountains,
        bushes,
        hills)
    map.testName = 'symmetrical-combat-stage-g-' + seed
    map.suddenDeathRound = options.suddenDeathRound || 24
    map.combatStage = 'G-symmetrical-final'
    map.combatOnly = true
    map.symmetry = {
        axis: 'vertical',
        mirror: 'x',
        seed: seed,
        playerOne: 'AIPlayer',
        playerTwo: 'SimpleAiPlayer'
    }
    map.playerNoobCounts = {
        playerOne: countUnitsByType(leftUnits, Noob),
        playerTwo: countUnitsByType(rightUnits, Noob)
    }
    map.playerNormchelCounts = {
        playerOne: countUnitsByType(leftUnits, Normchel),
        playerTwo: countUnitsByType(rightUnits, Normchel)
    }
    map.playerKOHbCounts = {
        playerOne: countUnitsByType(leftUnits, KOHb),
        playerTwo: countUnitsByType(rightUnits, KOHb)
    }
    map.playerArcherCounts = {
        playerOne: countUnitsByType(leftUnits, Archer),
        playerTwo: countUnitsByType(rightUnits, Archer)
    }
    map.playerCatapultCounts = {
        playerOne: countUnitsByType(leftUnits, Catapult),
        playerTwo: countUnitsByType(rightUnits, Catapult)
    }
    map.combatMetrics = {
        finalSymmetricalCombatStage: true,
        unitTypes: ['Noob', 'Normchel', 'KOHb', 'Archer', 'Catapult'],
        mirroredBuildings: ['wall', 'bastion', 'tower'],
        mirroredTerrain: ['lake', 'mountain', 'bush', 'hill'],
        benchmarkPassFailLogic: false
    }
    map.economyObjects = {
        farms: 0,
        barracks: 0,
        goldmines: 0,
        productionActions: 0,
        resources: 0
    }
    return map
}

function generateCombatStageDTrainingMap(options) {
    options = options || {}
    let progress = clampCombatProgress(
        options.progress === undefined ? 0 : options.progress)
    let rng = createSeededRandom(options.seed || 1)
    let bound = Math.min(9, Math.max(5, options.bound || 9))
    let mapSize = {x: bound, y: bound}
    let counts = stageDNoobCounts(progress, rng)
    let playerOneOnRight = rng() >= 0.5
    let playerOneCoords = stageDUnitCoords(
        mapSize, playerOneOnRight, counts.playerOne, rng)
    let playerTwoCoords = stageDUnitCoords(
        mapSize, !playerOneOnRight, counts.playerTwo, rng)
    let generatedPlayers = [
        {
            rgb: {r: 208, g: 208, b: 208},
            towns: []
        },
        {
            rgb: trainingPlayerColor(1),
            towns: [],
            ai: true,
            units: noobUnitsFromCoords(playerOneCoords)
        },
        {
            rgb: trainingPlayerColor(2),
            towns: [],
            ai: true,
            units: noobUnitsFromCoords(playerTwoCoords)
        }
    ]
    let map = new GameMap(
        mapSize,
        generatedPlayers,
        [],
        [],
        [])
    map.suddenDeathRound = 10
    map.combatStage = 'D'
    map.combatStageProgress = progress
    map.combatOnly = true
    map.playerNoobCounts = {
        playerOne: counts.playerOne,
        playerTwo: counts.playerTwo
    }
    map.economyObjects = {
        farms: 0,
        barracks: 0,
        goldmines: 0,
        towns: 0,
        productionActions: 0,
        resources: 0
    }
    return map
}

function generateCombatStageETrainingMap(options) {
    options = options || {}
    requireStageDGateForStageE(options)
    let progress = clampCombatProgress(
        options.progress === undefined ? 0 : options.progress)
    let rng = createSeededRandom(options.seed || 1)
    let bound = Math.min(9, Math.max(5, options.bound || 9))
    let mapSize = {x: bound, y: bound}
    let counts = stageDNoobCounts(progress, rng)
    let playerOneOnRight = rng() >= 0.5
    let playerOneCoords = stageDUnitCoords(
        mapSize, playerOneOnRight, counts.playerOne, rng)
    let playerTwoCoords = stageDUnitCoords(
        mapSize, !playerOneOnRight, counts.playerTwo, rng)
    let normchelPlayer = rng() >= 0.5 ? 1 : 2
    let includeNormchel = progress >= 0.25 || rng() >= 0.5
    let generatedPlayers = [
        {
            rgb: {r: 208, g: 208, b: 208},
            towns: []
        },
        {
            rgb: trainingPlayerColor(1),
            towns: [],
            ai: true,
            units: stageEUnitsFromCoords(
                playerOneCoords, includeNormchel && normchelPlayer == 1)
        },
        {
            rgb: trainingPlayerColor(2),
            towns: [],
            ai: true,
            units: stageEUnitsFromCoords(
                playerTwoCoords, includeNormchel && normchelPlayer == 2)
        }
    ]
    let map = new GameMap(
        mapSize,
        generatedPlayers,
        [],
        [],
        [])
    map.suddenDeathRound = 10
    map.combatStage = 'E'
    map.combatStageProgress = progress
    map.combatOnly = true
    map.playerNoobCounts = {
        playerOne: generatedPlayers[1].units.filter(function(unit) {
            return unit.type == Noob
        }).length,
        playerTwo: generatedPlayers[2].units.filter(function(unit) {
            return unit.type == Noob
        }).length
    }
    map.playerNormchelCounts = {
        playerOne: generatedPlayers[1].units.filter(function(unit) {
            return unit.type == Normchel
        }).length,
        playerTwo: generatedPlayers[2].units.filter(function(unit) {
            return unit.type == Normchel
        }).length
    }
    map.combatMetrics = {
        newlyUnlockedMechanic: 'Normchel',
        unlockedUnitType: 'Normchel',
        blockedUnitTypes: ['Archer', 'KOHb']
    }
    map.economyObjects = {
        farms: 0,
        barracks: 0,
        goldmines: 0,
        towns: 0,
        productionActions: 0,
        resources: 0
    }
    return map
}

function generateCombatStageFTrainingMap(options) {
    options = options || {}
    requireStageEGateForStageF(options)
    let progress = clampCombatProgress(
        options.progress === undefined ? 0 : options.progress)
    let rng = createSeededRandom(options.seed || 1)
    let bound = Math.min(9, Math.max(5, options.bound || 9))
    let mapSize = {x: bound, y: bound}
    let counts = stageDNoobCounts(progress, rng)
    let playerOneOnRight = rng() >= 0.5
    let playerOneCoords = stageDUnitCoords(
        mapSize, playerOneOnRight, counts.playerOne, rng)
    let playerTwoCoords = stageDUnitCoords(
        mapSize, !playerOneOnRight, counts.playerTwo, rng)
    let KOHbPlayer = rng() >= 0.5 ? 1 : 2
    let normchelPlayer = KOHbPlayer == 1 ? 2 : 1
    let includeKOHb = progress >= 0.25 || rng() >= 0.5
    let includeNormchel = progress >= 0.5 || rng() >= 0.5
    let generatedPlayers = [
        {
            rgb: {r: 208, g: 208, b: 208},
            towns: []
        },
        {
            rgb: trainingPlayerColor(1),
            towns: [],
            ai: true,
            units: stageFUnitsFromCoords(
                playerOneCoords,
                includeKOHb && KOHbPlayer == 1,
                includeNormchel && normchelPlayer == 1)
        },
        {
            rgb: trainingPlayerColor(2),
            towns: [],
            ai: true,
            units: stageFUnitsFromCoords(
                playerTwoCoords,
                includeKOHb && KOHbPlayer == 2,
                includeNormchel && normchelPlayer == 2)
        }
    ]
    let map = new GameMap(
        mapSize,
        generatedPlayers,
        [],
        [],
        [])
    map.suddenDeathRound = 10
    map.combatStage = 'F'
    map.combatStageProgress = progress
    map.combatOnly = true
    map.playerNoobCounts = {
        playerOne: generatedPlayers[1].units.filter(function(unit) {
            return unit.type == Noob
        }).length,
        playerTwo: generatedPlayers[2].units.filter(function(unit) {
            return unit.type == Noob
        }).length
    }
    map.playerNormchelCounts = {
        playerOne: generatedPlayers[1].units.filter(function(unit) {
            return unit.type == Normchel
        }).length,
        playerTwo: generatedPlayers[2].units.filter(function(unit) {
            return unit.type == Normchel
        }).length
    }
    map.playerKOHbCounts = {
        playerOne: generatedPlayers[1].units.filter(function(unit) {
            return unit.type == KOHb
        }).length,
        playerTwo: generatedPlayers[2].units.filter(function(unit) {
            return unit.type == KOHb
        }).length
    }
    map.combatMetrics = {
        newlyUnlockedMechanic: 'KOHb',
        unlockedUnitType: 'KOHb',
        previouslyUnlockedUnitTypes: ['Noob', 'Normchel'],
        blockedUnitTypes: ['Archer']
    }
    map.economyObjects = {
        farms: 0,
        barracks: 0,
        goldmines: 0,
        towns: 0,
        productionActions: 0,
        resources: 0
    }
    return map
}

function generateCombatStageGTrainingMap(options) {
    options = options || {}
    requireStageFGateForStageG(options)
    let progress = clampCombatProgress(
        options.progress === undefined ? 0 : options.progress)
    let rng = createSeededRandom(options.seed || 1)
    let bound = Math.min(9, Math.max(5, options.bound || 9))
    let mapSize = {x: bound, y: bound}
    let counts = stageDNoobCounts(progress, rng)
    let playerOneOnRight = rng() >= 0.5
    let playerOneCoords = stageDUnitCoords(
        mapSize, playerOneOnRight, counts.playerOne, rng)
    let playerTwoCoords = stageDUnitCoords(
        mapSize, !playerOneOnRight, counts.playerTwo, rng)
    let archerPlayer = rng() >= 0.5 ? 1 : 2
    let KOHbPlayer = archerPlayer == 1 ? 2 : 1
    let normchelPlayer = rng() >= 0.5 ? 1 : 2
    let includeArcher = progress >= 0.25 || rng() >= 0.5
    let includeKOHb = progress >= 0.4 || rng() >= 0.5
    let includeNormchel = progress >= 0.6 || rng() >= 0.5
    let generatedPlayers = [
        {
            rgb: {r: 208, g: 208, b: 208},
            towns: []
        },
        {
            rgb: trainingPlayerColor(1),
            towns: [],
            ai: true,
            units: stageGUnitsFromCoords(
                playerOneCoords,
                includeArcher && archerPlayer == 1,
                includeKOHb && KOHbPlayer == 1,
                includeNormchel && normchelPlayer == 1)
        },
        {
            rgb: trainingPlayerColor(2),
            towns: [],
            ai: true,
            units: stageGUnitsFromCoords(
                playerTwoCoords,
                includeArcher && archerPlayer == 2,
                includeKOHb && KOHbPlayer == 2,
                includeNormchel && normchelPlayer == 2)
        }
    ]
    let map = new GameMap(
        mapSize,
        generatedPlayers,
        [],
        [],
        [])
    map.suddenDeathRound = 10
    map.combatStage = 'G'
    map.combatStageProgress = progress
    map.combatOnly = true
    map.playerNoobCounts = {
        playerOne: generatedPlayers[1].units.filter(function(unit) {
            return unit.type == Noob
        }).length,
        playerTwo: generatedPlayers[2].units.filter(function(unit) {
            return unit.type == Noob
        }).length
    }
    map.playerNormchelCounts = {
        playerOne: generatedPlayers[1].units.filter(function(unit) {
            return unit.type == Normchel
        }).length,
        playerTwo: generatedPlayers[2].units.filter(function(unit) {
            return unit.type == Normchel
        }).length
    }
    map.playerKOHbCounts = {
        playerOne: generatedPlayers[1].units.filter(function(unit) {
            return unit.type == KOHb
        }).length,
        playerTwo: generatedPlayers[2].units.filter(function(unit) {
            return unit.type == KOHb
        }).length
    }
    map.playerArcherCounts = {
        playerOne: generatedPlayers[1].units.filter(function(unit) {
            return unit.type == Archer
        }).length,
        playerTwo: generatedPlayers[2].units.filter(function(unit) {
            return unit.type == Archer
        }).length
    }
    map.combatMetrics = {
        newlyUnlockedMechanic: 'Archer',
        unlockedUnitType: 'Archer',
        previouslyUnlockedUnitTypes: ['Noob', 'Normchel', 'KOHb'],
        actionEnumerationMechanics: [
            'Archer range attacks',
            'Archer line-of-sight checks'
        ],
        archerRange: 2
    }
    map.economyObjects = {
        farms: 0,
        barracks: 0,
        goldmines: 0,
        towns: 0,
        productionActions: 0,
        resources: 0
    }
    return map
}

function generateTinyMapAllUnits() {

    let mapSize = {x: 9, y: 9}

    let units1 = []
    let units2 = []

    let units_arrays = [units1, units2]
    let types = [Noob, Archer, KOHb, Normchel, Catapult]
    for (let k = 0; k < units_arrays.length; ++k) {
        for (let i = 0; i < types.length; ++i) {
            units_arrays[k].push({
                type: types[i],
                x: 1 + i,
                y: k == 0 ? 1 : mapSize.y - 2
            })
        }
    }
    return new Map(
        mapSize,
        [
            {
                rgb: {r: 208, g: 208, b: 208},
                towns: []
            },
            {
                rgb: {r: 255, g: 0, b: 0},
                towns: [],
                ai: true,
                units: units1
            },
            {
                rgb: {r: 98, g: 168, b: 222},
                towns: [],
                units: units2,
                ai: true
            }
        ],
        [],
        [],
        [])
}

function generateBrowserPlayAiCombatMap() {
    let mapSize = {x: 9, y: 9}
    let unitTypes = [Noob, Normchel, KOHb, Archer, Catapult]
    let humanUnits = []
    let aiUnits = []

    for (let i = 0; i < unitTypes.length; ++i) {
        humanUnits.push({
            type: unitTypes[i],
            x: 2 + i,
            y: 1
        })
        aiUnits.push({
            type: unitTypes[i],
            x: 2 + i,
            y: mapSize.y - 2
        })
    }

    let map = new GameMap(
        mapSize,
        [
            {
                rgb: {r: 208, g: 208, b: 208},
                towns: []
            },
            {
                rgb: {r: 255, g: 0, b: 0},
                towns: [],
                units: humanUnits
            },
            {
                rgb: {r: 98, g: 168, b: 222},
                playerType: 'AIPlayer',
                towns: [],
                units: aiUnits
            }
        ],
        [],
        [],
        [])
    map.playAiMode = 'browser-combat-playtest'
    map.economyObjects = {
        farms: 0,
        barracks: 0,
        goldmines: 0,
        towns: 0,
        productionActions: 0,
        resources: 0
    }
    map.requiredCombatUnitTypes = [
        'Noob',
        'Normchel',
        'KOHb',
        'Archer',
        'Catapult'
    ]
    return map
}

function generateTinyMap() {

    let mapSize = {x: randomInt(3, 5), y: randomInt(3, 5)}

    let units1 = []
    let units2 = []

    let units_arrays = [units1, units2]
    let unitsCount = randomInt(2, 3)
    for (let i = 0; i < unitsCount; ++i) {
        for (let k = 0; k < units_arrays.length; ++k) {
            let unit = {type: Noob, x: randomInt(0, mapSize.x - 1), y: randomInt(0, mapSize.y - 1)}
            if (hasSuchCoord(units1, unit) || hasSuchCoord(units2, unit)) {
                continue
            }
            units_arrays[k].push(unit)
        }
    }
    return new Map(
        mapSize,
        [
            {
                rgb: {r: 208, g: 208, b: 208},
                towns: []
            },
            {
                rgb: {r: 255, g: 0, b: 0},
                towns: [],
                ai: !gameSettings.testAI,
                units: units1
            },
            {
                rgb: {r: 98, g: 168, b: 222},
                towns: [],
                units: units2,
                ai: true
            }
        ],
        [],
        [],
        [])
}


function generateTinyMapLegacy() {
    let noob1 = [{type: Noob, x: randomInt(0, 2), y: randomInt(0, 2)}]
    let noob2 = [{type: Noob, x: randomInt(0, 2), y: randomInt(0, 2)}]
    if (areCoordsEqual(noob1[0], noob2[0])) {
        return generateTinyMapLegacy()
    }
    return new Map(
        {x: 3, y: 3},
        [
            {
                rgb: {r: 208, g: 208, b: 208},
                towns: []
            },
            {
                rgb: {r: 255, g: 0, b: 0},
                towns: [],
                ai: true,
                units: noob1
            },
            {
                rgb: {r: 98, g: 168, b: 222},
                towns: [],
                units: noob2,
                ai: true
            }
        ],
        [],
        [],
        [])
}



function generateTinyMapLessHP() {
    let noob1 = [{type: Noob, x: randomInt(0, 2), y: randomInt(0, 2)}]
    let noob2 = [{type: Noob, x: randomInt(0, 2), y: randomInt(0, 2)}]
    if (areCoordsEqual(noob1[0], noob2[0])) {
        noob2 = []
    }
    else {
        noob2[0]['hp'] = 1
    }
    return new Map(
        {x: 3, y: 3},
        [
            {
                rgb: {r: 208, g: 208, b: 208},
                towns: []
            },
            {
                rgb: {r: 255, g: 0, b: 0},
                towns: [],
                ai: true,
                units: noob1
            },
            {
                rgb: {r: 98, g: 168, b: 222},
                towns: [],
                units: noob2,
                ai: true
            }
        ],
        [],
        [],
        [])
}

function generateTinyMapOnlyRed() {
    return new Map(
        {x: 3, y: 3},
        [
            {
                rgb: {r: 208, g: 208, b: 208},
                towns: []
            },
            {
                rgb: {r: 255, g: 0, b: 0},
                towns: [],
                ai: true,
                units: [{type: Noob, x: randomInt(0, 2), y: randomInt(0, 2)}]
            },
            {
                rgb: {r: 98, g: 168, b: 222},
                towns: [],
                units: [],
                ai: true
            }
        ],
        [],
        [],
        [])
}

function generateTinyOnlyBlue() {
    return new Map(
        {x: 3, y: 3},
        [
            {
                rgb: {r: 208, g: 208, b: 208},
                towns: []
            },
            {
                rgb: {r: 255, g: 0, b: 0},
                towns: [],
                ai: true,
                units: []
            },
            {
                rgb: {r: 98, g: 168, b: 222},
                towns: [],
                units: [{type: Noob, x: randomInt(0, 2), y: randomInt(0, 2)}],
                ai: true
            }
        ],
        [],
        [],
        [])
}
