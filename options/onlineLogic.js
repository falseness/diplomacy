let onlineLobby = null
let onlineSocket = null
let onlineCommit = null

function onlineLobbyText() {
    if (!gameSettings.isOnline || !onlineLobby) return ''
    const mode = onlineLobby.mode === 'coop' ? 'Co-op' : 'Competitive'
    if (onlineLobby.occupiedHumans === null) return mode + ' — finding human players…'
    return mode + ' — Humans: ' + onlineLobby.occupiedHumans + '/' + onlineLobby.humanCapacity +
        (onlineLobby.occupiedHumans === onlineLobby.humanCapacity ? ' — Full' : ' — Waiting for players')
}

let SendNextTurn


function unfreezeGame() {
    gameEvent.waitingMode = false
    timer.updateLastPause()
    nextTurnButton.highlightButton = false
    undoButton.enableClick()
    nextTurnButton.enableClick()
    nextTurnButton.setNextPlayerColor(players[whooseTurn].hexColor)
}


class OnlineLogic {
    constructor() {
        this.__playingRightNow = []
    }
    updatePlayingRightNow(playerIndex) {
        this.__playingRightNow.push(playerIndex)
    }
    isPlayingRightNow(playerIndex) {
        return this.__playingRightNow.includes(playerIndex)
    }
}

// Rebase disjoint local actions on a newer same-turn co-op view. Components
// cannot act on one another's influence area. Coordinate-keyed entity lists
// still need merging when both components insert/remove external entities.
function rebaseOnlineValue(base, local, remote) {
    const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b)
    if (equal(base, local)) return remote
    if (equal(base, remote) || equal(local, remote)) return local
    if (Array.isArray(base) && Array.isArray(local) && Array.isArray(remote)) {
        const coord = value => value && (value.coord ||
            (Number.isInteger(value.x) && Number.isInteger(value.y) ? value : null))
        if ([...base, ...local, ...remote].every(value => coord(value))) {
            const key = value => coord(value).x + ':' + coord(value).y
            const keyed = list => Object.fromEntries(list.map(value => [key(value), value]))
            const merged = rebaseOnlineValue(keyed(base), keyed(local), keyed(remote))
            return Object.values(merged)
        }
        if (base.length === local.length && base.length === remote.length)
            return base.map((value, i) => rebaseOnlineValue(value, local[i], remote[i]))
    } else if (base && local && remote && typeof base === 'object' &&
            typeof local === 'object' && typeof remote === 'object') {
        const merged = {}
        for (const key of new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)])) {
            const value = rebaseOnlineValue(base[key], local[key], remote[key])
            if (value !== undefined) merged[key] = value
        }
        return merged
    }
    // Shared fields changed by authority (for example a terminal result) win.
    return remote
}

function SetupServerCommunicationLogic(password) {
    if (onlineSocket) onlineSocket.disconnect()
    const socket = onlineSocket = io(window.DIPLOMACY_SERVER || 'wss://playdiplomacy.online:8080')
    onlineCommit = null
    // Competitive scheduling gives each player one active turn per round.
    // A waiting connection may become active in that same round when its
    // component predecessor finishes. Reconnect deliberately reloads authority.
    let competitiveDelivery = null
    let acceptedBoard = null
    function receiveBoard(body, active) {
        if (socket !== onlineSocket) return false
        const board = typeof body === 'string' ? JSON.parse(body) : body
        const commit = board.coopCommit
        if (board.gameSettings?.coop) {
            if (!commit || !Number.isSafeInteger(commit.revision) || commit.revision < 0 ||
                    typeof commit.gameID !== 'string') return false
            if (onlineCommit && (commit.gameID !== onlineCommit.gameID ||
                    commit.revision <= onlineCommit.revision)) return false
        }
        if (!board.gameSettings?.coop) {
            if (!Number.isSafeInteger(board.gameRound) || board.gameRound < 0) return false
            if (competitiveDelivery && (board.gameRound < competitiveDelivery.round ||
                    (board.gameRound === competitiveDelivery.round &&
                        (competitiveDelivery.active || !active)))) return false
        }
        const continuing = !!(board.gameSettings?.coop && acceptedBoard && active &&
            !gameEvent.waitingMode && board.gameRound === acceptedBoard.gameRound &&
            board.whooseTurn === whooseTurn && !board.gameSettings.coop.result)
        let restored = board
        let undo, selected, runningTimer
        if (continuing) {
            const local = JSON.parse(JSON.stringify(getGameObject()))
            restored = {...board}
            for (const key of ['grid', 'players', 'external', 'externalProduction', 'nature', 'goldmines'])
                restored[key] = rebaseOnlineValue(acceptedBoard[key], local[key], board[key])
            // The current turn's clock and undo scope continue across peer commits.
            restored.timers = board.timers.map((value, index) =>
                index === whooseTurn ? local.timers[index] : value)
            runningTimer = timer
            selected = gameEvent.selected.notEmpty() ? {
                coord: {...gameEvent.selected.coord}, unit: !!gameEvent.selected.isUnit
            } : null
            undo = actionManager.arr
            const lists = packed => packed.players.map(player => ({
                units: player.units.map(unit => ({...unit.coord})),
                towns: player.towns.map(town => ({...town.coord}))
            }))
            for (const action of undo) {
                action.playerEntityLists = rebaseOnlineValue(lists(acceptedBoard), action.playerEntityLists, lists(board))
                action.externalOrder = rebaseOnlineValue(acceptedBoard.external.map(e => e.coord),
                    action.externalOrder, board.external.map(e => e.coord))
            }
        }
        loadFromJson(JSON.stringify(restored))
        acceptedBoard = board
        if (continuing) {
            timer = runningTimer
            actionManager.arr = undo
            gameEvent.removeSelection()
            if (selected) {
                const entity = selected.unit ? grid.getUnit(selected.coord) : grid.getBuilding(selected.coord)
                if (entity.notEmpty()) {
                    entity.select()
                    gameEvent.selected = entity
                }
            }
        }
        if (!board.gameSettings?.coop) competitiveDelivery = {round: board.gameRound, active}
        onlineCommit = commit || null
        return continuing ? 'continued' : true
    }
    onlineLobby = {mode: gameSettings.coop ? 'coop' : 'competitive', occupiedHumans: null}
    socket.on('lobbyStatus', status => {
        if (socket !== onlineSocket) return
        onlineLobby = status
    })

    socket.on('gameStarted', game => {
        console.log('gameStarted')

        const delivery = receiveBoard(game, true)
        if (!delivery || delivery === 'continued') return

        nextTurnPauseInterface.visible = false
        unfreezeGame()
        gameEvent.screen.moveToPlayer(players[whooseTurn])

    });
    socket.on('playYourTurn', game => {

        console.log(`playYourTurn`)
        const delivery = receiveBoard(game, true)
        if (!delivery || delivery === 'continued') return
        GameManager.updateCameraBorders()
        nextTurnPauseInterface.visible = true

        unfreezeGame()

        gameEvent.screen.moveToPlayer(players[whooseTurn])

    });
    socket.on('waitYouTurn', game => {
        console.log(`waitYouTurn`)

        // let dict = JSON.parse(gameAndTurnIndex)
        if (!receiveBoard(game, false)) return

        if (isFogOfWar) {
            players[whooseTurn].changeFogOfWarByVision()
        }

        gameEvent.waitingMode = true
        nextTurnButton.setNextPlayerColor(players[whooseTurn].hexColor)
        undoButton.disableClick()
        nextTurnPauseInterface.visible = false
        nextTurnButton.highlightButton = false
        nextTurnButton.disableClick()
        timer.pause()
    });

    const requestCurrentGame = () => socket.emit('startGameOrConnect', JSON.stringify({
        'password': password,
        'game': getGameObject()
    }))
    socket.on('connect', () => {
        if (socket !== onlineSocket) return
        onlineCommit = null
        competitiveDelivery = null
        acceptedBoard = null
        requestCurrentGame()
    })
    if (socket.connected) requestCurrentGame()
    SendNextTurn = () => {
        console.log('SendNextTurn')
        console.trace('SendNextTurn called')
        const gameObject = getGameObject()
        socket.emit('nextTurn', JSON.stringify({
            'password': password,
            'game': gameObject,
            // whoseTurn currently means the only index of CURRENT player on client
            'whooseTurn': whooseTurn
        }))
    }
}
