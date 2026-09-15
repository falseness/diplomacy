let players = []
let external = []
let externalProduction = []
let nature = []
let goldmines = []
let grid
let mapBorder
let gameExit = false

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
// Rendering and input read gameSettings.interface every frame. Settings from
// older saves, received boards or a failed restore may omit it or the flag.
function normalizeInterfaceSettings(settings) {
    if (!settings.interface || typeof settings.interface !== 'object')
        settings.interface = {}
    if (settings.interface.drawChanceOfWinningText === undefined)
        settings.interface.drawChanceOfWinningText = false
    return settings
}
let unsafeVariablePassword = 'error'

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
        unsafeVariablePassword,
        whooseTurn,
        isFogOfWar,
        debug,
        gameSlot
    }
}
