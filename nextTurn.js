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
}
let nextTurnButton = new ImageButton(
    new TriangleImage({ x: NaN, y: NaN }, 'white', assets.size * 85 / 100, 'black', 0.005 * HEIGHT),
    new Rect(width - assets.size * 1.55, height - assets.size * 1.5, assets.size / 1.3, assets.size / 1.3),
    nextTurn
)