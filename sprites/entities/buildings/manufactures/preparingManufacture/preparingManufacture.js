class PreparingManufacture extends Manufacture {
	constructor(x, y, name, hp, healSpeed, income) {
		super(x, y, name, hp, healSpeed, income)
		this.unitProduction = new Empty()
	}
	toJSON() {
        let res = super.toJSON()
        res.unitProduction = this.unitProduction
        return res
    }
	get isPreparingUnit() {
		return this.unitProduction.notEmpty()
	}
	get gold() {
		return this.player.gold
	}
	minusGold(num) {
        this.player.gold -= num
    }
    addThisUndo() {
        undoManager.startUndo('prepareUnit')
        undoManager.lastUndo.building = this.toUndoJSON()
        undoManager.lastUndo.gold = this.gold

        undoManager.lastUndo.killBuilding = {
            coord: {
                x: this.coord.x,
                y: this.coord.y
            }
        }
    }
	startUnitPreparing(what) {
        this.addThisUndo()

        this.minusGold(production[what].cost)

        this.unitProduction = new production[what].production(
            production[what].turns, production[what].cost, 
            production[what].class, what)

    }
    prepare(what) {
        if (this.gold < production[what].cost ||
            this.isPreparingUnit)
            return false
        this.startUnitPreparing(what)

        return true
    }
	get info() {
        let building = super.info
        if (this.isPreparingUnit) {
            building.info.train = this.unitProduction.name
            building.info.turns = this.unitProduction.turns
        }
        let income = this.player.income
        building.info.gold = this.player.gold + ' (' + ((income > 0) ? '+' : '') + income + ')'
        return building
    }
	unitPreparingLogic() {
        if (!this.isPreparingUnit)
            return
        
        let preparingFinished = this.unitProduction.nextTurn()
        if (!preparingFinished)
            return
            
        if (grid.getUnit(this.coord).notEmpty()) {
            this.unitProduction.cantCreateNow()
            return
        }
        this.unitProduction.create(this.coord.x, this.coord.y)
        
        this.unitProduction = new Empty()
    }
	nextTurn() {
        super.nextTurn()

        this.unitPreparingLogic()
    }
}