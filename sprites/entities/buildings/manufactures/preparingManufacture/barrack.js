class Barrack extends PreparingManufacture {
    static maxHP = 1
    static healSpeed = 1
    static income = -2
    constructor(x, y, town) {
        super(x, y, 'barrack')
        this.town = town
    }
    select(isNeedToChangeBorder) {
        super.select(isNeedToChangeBorder)
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