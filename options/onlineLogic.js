let SendNextTurn


function unfreezeGame() {
    gameEvent.waitingMode = false
    undoButton.enableClick()
    nextTurnButton.enableClick()
    nextTurnButton.color = players[whooseTurn].hexColor
}

function SetupServerCommunicationLogic(password) {
    const socket = io('ws://localhost:8080')

    socket.on('gameStarted', game => {
        console.log('gameStarted')
        console.log(game)
        loadFromJson(game)
        

        nextTurnPauseInterface.visible = false
        unfreezeGame()
        gameEvent.screen.moveToPlayer(players[whooseTurn])
        
    });
    socket.on('playYourTurn', game => {
        console.log(`playYourTurn`)
        loadFromJson(game)

        nextTurnPauseInterface.visible = true
        unfreezeGame()
        gameEvent.screen.moveToPlayer(players[whooseTurn])
        
    });
    socket.on('waitYouTurn', game => {
        console.log(`waitYouTurn`)

        loadFromJson(game)

        gameEvent.waitingMode = true
        undoButton.disableClick()
        nextTurnPauseInterface.visible = false
        nextTurnButton.disableClick()
        timer.pause()
    });

    console.log(JSON.stringify({'password': password}))
    socket.emit('startGameOrConnect', JSON.stringify({
        'password': password,
        'game': getGameObject()
    }))
    SendNextTurn = () => {
        console.log('SendNextTurn')
        socket.emit('nextTurn', JSON.stringify({
            'password': password,
            'game': getGameObject()
        }))
    }
}

/*function SendCurrentGameState(password) {
    socket.emit('message', Json.stringify({
        'currentState': getGameObject(),
        'password': password
    }))
}*/
