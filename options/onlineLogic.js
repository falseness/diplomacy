let SendNextTurn
function SetupServerCommunicationLogic(password) {
    const socket = io('ws://localhost:8080')

    socket.on('message', text => {
        console.log(`got message ${text}`)

    });

    console.log(JSON.stringify({'password': password}))
    socket.emit('message', JSON.stringify({
        'privet': 'hello',
        'password': password,
        'startGame': getGameJson()
    }))
    SendNextTurn = () => {
        socket.emit('message', JSON.stringify({
            'password': password,
            'nextTurn': getGameJson()
        }))
    }
}

/*function SendCurrentGameState(password) {
    socket.emit('message', Json.stringify({
        'currentState': getGameJson(),
        'password': password
    }))
}*/
