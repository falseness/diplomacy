function neutralPlayerTurn() {
    ++whooseTurn
}

function nextTurn() {
    //townInterface.setVisible(false)
    //entityInterface.setVisible(false)

    gameEvent.nextTurn()

    whooseTurn = (whooseTurn + 1) % players.length
    if (!whooseTurn)
        neutralPlayerTurn()

    nextTurnButton.color = players[whooseTurn].hexColor

    players[whooseTurn].nextTurn()
    undoManager.clear()
    saveManager.save()
}
class gameLogicButtons extends ImageButton {
    constructor(image, rect, clickFunc, parameters, text = new Empty(), canClick = true) {
        super(image, rect, clickFunc, parameters, text, canClick)
    }
    set color(color) {
        this.img.color = color
    }
}
const nextTurnButtonSize = WIDTH * 0.1
let nextTurnButton = new gameLogicButtons(
    new TriangleImage({ x: NaN, y: NaN }, 'white', nextTurnButtonSize, 'black', 0.005 * HEIGHT),
    new Rect(WIDTH - nextTurnButtonSize * 1.05, HEIGHT - nextTurnButtonSize * 1.05,
        nextTurnButtonSize, nextTurnButtonSize),
    nextTurn
)