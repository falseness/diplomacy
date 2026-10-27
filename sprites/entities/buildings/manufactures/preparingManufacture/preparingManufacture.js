class PreparingManufacture extends Manufacture {
    #unitProduction
	constructor(x, y, name) {
		super(x, y, name)
		this.#unitProduction = new Empty()
    }
    set unitProduction(obj) {
        this.#unitProduction = obj
        this.#unitProduction.coord = this.coord
    }
    get unitProduction() {
        return this.#unitProduction
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
        actionManager.startAction('prepareUnit')
        actionManager.lastAction.building = this.toUndoJSON()
        actionManager.lastAction.gold = this.gold

        actionManager.lastAction.killBuilding = {
            coord: {
                x: this.coord.x,
                y: this.coord.y
            }
        }
    }
	startUnitPreparing(what) {
        if (this.player.economyEnabled === false) return false
        this.addThisUndo()

        this.minusGold(production[what].cost)

        this.unitProduction = new production[what].production(
            production[what].turns, production[what].cost, 
            production[what].class, what)
    }
    prepare(what) {
        if (this.player.economyEnabled === false) return false
        if (this.gold < production[what].cost ||
            this.isPreparingUnit)
            return false
        this.startUnitPreparing(what)

        return true
    }
	get info() {
        let building = super.info
        if (this.isPreparingUnit) {
            // Shown as the unit's display name; trainId is the production id.
            building.trainId = this.unitProduction.name
            addProductionPreviewInfo(building.info,
                production[this.unitProduction.name]?.class?.displayName || this.unitProduction.name,
                this.unitProduction.turns)
        }
        // 'G + I = T': the gold, the net income and the gold next turn (drawn with the income icon, TASK-1354).
        building.info.gold = goldFormulaText(this.player.gold, this.player.income)
        return building
    }
	unitPreparingLogic() {
        if (this.player.economyEnabled === false) return false
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
    get isPreparingManufacture() {
        return true
    }
}