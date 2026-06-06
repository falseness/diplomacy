GameManager.replayBuffer = []

GameManager.pushReplay = function(x, y) {
    GameManager.replayBuffer.push({x: x, y: y})
    const maxReplaySize = 20000
    if (GameManager.replayBuffer.length > maxReplaySize) {
        GameManager.replayBuffer.splice(0, GameManager.replayBuffer.length - maxReplaySize)
    }
}

GameManager.trainFromBuffer = async function(sampleSize, epochs) {
    let buffer = GameManager.replayBuffer
    if (buffer.length == 0) {
        return
    }
    let groups = {}
    for (let i = 0; i < sampleSize; ++i) {
        let entry = buffer[randomInt(0, buffer.length - 1)]
        let grid3d = entry.x[0]
        let key = grid3d.length + 'x' + grid3d[0].length
        if (!(key in groups)) {
            groups[key] = {x: [], y: []}
        }
        groups[key].x.push(entry.x)
        groups[key].y.push(entry.y)
    }
    let keys = Object.keys(groups)
    for (let i = 0; i < keys.length; ++i) {
        await trainModel(ai_model, groups[keys[i]].x, groups[keys[i]].y, epochs)
    }
}

GameManager.startTrain = function() {
    if (gameSettings.testAI) {
        this.startAI().then(() => console.log('played'))
    }
    else {
        this.playAndTrain().then(() => console.log('Done playing'))
    }
}

GameManager.startAI = async function() {
    ai_model = await loadModel()
    isFogOfWar = false
    let map = generateTinyMap()
    map.start(this, false)
    gameSettings.withAI = true
    this.initValues()
    suddenDeathRound = 10
    startTurn()
    requestAnimationFrame(gameLoop)
}

GameManager.startPredict = function() {
    tf.loadLayersModel('localstorage://diplomacy_weights')
    .then(async model => {
        ai_model = model
        let map = generateTinyOnlyBlue()
        map.start(this, false)
        whooseTurn = 1
        let prediction = await predict(ai_model, tf.stack([vectoriseGrid()]))
        console.log('prediction', prediction)
    })
    .catch(err => console.error('Error loading model:', err))
}

GameManager.generateAndPlay = async function() {
    let map = generateTinyMap()
    map.start(this, false)
    this.initValues()
    suddenDeathRound = 10
    whooseTurn = 0
    players[1].commandsDebug = []
    players[2].commandsDebug = []

    const hardLimit = 100
    for (let i = 0; i < hardLimit; ++i) {
        if (players[1].isLost || players[2].isLost) {
            let outcome = {1: 0.0, 2: 0.0}
            if (!players[1].isLost || !players[2].isLost) {
                outcome[1] = players[1].isLost ? -1.0 : 1.0
                outcome[2] = -outcome[1]
            }
            for (let playerIndex = 1; playerIndex <= 2; ++playerIndex) {
                let grids = players[playerIndex].chosenGrids
                for (let gridIndex = 0; gridIndex < grids.length; ++gridIndex) {
                    GameManager.pushReplay(grids[gridIndex], outcome[playerIndex])
                }
            }
            return
        }
        whooseTurn = (whooseTurn + 1) % players.length
        if (!whooseTurn) {
            players[whooseTurn].nextTurn()
            whooseTurn = 1
        }
        players[whooseTurn].nextTurn()
        players[whooseTurn].doActions()
    }
    console.log('reached hard limit')
}

GameManager.playAndTrain = async function() {
    ai_model = await loadModel()
    isFogOfWar = false
    const learningRate = 0.001
    const compileModel = function() {
        ai_model.compile({
            optimizer: tf.train.adam(learningRate),
            loss: 'meanSquaredError',
            metrics: ['accuracy']
        })
    }
    compileModel()
    GameManager.replayBuffer = []
    selfPlayTemperature = 0.5

    const sampleSize = 1024
    const epochsPerStep = 4
    for (let i = 0; i < 1000; ++i) {
        await this.generateAndPlay()
        for (let playerIndex = 0; playerIndex < players.length; ++playerIndex) {
            delete players[playerIndex].chosenGrids
            delete players[playerIndex].winningChances
        }
        await this.trainFromBuffer(sampleSize, epochsPerStep)
        if (i == 0 || i % 5 != 0) {
            continue
        }
        await saveModel()
        ai_model.dispose()
        tf.engine().reset()
        ai_model = await loadModel()
        compileModel()
    }
    selfPlayTemperature = 0.0
    await saveModel()
}

GameManager.startTrain0 = async function() {
    isFogOfWar = false
    gameSettings.withAI = true
    let xTrain = []
    let yTrain = []
    let scenarios = [
        {count: 1000, createMap: generateTinyOnlyBlue, target: 0.0},
        {count: 500, createMap: generateTinyMapOnlyRed, target: 1.0},
        {count: 500, createMap: generateTinyMapLessHP, target: 1.0}
    ]
    for (let scenarioIndex = 0; scenarioIndex < scenarios.length; ++scenarioIndex) {
        let scenario = scenarios[scenarioIndex]
        for (let cycle = 0; cycle < scenario.count; ++cycle) {
            let map = scenario.createMap()
            map.start(this, false)
            this.initValues()
            whooseTurn = 1
            xTrain.push(vectoriseGrid())
            yTrain.push(scenario.target)
        }
    }
    await trainModel(ai_model, xTrain, yTrain)
    await ai_model.save('localstorage://diplomacy_weights')
}
