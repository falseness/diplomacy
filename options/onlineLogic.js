let SendNextTurn


function unfreezeGame() {
    gameEvent.waitingMode = false
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
    const socket = io(window.DIPLOMACY_SERVER || 'wss://playdiplomacy.online:8080')

    socket.on('gameStarted', game => {
        console.log('gameStarted')
        
        game = JSON.parse(game)
        game = JSON.stringify(game)
        loadFromJson(game)
        timer.setNextTurnTime()
        
        nextTurnPauseInterface.visible = false
        unfreezeGame()
        // we do not call players[whooseTurn].nextTurn() here 
        // since we call startTurn in the beginning of the game
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
        
        const packedTimer = JSON.parse(unpacker.getPlayerTimerByIndex(whooseTurn))
        //players[whooseTurn].nextTurn()
        if (packedTimer.type != 'long') {
            timer.setNextTurnTime()
            unpacker.setPlayerTimerByIndex(whooseTurn, timer)
        }
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
        const gameObject = getGameObject()
        socket.emit('nextTurn', JSON.stringify({
            'password': password,
            'game': gameObject,
            // whoseTurn currently means the only index of CURRENT player on client
            'whooseTurn': whooseTurn
        }))
    }
}
