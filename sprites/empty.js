class Empty {
    constructor() {
        this.player = 0
        this.coord = {
            x: -1,
            y: -1
        }
    }
    toJSON() {
        return {name: 'Empty'}
    }
    isPassable() {
        return true
    }
    isBuildingProduction() {
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
    needInstructions() {
        return false
    }
    getInfo() {
        return {
            name: '',
            player: 0,
            info: {

            }
        }
    }
    getHexColor() {
        return '#D0D0D0'
    }
    nextTurn(whooseTurn) {

    }
    setPos(pos) {

    }
    setTextAlign() {

    }
    draw() {

    }
}