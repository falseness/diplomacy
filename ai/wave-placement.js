// Placement is round-local: unavailable entries are discarded, never queued.
// The round controller owns when to call this; placement does not advance turns.
function placeCoopWave(wave) {
    const coop = gameSettings.coop
    if (!coop || players[coop.demonSlot].role !== 'DEMONS')
        throw new Error('Wave placement requires co-op')
    const constructors = {bombard: Bombard, imp: Imp, clawling: Clawling, hound: Hound,
        brute: Brute, bulwark: Bulwark, spitter: Spitter,
        emberArcher: EmberArcher, hexcaster: Hexcaster, ravager: Ravager, demonLord: DemonLord}
    const seen = new Set()
    if (!wave || !Array.isArray(wave.selections) || wave.selections.some(entry => {
        if (!entry || !Number.isInteger(entry.x) || !Number.isInteger(entry.y) ||
            !Object.prototype.hasOwnProperty.call(constructors, entry.type)) return true
        const key = `${entry.x},${entry.y}`
        if (seen.has(key)) return true
        seen.add(key)
        return false
    })) throw new RangeError('Invalid wave selections')
    const spawned = []
    for (const {x, y, type} of wave.selections) {
        if (isCoordNotOnMap({x, y}, grid.arr.length, grid.arr[0].length)) continue
        const cell = grid.getCell({x, y})
        const portal = cell.building
        // Revalidate selections at construction time: a stale selection must
        // never replace a unit, a removed portal, or flooded terrain.
        if (!portal.isDemonPortal || portal.killed || portal.hp <= 0 ||
            portal.playerColor !== coop.demonSlot || !external.includes(portal) ||
            !cell.unit.isEmpty()) continue
        // Establish coordinate ownership before Unit registers with its player.
        // Only a validated portal can reach this boundary, never a human asset.
        cell.hexagon.repaint(coop.demonSlot, false)
        new constructors[type](x, y)
        spawned.push({type, x, y})
    }
    return {spawned, skipped: wave.selections.length - spawned.length}
}

function spawnCoopWave(round) {
    return placeCoopWave(generateCoopWave(round))
}
