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
        let killed = cell.unit.hit(catapult.buildingDMG)
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
            this.cellHasEnemyBuildingProduction(cell, catapult) ||
            this.cellHasEnemyUnit(cell, catapult))

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

class InteractionWithBombard extends InteractionWithCatapult {
    constructor(speed, range) {
        super(speed, range)
        // Empty-cell movement must never path through a defender or building.
        this.way = this.mirrorInteraction.way = new RangeUnitMoveWay()
    }
    isBlindArea(coord) {
        return this.rangeWay.getDistance(coord) < Bombard.minimumRange
    }
    hitUnit() {} // No melee, ranged or counterattack damage to units.
    canHitSomethingOnCell(cell, unit) {
        return this.moves > 0 && !unit.player.ignoresCell(cell) &&
            !this.cantRangeInteract(cell.coord, unit) && !this.isBlindArea(cell.coord) &&
            (this.cellHasAttackableBuilding(cell, unit) ||
                this.cellHasEnemyBuildingProduction(cell, unit))
    }
    sendInstructions(cell, unit) {
        if (!this.moves || unit.player.ignoresCell(cell)) return true
        if (this.canHitSomethingOnCell(cell, unit))
            return this.buildingAttack(cell, unit)
        // Reject occupied and enemy-building destinations before movement can
        // invoke the inherited melee/capture path, including zero-HP towns.
        if (cell.unit.notEmpty() || this.cellHasEnemyBuilding(cell, unit) ||
                this.cellHasEnemyBuildingProduction(cell, unit)) {
            this.removeSelect()
            return true
        }
        return InterationWithUnit.prototype.sendInstructions.call(this, cell, unit)
    }
}
