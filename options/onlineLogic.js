let onlineLobby = null
let onlineSocket = null

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
    onlineLobby = {mode: gameSettings.coop ? 'coop' : 'competitive', occupiedHumans: null}
    socket.on('lobbyStatus', status => {
        if (socket !== onlineSocket) return
        onlineLobby = status
    })

    socket.on('gameStarted', game => {
        console.log('gameStarted')

        game = JSON.parse(game)
        game = JSON.stringify(game)
        loadFromJson(game)

        nextTurnPauseInterface.visible = false
        unfreezeGame()
        gameEvent.screen.moveToPlayer(players[whooseTurn])

    });
    socket.on('playYourTurn', game => {

        console.log(`playYourTurn`)
        game = JSON.parse(game)
        game = JSON.stringify(game)
        loadFromJson(game)
        GameManager.updateCameraBorders()
        nextTurnPauseInterface.visible = true

        unfreezeGame()

        gameEvent.screen.moveToPlayer(players[whooseTurn])

    });
    socket.on('waitYouTurn', game => {
        console.log(`waitYouTurn`)

        // let dict = JSON.parse(gameAndTurnIndex)
        loadFromJson(game)

        if (isFogOfWar) {
            players[whooseTurn].changeFogOfWarByVision()
        }

        gameEvent.waitingMode = true
        undoButton.disableClick()
        nextTurnPauseInterface.visible = false
        nextTurnButton.highlightButton = false
        nextTurnButton.disableClick()
        timer.pause()
    });

    socket.emit('startGameOrConnect', JSON.stringify({
        'password': password,
        'game': getGameObject()
    }))
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
