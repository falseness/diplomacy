let players = []
let external = []
let externalProduction = []
let nature = []
let goldmines = []
let grid
let mapBorder
let gameExit = false

let gameRound
let suddenDeathRound = 30
let gameSettings = {
    'isOnline': false
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

