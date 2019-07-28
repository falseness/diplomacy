class InteractionWithCatapult extends InteractionWithRangeUnit {
	constructor(speed, range) {
		super(speed, range)
		this.mirrorInteraction = new MirroringInteraction(speed)
        this.way = this.mirrorInteraction.way
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
        cell.unit.hit(catapult.dmg)
    }
    hitBuilding(cell, catapult) {
        cell.building.hit(catapult.buildingDMG)
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