// 'create game' of the online hub (server/docs/auth-lobby-protocol.md 3.2): the
// start options chosen on the create-lobby screen and the lobby:create error texts.
// No canvas, maps or DOM here; menu/menu.js builds the board from these options.

// controls: {isCoop, fogOfWar, mapKey, variantIndex (competitive players slider
// index), humans, seed, size (co-op slider values)}.
// selectedMap names what GameManager.start receives: a competitive variant
// maps[mapName][variantIndex] or generateCoopGame(humans, {seed, size}).
function createLobbyStartOptions(controls) {
    const fog = !!controls.fogOfWar
    if (controls.isCoop) {
        const coop = {humans: controls.humans, seed: controls.seed, size: String(controls.size).toLowerCase()}
        return {mode: 'coop', mapName: null, players: coop.humans, fog, isOnline: true, coop,
            selectedMap: {coop: {...coop}}}
    }
    const variantIndex = controls.variantIndex
    return {mode: 'competitive', mapName: controls.mapKey, players: variantIndex + 2, fog, isOnline: true, coop: null,
        selectedMap: {mapName: controls.mapKey, variantIndex}}
}

// Status text for a lobby:create error code.
const CREATE_LOBBY_ERROR_TEXT = {
    ALREADY_IN_LOBBY: 'you are already in a lobby',
    INVALID_SETTINGS: 'the server rejected these settings',
    INVALID_BOARD: 'the server rejected this map',
    UNAUTHENTICATED: 'signed out, sign in again',
    TIMEOUT: 'no answer from the server',
}
function createLobbyErrorText(error) {
    return CREATE_LOBBY_ERROR_TEXT[error] || 'could not create the lobby'
}
