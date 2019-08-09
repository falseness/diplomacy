class Barrack extends PreparingManufacture {
    constructor(x, y, town) {
        const hp = 4
        const healSpeed = 1
        const income = -3
        super(x, y, 'barrack', hp, healSpeed, income)
        this.town = town
    }
    select() {
        super.select()
        if (this.isMyTurn)
            barrackInterface.change(this.info, this.player.fullColor)
    }
    toUndoJSON() {
        let res = this.toJSON()
        res.town = {
            coord: {
                x: this.town.coord.x,
                y: this.town.coord.y
            }
        }
        return JSON.parse(JSON.stringify(res))
    }
    removeSelect() {
        border.visible = false
        grid.drawLogicText = false
        super.removeSelect()
        barrackInterface.visible = false
    }
}