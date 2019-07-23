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

    nextTurnButton.setColor(players[whooseTurn].getHexColor())

    for (let i = 0; i < grid.arr.length; ++i) {
        for (let j = 0; j < grid.arr[i].length; ++j) {
            grid.arr[i][j].unit.nextTurn(whooseTurn)
            grid.arr[i][j].building.nextTurn(whooseTurn)
        }
    }
    players[whooseTurn].startTurn()
    saveManager.save()
}
class gameLogicButtons extends ImageButton {
    constructor(image, rect, clickFunc, parameters, text = new Empty(), canClick = true) {
        super(image, rect, clickFunc, parameters, text, canClick)
    }
    setColor(color) {
        this.img.setColor(color)
        backToMenuButton.setColor(color)
    }
}
const nextTurnButtonSize = WIDTH * 0.1
let nextTurnButton = new gameLogicButtons(
    new TriangleImage({ x: NaN, y: NaN }, 'white', nextTurnButtonSize, 'black', 0.005 * HEIGHT),
    new Rect(WIDTH - nextTurnButtonSize * 2, HEIGHT - nextTurnButtonSize * 2,
        nextTurnButtonSize, nextTurnButtonSize),
    nextTurn
)