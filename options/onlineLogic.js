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
    const socket = io('ws://89.169.157.173:8080')

    socket.on('gameStarted', game => {
        console.log('gameStarted')
        
        game = JSON.parse(game)
        game.timers[game.whooseTurn] = new Timer()
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
        game.timers[game.whooseTurn] = new Timer()
        game = JSON.stringify(game)
        loadFromJson(game)
        timer.setNextTurnTime()
        nextTurnPauseInterface.visible = true
        
        unfreezeGame()
        
        players[whooseTurn].nextTurn()
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
        socket.emit('nextTurn', JSON.stringify({
            'password': password,
            'game': getGameObject(),
            // whoseTurn currently means the only index of CURRENT player on client
            'whooseTurn': whooseTurn
        }))
    }
}

