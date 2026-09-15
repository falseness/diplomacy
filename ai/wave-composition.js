// Each portal has its own unsigned LCG stream. Coordinates are mixed in x/y
// order, so collection order, other portals and human count cannot affect it.
function composeCoopWave(seed, round, initialHumanCount, portals = [], balanceVersion = 1) {
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff)
        throw new RangeError('Invalid wave seed')
    const rules = typeof module !== 'undefined' && module.exports ? require('./wave-config') :
        {getCoopWaveConfig, getUnlockedCoopDemonTypes}
    const config = rules.getCoopWaveConfig(balanceVersion)
    if (!Number.isInteger(initialHumanCount) || initialHumanCount < config.minInitialHumans ||
        initialHumanCount > config.maxInitialHumans) throw new RangeError('Invalid initial human count')
    const unlocked = rules.getUnlockedCoopDemonTypes(round, balanceVersion)
    const seen = new Set()
    if (!Array.isArray(portals)) throw new RangeError('Invalid wave portals')
    for (const portal of portals) {
        if (!portal || !Number.isInteger(portal.x) || portal.x < 0 || portal.x > 0xffffffff ||
            !Number.isInteger(portal.y) || portal.y < 0 || portal.y > 0xffffffff ||
            seen.has(`${portal.x},${portal.y}`)) throw new RangeError('Invalid wave portal identity')
        seen.add(`${portal.x},${portal.y}`)
    }
    const selections = []
    const total = unlocked.reduce((sum, id) => sum + config.types[id].weight, 0)
    if (total) for (const {x, y} of [...portals].sort((a, b) => a.x - b.x || a.y - b.y)) {
        let random = (seed ^ Math.imul(round, 2654435761)) >>> 0
        random = (Math.imul(random ^ x, 1664525) + 1013904223) >>> 0
        random = (Math.imul(random ^ y, 1664525) + 1013904223) >>> 0
        let ticket = random / 4294967296 * total
        for (const type of unlocked) {
            ticket -= config.types[type].weight
            if (ticket < 0) {
                selections.push({x, y, type})
                break
            }
        }
    }
    return {round, types: selections.map(entry => entry.type), selections}
}

// Selection is pure. This adapter persists the seed/round through the existing
// gameSettings serialization boundary, including legacy version-1 saved seeds.
function generateCoopWave(round, seed = 0) {
    const coop = gameSettings.coop
    if (!coop) throw new Error('Wave generation requires co-op')
    // Destroyed portals leave external; occupied portals skip this round only.
    const portals = external.filter(portal => portal.isDemonPortal && !portal.killed &&
        portal.hp > 0 && portal.playerColor === coop.demonSlot &&
        grid.getBuilding(portal.coord) === portal && grid.getUnit(portal.coord).isEmpty())
        .map(portal => ({x: portal.coord.x, y: portal.coord.y, category: portal.category}))
    // Version-4 maps have typed portals: every portal produces together on the
    // shared four-round schedule. The dispatcher completes each round once, so a
    // repeated or stale round is a no-op and a skipped portal accrues no backlog.
    if (coop.generation && coop.generation.version === 4) {
        isCoopTypedWaveRound(round)
        const last = coop.typedWaves ? coop.typedWaves.lastRound : 0
        if (round <= last) return {round, types: [], selections: []}
        const wave = composeTypedCoopWave(round, portals)
        coop.typedWaves = {lastRound: round}
        return wave
    }
    const saved = coop.waveGeneration || {version: 1, seed, lastRound: 0}
    if (saved.version !== 1) throw new RangeError('Unsupported wave generation version')
    const wave = composeCoopWave(saved.seed, round, coop.initialHumanCount,
        portals.map(({x, y}) => ({x, y})), coop.balanceVersion ?? 1)
    coop.waveGeneration = {version: 1, seed: saved.seed, lastRound: round}
    return wave
}

// Typed replacement for seeded sampling: each portal's type depends only on its
// category and the absolute completed round. Placement does not need a seed.
function composeTypedCoopWave(round, portals = []) {
    const rules = typeof module !== 'undefined' && module.exports ? require('./wave-config') :
        {isCoopTypedWaveRound, getCoopScheduledDemonType}
    rules.isCoopTypedWaveRound(round)
    if (!Array.isArray(portals)) throw new RangeError('Invalid wave portals')
    const seen = new Set()
    const selections = []
    for (const portal of portals) {
        if (!portal || !Number.isInteger(portal.x) || portal.x < 0 || portal.x > 0xffffffff ||
            !Number.isInteger(portal.y) || portal.y < 0 || portal.y > 0xffffffff ||
            seen.has(`${portal.x},${portal.y}`)) throw new RangeError('Invalid wave portal identity')
        seen.add(`${portal.x},${portal.y}`)
        const type = rules.getCoopScheduledDemonType(portal.category, round)
        if (type) selections.push({x: portal.x, y: portal.y, type})
    }
    selections.sort((a, b) => a.x - b.x || a.y - b.y)
    return {round, types: selections.map(entry => entry.type), selections}
}

if (typeof module !== 'undefined' && module.exports) module.exports = {composeCoopWave, composeTypedCoopWave}
