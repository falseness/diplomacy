function getGameObject() {
    let timers = Array(players.length)
    for (let i = 0; i < players.length; ++i) {
        timers[i] = JSON.parse(unpacker.getPlayerTimerByIndex(i))
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
    let game = JSON.parse(game_string)
    for (let i = 0; i < game.players.length; ++i) {
        unpacker.setPlayerTimerByIndex(i, game.timers[i])
    }

    unpacker.unpackAll(JSON.stringify(game.grid), JSON.stringify(game.players), JSON.stringify(game.external), 
        JSON.stringify(game.externalProduction),  JSON.stringify(game.nature),  JSON.stringify(game.goldmines),
        JSON.stringify(game.timers[game.whooseTurn]), JSON.stringify(game.whooseTurn), JSON.stringify(game.gameRound),
        JSON.stringify(game.isFogOfWar), 'gameSettings' in game ? JSON.stringify(game.gameSettings) : null)
}

