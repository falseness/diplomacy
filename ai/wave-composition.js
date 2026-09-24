function generateCoopWave(round) {
    const coop = gameSettings.coop
    if (!coop || !coop.generation || coop.generation.version !== 4)
        throw new Error('Unsupported co-op generation version')
    // Destroyed portals leave external; occupied portals skip this round only.
    const portals = external.filter(portal => portal.isDemonPortal && !portal.killed &&
        portal.hp > 0 && portal.playerColor === coop.demonSlot &&
        grid.getBuilding(portal.coord) === portal && grid.getUnit(portal.coord).isEmpty())
        .map(portal => ({x: portal.coord.x, y: portal.coord.y, category: portal.category}))
    isCoopTypedWaveRound(round)
    const last = coop.typedWaves ? coop.typedWaves.lastRound : 0
    if (round <= last) return {round, types: [], selections: []}
    const wave = composeTypedCoopWave(round, portals)
    coop.typedWaves = {lastRound: round}
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

if (typeof module !== 'undefined' && module.exports) module.exports = {composeTypedCoopWave}
