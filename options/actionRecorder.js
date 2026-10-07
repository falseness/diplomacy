// Action recorder and state hash for action-based play (artifacts/actions_feature_prd.txt sec. 4.2, 4.3).
//
// State hash: sha256 (options/sha256.js) of JSON.stringify(getGameObject()) without the wall-clock
// `timers` field. getGameObject() mutates state (drops killed entities, updates the players' lists), so
// the hash is always taken through it, on the client and on a replaying server alike.
//
// Recorder: every successful human action of the current turn, in the action schema of
// options/actionApi.js, each with the state hash after it:
//   actionLog.current() -> {player, round, actions: [{action, hash}, ...]} | null
// Hooks (each runs once per successful action, "successful" = an undo entry was pushed, as applyAction
// decides it): Events.sendInstructions (unit / build), prepareEvent (train), destroySelected (destroy),
// skipMovesOfSelected (skip), AiRuntime.undoHumanCommand (undo, when actionManager.undo() undid something)
// and nextTurn (end, on a human player's turn). The log is cleared with actionManager in nextTurn.js; the
// turn it held stays readable as actionLog.lastTurn() until the next turn ends. Not persisted yet.
//
// Loaded after options/actionApi.js (index.html, server/loadGameCode.js); game globals resolve at call time.

// The JSON the state hash is taken of (exposed for debugging hash mismatches).
function stateJsonForHash() {
    let game = getGameObject()
    let state = {}
    for (let key of Object.keys(game)) {
        if (key !== 'timers')
            state[key] = game[key]
    }
    return JSON.stringify(state)
}

function stateHash() {
    return sha256Hex(stateJsonForHash())
}

const actionLog = {
    turn: null,
    finished: null,
    // turnInfo: {player, round}
    start(turnInfo) {
        this.turn = {player: turnInfo.player, round: turnInfo.round, actions: []}
    },
    push(action, hashAfter) {
        if (!this.turn)
            this.start({player: whooseTurn, round: gameRound})
        this.turn.actions.push({action: action, hash: hashAfter})
    },
    current() {
        return this.turn
    },
    // The turn the last clear() closed, if it recorded anything.
    lastTurn() {
        return this.finished
    },
    clear() {
        if (this.turn && this.turn.actions.length)
            this.finished = this.turn
        this.turn = null
    },
    // A new game: nothing of the previous one stays readable.
    reset() {
        this.turn = null
        this.finished = null
    }
}

const ActionRecorder = {
    copyCoord(coord) {
        return {x: coord.x, y: coord.y}
    },
    // Appends a successful human action with the hash of the state it produced.
    record(action) {
        actionLog.push(action, stateHash())
    },
    // Runs a UI entry point; records `action` when the call pushed an undo entry. Returns its result.
    track(action, execute) {
        let previous = actionManager.lastAction
        let result = execute()
        if (action && actionManager.lastAction !== previous)
            ActionRecorder.record(action)
        return result
    },
    // The action a map click with `selected` on `coord` is: a unit's move/attack or a town's placement.
    instructionAction(selected, coord) {
        if (!selected || !selected.coord || typeof selected.notEmpty !== 'function' || !selected.notEmpty())
            return null
        if (selected.isUnit) {
            let expect = {name: selected.name}
            if (selected.id !== undefined)
                expect.id = selected.id
            return {t: 'unit', from: ActionRecorder.copyCoord(selected.coord), to: ActionRecorder.copyCoord(coord),
                expect: expect}
        }
        let production = selected.activeProduction
        if (typeof selected.isTown === 'function' && selected.isTown() && production &&
                typeof production.isUnitProduction === 'function' && !production.isUnitProduction()) {
            return {t: 'build', producer: ActionRecorder.copyCoord(selected.coord), product: production.name,
                at: ActionRecorder.copyCoord(coord)}
        }
        return null
    },
    trainAction(producer, product) {
        return {t: 'train', producer: ActionRecorder.copyCoord(producer.coord), product: product}
    },
    destroyAction(entity) {
        return {t: 'destroy', at: ActionRecorder.copyCoord(entity.coord), layer: 'building'}
    },
    skipAction(unit) {
        return {t: 'skip', at: ActionRecorder.copyCoord(unit.coord)}
    },
    // The end of a human player's turn (AI, neutral and demon turns are not human actions).
    recordEnd() {
        if (gameExit || !players || !players[whooseTurn] ||
                (typeof gameEvent !== 'undefined' && gameEvent && gameEvent.waitingMode))
            return
        let player = players[whooseTurn]
        if (player.constructor !== Player || player.isLost)
            return
        let hash = stateHash()
        actionLog.push({t: 'end', hash: hash}, hash)
    }
}
