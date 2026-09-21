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

function SetupServerCommunicationLogic(password) {
    if (onlineSocket) onlineSocket.disconnect()
    const socket = onlineSocket = io(window.DIPLOMACY_SERVER || 'wss://playdiplomacy.online:8080')
    onlineCommit = null
    // Competitive scheduling gives each player one active turn per round.
    // A waiting connection may become active in that same round when its
    // component predecessor finishes. Reconnect deliberately reloads authority.
    let competitiveDelivery = null
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
        loadFromJson(JSON.stringify(board))
        if (!board.gameSettings?.coop) competitiveDelivery = {round: board.gameRound, active}
        onlineCommit = commit || null
        return true
    }
    onlineLobby = {mode: gameSettings.coop ? 'coop' : 'competitive', occupiedHumans: null}
    socket.on('lobbyStatus', status => {
        if (socket !== onlineSocket) return
        onlineLobby = status
    })

    socket.on('gameStarted', game => {
        console.log('gameStarted')

        if (!receiveBoard(game, true)) return

        nextTurnPauseInterface.visible = false
        unfreezeGame()
        gameEvent.screen.moveToPlayer(players[whooseTurn])

    });
    socket.on('playYourTurn', game => {

        console.log(`playYourTurn`)
        if (!receiveBoard(game, true)) return
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
