class Farm extends Manufacture {
    constructor(x, y, town) {
        const hp = 2
        const healSpeed = 1
        const income = 2
        super(x, y, 'farm', hp, healSpeed, income)
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