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

        // temporary. work in 2 player maps:
        if (isFogOfWar) {
            let myIndex = whooseTurn == 1 ? 2 : 1
            players[myIndex].changeFogOfWarByVision()
        }

        gameEvent.waitingMode = true
        undoButton.disableClick()
        nextTurnPauseInterface.visible = false
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
            'game': getGameObject()
        }))
    }
}

