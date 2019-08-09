class InteractionWithCatapult extends InteractionWithRangeUnit {
	constructor(speed, range) {
		super(speed, range)
		this.mirrorInteraction = new MirroringInteraction(speed)
        this.way = this.mirrorInteraction.way

        this.rangeWay = new RangeWay()
    }
	get isMoveOver() {
    	return this.mirrorInteraction.isMoveOver
    }
    set moves(num) {
    	this.mirrorInteraction.moves = num
    }
    get moves() {
    	return this.mirrorInteraction.moves
    }
    cellHasEnemy(cell, catapult) {
    	return this.cellHasEnemyBuilding(cell, catapult) ||
    		this.cellHasEnemyUnit(cell, catapult)
    }
    isBlindArea(coord) {
    	return this.way.getDistance(coord) <= this.moves
    }
    hitUnit(cell, catapult) {
        this.addHittedUnitUndo(cell)

        let cellUnit = cell.unit
        let killed = cell.unit.hit(catapult.dmg)
        if (!killed) 
            this.addKillUnitUndo(cellUnit)
    }
    hitBuilding(cell, catapult) {
        this.addHittedBuildingUndo(cell)

        let cellBuilding = cell.building
        let killed = cell.building.hit(catapult.buildingDMG)
        if (!killed)
            this.addKillBuildingUndo(cellBuilding)
    }
    sendInstructions(cell, catapult) {
    	let coord = cell.coord

    	if (this.isBlindArea(coord) &&
    		this.cellHasEnemy(cell, catapult)) {
    		this.removeSelect()
            return true
        }

    	return super.sendInstructions(cell, catapult)
    }
	move(coord, cell, arr, unit) {
		this.mirrorInteraction.move(coord, cell, arr, unit)
	}
}