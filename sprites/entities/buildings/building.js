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
    findOwningTown() {
        if (this.town) {
            return this.town
        }
        let player = players ? players[this.playerColor] : null
        if (!player || !player.towns) {
            return null
        }
        for (let i = 0; i < player.towns.length; ++i) {
            let town = player.towns[i]
            if (!town || town.killed) {
                continue
            }
            for (let j = 0; town.buildings && j < town.buildings.length; ++j) {
                let building = town.buildings[j]
                if (building.coord && coordsEqually(building.coord, this.coord)) {
                    return town
                }
            }
            for (let j = 0; town.suburbs && j < town.suburbs.length; ++j) {
                if (town.suburbs[j].coord &&
                        coordsEqually(town.suburbs[j].coord, this.coord)) {
                    return town
                }
            }
        }
        return null
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
    changeBorder() {
        border.newBrokenLine()
        let realPos = {x: this.pos.x + assets.size / 2, y: this.pos.y + assets.size / 2}
        for (let i = 0; i < 6; ++i) {
            border.createLine(realPos, i)
        }
    }
    select(isNeedToChangeBorder = true) {
        entityInterface.change(this.info, this.player.fullColor)
        if (isNeedToChangeBorder)
            this.changeBorder()
    }
    removeSelect() {
        border.visible = false
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
    get isStaticNature() {
        return false;
    }
    get isAlwaysVisible() {
        return false
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
