class Empty {
    constructor() {
        this.player = 0
        this.coord = {
            x: -1,
            y: -1
        }
    }
    toJSON() {
        return { name: 'Empty' }
    }
    getCell() {
        console.log("ERROR")
    }
    kill() {}
    isPassable() {
        return true
    }
    isBuildingProduction() {
        return false
    }
    isExternalProduction() {
        return false
    }
    isEmpty() {
        return true
    }
    notEmpty() {
        return !this.isEmpty()
    }
    select() {

    }
    removeSelect() {

    }
    isWall() {
        return false
    }
    needInstructions() {
        return false
    }
    get info() {
        return {
            name: '',
            player: 0,
            info: {

            }
        }
    }
    get hexColor() {
        return '#D0D0D0'
    }
    nextTurn(whooseTurn) {

    }
    setTextAlign() {

    }
    draw() {

    }
}