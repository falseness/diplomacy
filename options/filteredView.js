// Per-player fog and filtered board views (artifacts/actions_feature_prd.txt sec. 6.3, 7.3, 7.5 groundwork).
//
//   computeFogFor(playerIndex)            -> fog grid ([x][y] counts, > 0 = visible) of ANY player, the same mask
//                                            Player.changeFogOfWarByVision builds (co-op humans share the vision of
//                                            their allied humans; isAlwaysVisible cells count 1), without touching
//                                            grid.fogOfWar of the current viewer. Fog of war off -> every cell 1.
//   filteredView(playerIndex, knownCells) -> a board in the getGameObject() shape holding only what the player may
//                                            know: known = cells visible in computeFogFor(playerIndex), the given
//                                            knownCells ([{x, y}], e.g. revealableByOneAction) and the cells of the
//                                            player's own units. Grid colours of other cells are null; units, towns
//                                            (and their suburbs / buildings / pending buildings), external,
//                                            externalProduction and goldmines only on known cells; gold and timer
//                                            only the player's own (others null); no nature (see terrainView);
//                                            plus hiddenInfo: true, viewer, status {ended, lostPlayers, round} and
//                                            hiddenTownParts [{player, suburbs, buildings, buildingProduction}]: the
//                                            known parts of towns standing on unknown cells (no town coord).
//   terrainView()                         -> {nature}: the public terrain, sent once (sec. 6.3).
//   boardFromFilteredView(view, terrain)  -> a board loadFromJson accepts: unknown colours neutral (0), hidden gold
//                                            0, hidden timers a copy of the viewer's, terrain's nature;
//                                            hiddenTownParts are dropped (a town object needs its coord).
//   terrainChanges(baseNature, nature)    -> [{x, y, nature}]: nature (a packed board's list) as cell changes against
//                                            baseNature (the terrain sent once, game:terrain): nature null = the
//                                            cell's entity is gone (a destroyed bush), else the cell's entity now (a
//                                            sudden-death sea). Base entities stay in base order; the changed ones
//                                            follow in nature's order, so boardWithTerrain rebuilds nature exactly.
//   boardWithTerrain(board, terrain)      -> board (no nature, board.terrainChanges) with terrain.nature plus those
//                                            changes as its nature; terrainId and terrainChanges dropped.
//
// Nothing here draws or changes the board: getGameObject() is only serialized (it prunes killed entities, as every
// state hash does). Loaded after options/reveal.js in index.html and server/loadGameCode.js.

function computeFogFor(playerIndex) {
    let n = grid.arr.length
    let m = grid.arr[0].length
    let player = players[playerIndex]
    if (!isFogOfWar || !grid.visionWay || !player) {
        let all = []
        grid.fullInitArr(n, m, all, player ? 1 : 0)
        return all
    }
    let viewerFog = grid.fogOfWar
    try {
        player.changeFogOfWarByVision()
        return grid.fogOfWar
    } finally {
        grid.fogOfWar = viewerFog
    }
}

function terrainView() {
    return {nature: JSON.parse(JSON.stringify(getGameObject().nature))}
}

function terrainCellKey(entity) {
    return entity.coord.x + ',' + entity.coord.y
}

function terrainChanges(baseNature, nature) {
    let current = new Map(nature.map(entity => [terrainCellKey(entity), JSON.stringify(entity)]))
    // Base entities still on the board unchanged, in base order; nature keeps the longest prefix of them.
    let kept = baseNature.filter(entity => current.get(terrainCellKey(entity)) === JSON.stringify(entity))
    let prefix = 0
    while (prefix < kept.length && prefix < nature.length &&
            JSON.stringify(nature[prefix]) === JSON.stringify(kept[prefix]))
        ++prefix
    let changes = nature.slice(prefix).map(entity => ({x: entity.coord.x, y: entity.coord.y,
        nature: JSON.parse(JSON.stringify(entity))}))
    // Every other base cell is gone: neither kept in the prefix nor re-sent in the changes.
    let named = new Set(kept.slice(0, prefix).map(terrainCellKey).concat(changes.map(change => change.x + ',' + change.y)))
    for (let entity of baseNature)
        if (!named.has(terrainCellKey(entity)))
            changes.push({x: entity.coord.x, y: entity.coord.y, nature: null})
    return changes
}

function boardWithTerrain(board, terrain) {
    let changes = board.terrainChanges || []
    let changed = new Set(changes.map(change => change.x + ',' + change.y))
    let merged = Object.assign({}, board)
    merged.nature = terrain.nature.filter(entity => !changed.has(terrainCellKey(entity)))
        .concat(changes.filter(change => change.nature).map(change => change.nature))
    delete merged.terrainChanges
    delete merged.terrainId
    return merged
}

function filteredView(playerIndex, knownCells = []) {
    let n = grid.arr.length
    let m = grid.arr[0].length
    let fog = computeFogFor(playerIndex)
    let known = new Uint8Array(n * m)
    let mark = coord => {
        if (coord && !isCoordNotOnMap(coord, n, m))
            known[coord.x * m + coord.y] = 1
    }
    for (let x = 0; x < n; ++x)
        for (let y = 0; y < m; ++y)
            if (fog[x][y] > 0)
                known[x * m + y] = 1
    for (let coord of knownCells || [])
        mark(coord)
    let full = JSON.parse(JSON.stringify(getGameObject()))
    let own = full.players[playerIndex]
    if (own)
        own.units.forEach(unit => mark(unit.coord))
    let isKnown = coord => Boolean(coord) && !isCoordNotOnMap(coord, n, m) && known[coord.x * m + coord.y] === 1
    let onKnown = entity => isKnown(entity.coord)

    let view = {}
    view.grid = full.grid.map((column, x) => column.map((colour, y) => known[x * m + y] ? colour : null))
    let knownParts = town => ({
        buildings: town.buildings.filter(onKnown),
        buildingProduction: town.buildingProduction.filter(onKnown),
        suburbs: town.suburbs.filter(isKnown)
    })
    view.hiddenTownParts = []
    view.players = full.players.map((packed, i) => {
        let res = Object.assign({}, packed)
        res.gold = i === playerIndex ? packed.gold : null
        res.units = packed.units.filter(onKnown)
        res.towns = packed.towns.filter(onKnown).map(town => Object.assign({}, town, knownParts(town)))
        for (let town of packed.towns.filter(town => !onKnown(town))) {
            let parts = knownParts(town)
            if (parts.buildings.length || parts.buildingProduction.length || parts.suburbs.length)
                view.hiddenTownParts.push(Object.assign({player: i}, parts))
        }
        return res
    })
    view.external = full.external.filter(onKnown)
    view.externalProduction = full.externalProduction.filter(onKnown)
    view.goldmines = full.goldmines.filter(onKnown)
    view.timers = full.timers.map((packed, i) => i === playerIndex ? packed : null)
    view.whooseTurn = full.whooseTurn
    view.gameRound = full.gameRound
    view.isFogOfWar = full.isFogOfWar
    view.gameSettings = full.gameSettings
    view.hiddenInfo = true
    view.viewer = playerIndex
    view.status = filteredViewStatus()
    return view
}

// Game end and lost players as the server sees them (the client cannot compute them from a partial board).
// Reads coopResult / isLost directly: players[0].isGameEnded would write gameSettings.coop.result.
function filteredViewStatus() {
    let lostPlayers = []
    for (let i = 1; i < players.length; ++i)
        if (players[i].isLost)
            lostPlayers.push(i)
    let ended = gameSettings.coop ? players[0].coopResult !== null :
        players.slice(1).every(player => player.isLost)
    let status = {ended: ended, lostPlayers: lostPlayers, round: gameRound}
    if (gameSettings.coop)
        status.coopResult = players[0].coopResult
    return status
}

function boardFromFilteredView(view, terrain) {
    let board = JSON.parse(JSON.stringify(view))
    board.grid = board.grid.map(column => column.map(colour => colour === null ? 0 : colour))
    board.players.forEach(packed => {
        if (packed.gold === null)
            packed.gold = 0
    })
    let ownTimer = board.timers[view.viewer]
    board.timers = board.timers.map(packed => packed === null ? JSON.parse(JSON.stringify(ownTimer)) : packed)
    board.nature = JSON.parse(JSON.stringify(terrain.nature))
    delete board.hiddenInfo
    delete board.hiddenTownParts
    delete board.viewer
    delete board.status
    return board
}
