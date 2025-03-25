function externalNextTurn() {
    for (let i = 0; i < external.length; ++i) {
        if (external[i].killed) {
            external.splice(i--, 1)
            continue
        }
        if (external[i].isMyTurn)
            external[i].nextTurn()
    }
    for (let i = 0; i < externalProduction.length; ++i) {
        if (externalProduction[i].killed) {
            externalProduction.splice(i--, 1)
            continue
        }
        if (externalProduction[i].isMyTurn) {
            externalProduction[i].nextTurn()

            if (!externalProduction[i].isPreparingFinished()) {
                continue
            }
            if (externalProduction[i].name == 'wall' && 
                grid.getUnit(externalProduction[i].coord).notEmpty()) {
                externalProduction[i].turns++
                externalProduction[i].text.text = externalProduction[i].turns
                continue
            }
            externalProduction[i].create()
            externalProduction.splice(i--, 1)
        }
    }
}



function offlineNextTurn() {
    console.log('offlineNextTurn')
    if (gameExit) {
        return
    }

    gameEvent.nextTurn()

    timer.pauseAndSaveTime()

    whooseTurn = (whooseTurn + 1) % players.length

    externalNextTurn() 
    players[whooseTurn].nextTurn()
    
    if (players[whooseTurn].isNeutral || players[whooseTurn].isLost) {
        nextTurn()
        return
    }
    gameEvent.screen.moveToPlayer(players[whooseTurn]) // перемещение экрана к городам игрока

    nextTurnButton.color = players[whooseTurn].hexColor

    
    
    undoManager.clear()

    timer.setNextTurnTime()
    saveManager.save()

    nextTurnPauseInterface.visible = true
}

function nextTurn() {
    if (gameSettings.isOnline) {
        onlineNextTurn();
    }
    else {
        offlineNextTurn();
    }
}

// in case of online game we use this function in the beggining of our turn
let startTurn = offlineNextTurn;

function onlineNextTurn() {
    if (gameExit) {
        return
    }

    gameEvent.nextTurn()

    timer.pauseAndSaveTime()

    let myIndex = whooseTurn


    do {
        whooseTurn = (whooseTurn + 1) % players.length
        externalNextTurn() 
        players[whooseTurn].nextTurn()
    } while(players[whooseTurn].isNeutral || players[whooseTurn].isLost)
    
    undoManager.clear()

    timer.setNextTurnTime()
    saveManager.save()
    SendNextTurn()
    

    whooseTurn = myIndex

    gameEvent.waitingMode = true
    undoButton.disableClick()
}

class gameLogicButtons extends ImageButton {
    constructor(image, rect, clickFunc, parameters, text = new Empty(), canClick = true) {
        super(image, rect, clickFunc, parameters, text, canClick)
    }
    set color(color) {
        this.img.color = color
    }
    get color() {
        return this.img.color
    }
    deactivate() {
        this.unactive = true
        const interval = 1000
        setTimeout(function(){ 
            nextTurnButton.unactive = false
        }, interval)
    }
    click(point) {
        if (this.unactive)
            return false
        return super.click(point)
    }
    draw(ctx) {
        if (!this.canClick) {
            return
        }
        let oldColor = this.color
        if (this.unactive) {
            this.color = 'white'
        }
        super.draw(ctx)
        this.color = oldColor
    }
}
const nextTurnButtonSize = WIDTH * 0.1
let nextTurnButton = new gameLogicButtons(
    new TriangleImage({ x: NaN, y: NaN }, 'white', nextTurnButtonSize, 'black', 0.005 * HEIGHT),
    new Rect(WIDTH - nextTurnButtonSize * 1.05, HEIGHT - nextTurnButtonSize * 1.05,
        nextTurnButtonSize, nextTurnButtonSize),
    nextTurn
)