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
        let killed
        if (this.undoAdded) {
            killed = cell.unit.hit(catapult.buildingDMG)
        }
        else {
            killed = cell.unit.hit(catapult.dmg)
        }
        if (!killed) 
            this.addKillUnitUndo(cellUnit)
    }
    hitBuilding(cell, catapult) {
        if (cell.building.isBuildingProduction()) {
            this.hitBuildingProduction(cell.building, catapult)
            return
        }

        this.addHittedBuildingUndo(cell)

        let cellBuilding = cell.building
        let killed = cell.building.hit(catapult.buildingDMG)
        if (!killed)
            this.addKillBuildingUndo(cellBuilding)
    }
    sendInstructions(cell, catapult) {
        let coord = cell.coord
        
        if (cell.building.isNature) {
            this.removeSelect()
            return true
        }
        
        let isEnemyInBlindArea = (this.isBlindArea(coord) &&
                        this.cellHasEnemy(cell, catapult))
        let isEnemyUnit = this.cellHasEnemyUnit(cell, catapult)
        let isTownWith0HP = (this.cellHasEnemyBuilding(cell, catapult) && 
                                cell.building.isStandable)

    	if (isEnemyInBlindArea || (isEnemyUnit && !isTownWith0HP)) {
            // Catapult don't attack units
            // but catapult attack unit if he stay at town with 0 hp
    		this.removeSelect() 
            return true
        }

    	return super.sendInstructions(cell, catapult)
    }
	move(coord, cell, arr, unit) {
		this.mirrorInteraction.move(coord, cell, arr, unit)
	}
}