function neutralPlayerTurn() {
    ++whooseTurn
}

function nextTurn() {
    townInterface.setVisible(false)
        //entityInterface.setVisible(false)

    gameEvent.nextTurn()

    whooseTurn = (players.length % ++whooseTurn)
    if (!whooseTurn)
        neutralPlayerTurn()

    for (let i = 0; i < grid.arr.length; ++i) {
        for (let j = 0; j < grid.arr[i].length; ++j) {
            grid.arr[i][j].unit.nextTurn(whooseTurn)
            grid.arr[i][j].building.nextTurn(whooseTurn)
        }
    }
}
let nextTurnButton = new StaticImageButton(
    'nextTurnButton',
    width - assets.size * 2.35 + canvasOffset.x, height - assets.size * 2.5 + canvasOffset.y, assets.size / 1.3, assets.size / 1.3,
    nextTurn
)