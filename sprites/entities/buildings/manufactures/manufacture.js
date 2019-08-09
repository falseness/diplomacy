class Manufacture extends Building {
	constructor(x, y, name) {
		super(x, y, name)
    }
    static get description() {
        let res = super.description
        res.info.income = this.income
        return res
    }
	get income() {
		return this.constructor.income
	}
	get info() {
        let manufacture = super.info

        manufacture.info.income = this.income

        return manufacture
    }
    /*toJSON() {
        let res = {}
        
        res.name = this.name
        res.coord = {}
        res.coord.x = this.coord.x
        res.coord.y = this.coord.y
        res.hp = this.hp
        res.income = this.income
        res.town = {coord: this.town.getCoord()}
        res.wasHitted = this.wasHitted
        
        return res
    }*/
}