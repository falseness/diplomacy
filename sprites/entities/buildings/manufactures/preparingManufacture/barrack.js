class Barrack extends PreparingManufacture {
    constructor(x, y) {
        const hp = 6
        const healSpeed = 1
        const income = -3
        super(x, y, 'barrack', hp, healSpeed, income)
    }
    select() {
        super.select()
        if (this.isMyTurn)
            barrackInterface.change(this.info, this.player.fullColor)    
    }
    removeSelect() {
        border.visible = false
        grid.drawLogicText = false
        super.removeSelect()
        barrackInterface.visible = false
    }
}