// Placement is round-local: unavailable entries are discarded, never queued.
// The round controller owns when to call this; placement does not advance turns.
function placeCoopWave(wave) {
    const coop = gameSettings.coop
    if (!coop || players[coop.demonSlot].role !== 'DEMONS')
        throw new Error('Wave placement requires co-op')
    const constructors = {imp: Imp, clawling: Clawling, hound: Hound,
        brute: Brute, bulwark: Bulwark, spitter: Spitter,
        emberArcher: EmberArcher, hexcaster: Hexcaster, ravager: Ravager, demonLord: DemonLord}
    if (!wave || !Array.isArray(wave.types) || wave.types.some(type =>
        !Object.prototype.hasOwnProperty.call(constructors, type)))
        throw new RangeError('Invalid wave types')
    const {min, max} = COOP_WAVE_CONFIG.spawnRadius
    const candidates = new Map()
    const portals = external.filter(portal => portal.isDemonPortal && !portal.killed &&
        portal.hp > 0 && portal.playerColor === coop.demonSlot &&
        grid.getBuilding(portal.coord) === portal)
    for (const portal of portals) {
        // Traverse geometric neighbours even across obstacles: proximity is hex
        // distance, not movement-path distance. Check terrain only at destinations.
        const queue = [{coord: portal.coord, distance: 0}]
        const seen = new Set([`${portal.coord.x},${portal.coord.y}`])
        for (let i = 0; i < queue.length; i++) {
            const {coord, distance} = queue[i]
            const cell = grid.getCell(coord)
            if (distance >= min && cell.unit.isEmpty() && cell.building.isEmpty())
                candidates.set(`${coord.x},${coord.y}`, coord)
            if (distance === max) continue
            for (const next of cell.hexagon.neighbours) {
                const key = `${next.x},${next.y}`
                if (seen.has(key) || !grid.arr[next.x] || !grid.arr[next.x][next.y]) continue
                seen.add(key)
                queue.push({coord: next, distance: distance + 1})
            }
        }
    }
    const positions = [...candidates.values()].sort((a, b) => a.x - b.x || a.y - b.y)
    const spawned = []
    for (let i = 0; i < Math.min(wave.types.length, positions.length); i++) {
        const {x, y} = positions[i]
        const type = wave.types[i]
        new constructors[type](x, y)
        spawned.push({type, x, y})
    }
    return {spawned, skipped: wave.types.length - spawned.length}
}

function spawnCoopWave(round, seed = 0) {
    return placeCoopWave(generateCoopWave(round, seed))
}
