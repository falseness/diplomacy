class Manufacture extends Building {
	#income
	constructor(x, y, name, hp, healSpeed, income) {
		super(x, y, name, hp, healSpeed)
		this.#income = income
	}
	get income() {
		return this.#income
	}
	set income(income) {
		this.#income = income
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