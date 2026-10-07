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
        'gameSettings': gameSettings
    }
}

function loadFromJson(game_string) {
    loadFromObject(JSON.parse(game_string))
}

// loadFromJson(JSON.stringify(game)) without the whole-board round trip: unpackAll serializes each part itself, so
// the runtime never keeps a reference into game. game is a plain (JSON-shaped) board.
function loadFromObject(game) {
    // A hole in the timers array is null after a JSON round trip.
    const packedTimer = i => game.timers[i] === undefined && i < game.timers.length ? null : game.timers[i]
    unpacker.unpackAll(JSON.stringify(game.grid), JSON.stringify(game.players), JSON.stringify(game.external),
        JSON.stringify(game.externalProduction),  JSON.stringify(game.nature),  JSON.stringify(game.goldmines),
        JSON.stringify(packedTimer(game.whooseTurn)), JSON.stringify(game.whooseTurn), JSON.stringify(game.gameRound),
        JSON.stringify(game.isFogOfWar),
        'gameSettings' in game && game.gameSettings !== undefined ? JSON.stringify(game.gameSettings) : null)
    // After unpackAll, which picks the timers' storage slot (gameStorageSlot) for this board.
    for (let i = 0; i < game.players.length; ++i) {
        unpacker.setPlayerTimerByIndex(i, packedTimer(i))
    }
    // An authoritative online snapshot (co-op or competitive, incl. a reconnect/Retry reload) starts a new
    // undo scope: entries recorded on the old board would re-create units the reloaded board already has.
    // Stale/equal network deliveries are rejected before reaching this loader; a continued co-op turn
    // restores its own undo history after this call (onlineLogic receiveBoard).
    if (gameSettings.isOnline) actionManager.clear()
}
