class Farm extends Manufacture {
    static maxHP = 2
    static healSpeed = 1
    static income = 3
    constructor(x, y, town) {
        super(x, y, 'farm')
        this.town = town
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
    get canBeDestroyed() {
        return false
    }
    get isDestroyable() {
        return this.canBeDestroyable
    }
    static get description() {
        let res = super.description
        res.info.income += "\n\nowner can't destroy it instantly"
        return res
    }
}
