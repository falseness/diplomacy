let players = []
let external = []
let externalProduction = []
let nature = []
let goldmines = []
let grid
let mapBorder
let gameExit = false
// The loaded board is partial (board.hiddenInfo): see loadFromJson.
let hiddenInfo = false
// The server's game status of a partial board (board.status): see hiddenGameStatus.
let hiddenStatus = null

let gameRound
let suddenDeathRound = 40
let gameSettings = {
    isOnline: false,
    withAI: false,
    testAI: false,
    // Browser Play AI ships with a trained, current-vector-schema checkpoint.
    // Tests and development builds may still override this with ?aiModelUrl=.
    aiModelUrl: 'models/play-ai/model.json',
    interface: {
        drawChanceOfWinning: false
    }
}
// Settings from older saves, received boards or a failed restore may omit
// gameSettings.interface. The debug overlay flag (I key) is client-only UI
// state on the grid; a stale copy from older saves is dropped so it is never
// saved or sent with the board again.
function normalizeInterfaceSettings(settings) {
    if (!settings.interface || typeof settings.interface !== 'object')
        settings.interface = {}
    delete settings.interface.drawChanceOfWinningText
    return settings
}
// Fogged landmarks (goldmines, live portals, neutral towns) are drawn in
// competitive and co-op games. Saves and boards without an explicit boolean
// get true; an explicit stored boolean is kept.
function normalizeFogLandmarkSettings(settings) {
    if (typeof settings.drawFogLandmarks !== 'boolean')
        settings.drawFogLandmarks = true
    return settings
}

let whooseTurn
let isFogOfWar = true

let debug = false
let gameSlot = 0

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        players,
        external,
        externalProduction,
        nature,
        goldmines,
        grid,
        mapBorder,
        gameExit,
        gameRound,
        suddenDeathRound,
        gameSettings,
        whooseTurn,
        isFogOfWar,
        debug,
        gameSlot
    }
}
