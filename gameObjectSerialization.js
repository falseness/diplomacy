function removeFromArrayIfKilled(array) {
    for (let i = 0; i < array.length; ++i) {
        if (array[i].killed) {
            console.log('removed from array if killed', array[i])
            array.splice(i--, 1)
            continue
        }
    }
}

function getGameObject() {
    let timers = Array(players.length)
    for (let i = 0; i < players.length; ++i) {
        timers[i] = JSON.parse(unpacker.getPlayerTimerByIndex(i))
    }
    removeFromArrayIfKilled(external)
    removeFromArrayIfKilled(externalProduction)
    removeFromArrayIfKilled(nature)
    for (let i = 0; i < players.length; ++i) {
        players[i].updateUnits()
        players[i].updateTowns()
    }
    return {
        'grid': grid,
        'players': players,
        'external': external,
        'externalProduction': externalProduction,
        'nature': nature,
        'goldmines': goldmines,
        'timers': timers,
        'whooseTurn': whooseTurn,
        'gameRound': gameRound,
        'isFogOfWar': isFogOfWar,
        'gameSettings': gameSettings,
        // Only partial boards carry the keys, so full boards serialize unchanged.
        ...(hiddenInfo ? {'hiddenInfo': true} : {}),
        ...(hiddenInfo && hiddenStatus ? {'status': hiddenStatus} : {})
    }
}

// The game status of a hidden-information board: the partial entity lists cannot tell game end,
// lost players or the winner, so the server sends them (board.status {ended, result, lostPlayers, winner, round}).
function hiddenGameStatus() {
    const status = hiddenStatus || {}
    return {
        ended: status.ended === true,
        result: typeof status.result === 'string' ? status.result : null,
        lostPlayers: Array.isArray(status.lostPlayers) ? status.lostPlayers.filter(Number.isInteger) : [],
        winner: Number.isInteger(status.winner) ? status.winner : null,
        round: Number.isInteger(status.round) ? status.round : gameRound,
    }
}

// The end-of-game banner text of a hidden-information board, or null while it goes on.
function hiddenGameEndText() {
    if (!hiddenInfo) return null
    const status = hiddenGameStatus()
    if (!status.ended) return null
    if (gameSettings.coop) return null // the co-op banner shows gameSettings.coop.result
    return status.winner !== null ? 'Game over — Player ' + status.winner + ' wins' : 'Game over'
}

// Contents for unknown cells of a hidden-information board (PRD 7.3-7.4), e.g. the answer to
// onLoadingCellsNeeded: [{x, y, colour, isSuburb?, building?, unit?}], building and unit packed
// as in a board (a town as in players[i].towns, a goldmine as in goldmines). A filled cell is a
// normal cell from then on (known contents, no longer loading); known cells are left alone.
// Returns the number of cells filled.
function markCellsKnown(cells) {
    let filled = 0
    for (const cell of cells) {
        const hexagon = grid.arr[cell.x][cell.y].hexagon
        if (!hexagon.unknown || !Number.isInteger(cell.colour))
            continue
        hexagon.firstpaint(cell.colour)
        hexagon.isSuburb = Boolean(cell.isSuburb)
        const building = cell.building
        if (building && building.name === 'town')
            unpacker.unpackTown(building)
        else if (building && building.name === 'goldmine')
            new Goldmine(cell.x, cell.y, building.income)
        else if (building && building.name !== 'Empty')
            unpacker.fullUnpackBuilding(building)
        if (cell.unit && cell.unit.name !== 'Empty')
            unpacker.fullUnpackUnit(cell.unit)
        ++filled
    }
    // New contents can be vision barriers or always-visible nature: recompute the fog.
    if (filled && isFogOfWar) {
        if (gameSettings.coop) refreshCoopVision()
        else players[whooseTurn].changeFogOfWarByVision()
    }
    return filled
}

function loadFromJson(game_string) {
    let game = JSON.parse(game_string)
    // A partial board: unknown cells (grid null) and partial entity lists.
    hiddenInfo = game.hiddenInfo === true
    hiddenStatus = hiddenInfo && game.status && typeof game.status === 'object' ? game.status : null
    unpacker.unpackAll(JSON.stringify(game.grid), JSON.stringify(game.players), JSON.stringify(game.external),
        JSON.stringify(game.externalProduction),  JSON.stringify(game.nature),  JSON.stringify(game.goldmines),
        JSON.stringify(game.timers[game.whooseTurn]), JSON.stringify(game.whooseTurn), JSON.stringify(game.gameRound),
        JSON.stringify(game.isFogOfWar), 'gameSettings' in game ? JSON.stringify(game.gameSettings) : null)
    // After unpackAll, which picks the timers' storage slot (gameStorageSlot) for this board.
    for (let i = 0; i < game.players.length; ++i) {
        unpacker.setPlayerTimerByIndex(i, game.timers[i])
    }
    // An authoritative online snapshot (co-op or competitive, incl. a reconnect/Retry reload) starts a new
    // undo scope: entries recorded on the old board would re-create units the reloaded board already has.
    // Stale/equal network deliveries are rejected before reaching this loader; a continued co-op turn
    // restores its own undo history after this call (onlineLogic receiveBoard).
    if (gameSettings.isOnline) actionManager.clear()
}
