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
