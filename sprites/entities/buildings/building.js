class Building extends Entity {
    constructor(x, y, name) {
        super(x, y, name)

        grid.setBuilding(this, this.coord)
    }
    toUndoJSON() {
        let res = this.toJSON()
        return JSON.parse(JSON.stringify(res))
    }
    needInstructions() {
        return false
    }
    kill() {
        grid.setBuilding(new Empty(), this.coord)

        this.killed = true
    }
    select() {
        entityInterface.change(this.info, this.player.fullColor)
    }
    removeSelect() {
        entityInterface.visible = false
    }
    isBuilding() {
        return true
    }
    isTown() {
        return false
    }
    nextTurn() {
        this.hp += this.hpIncrease
        this.wasHitted = false
    }
}