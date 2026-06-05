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
    sendAttackInstructions(cell, catapult) {
        if (!this.cantRangeInteract(cell.coord, catapult) &&
                this.cellHasEnemyBuildingProduction(cell, catapult)) {
            let result = this.buildingAttack(cell, catapult)
            if (result)
                return true
        }

        return super.sendInstructions(cell, catapult)
    }
    canHitSomethingOnCell(cell, catapult) {
        return !this.cantRangeInteract(cell.coord, catapult) && !this.isBlindArea(cell.coord) &&
             this.cellHasAttackableBuilding(cell, catapult)
    }
    sendInstructions(cell, catapult) {
        let coord = cell.coord

        if (isFogOfWar && !grid.fogOfWar[coord.x][coord.y]) {
            if (this.cantRangeInteract(coord, catapult)) {
                this.removeSelect()
                return true
            }

            // blind area cant be fogged
            let result = this.sendAttackInstructions(cell, catapult)
            if (!this.undoAdded) {
                this.addThisUndo(catapult)
                this.moves = 0
                this.addKillUnitUndo(catapult)
            }
            return result
        }
        
        let isCellInBlindArea = this.isBlindArea(coord)
        let isEnemyInBlindArea = (isCellInBlindArea &&
                this.cellHasEnemy(cell, catapult))
        let noObjectsToAttack = !isCellInBlindArea && 
            !(this.cellHasEnemyBuilding(cell, catapult) || 
            this.cellHasEnemyBuildingProduction(cell, catapult))

        if (cell.building.isStaticNature || 
            isEnemyInBlindArea ||
            noObjectsToAttack) {
            this.removeSelect()
            return true
        }

        return this.sendAttackInstructions(cell, catapult)
    }
	move(coord, cell, arr, unit) {
		this.mirrorInteraction.move(coord, cell, arr, unit)
	}
}