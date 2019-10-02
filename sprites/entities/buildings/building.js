class Building extends Entity {
    constructor(x, y, name) {
        super(x, y, name)

        grid.setBuilding(this, this.coord)
    }
    hasBar() {
        return true
    }
    toUndoJSON() {
        let res = this.toJSON()
        return JSON.parse(JSON.stringify(res))
    }
    needInstructions() {
        return false
    }
    get isManufacture() {
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
    get isPreparingManufacture() {
        return false
    }
    get canBeDestroyed() {
        return true
    }
    get isDestroyable() {
        return this.canBeDestroyed && this.isMyTurn
    }
    get info() {
        let res = super.info
        res.isDestroyable = this.isDestroyable
        return res
    }
    destroy() {
        this.kill()
    }
    nextTurn() {
        this.hp += this.hpIncrease
        this.wasHitted = false

        this.updateHPBar()
    }
}