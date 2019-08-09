class Farm extends Manufacture {
    static maxHP = 2
    static healSpeed = 1
    static income = 2
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
}