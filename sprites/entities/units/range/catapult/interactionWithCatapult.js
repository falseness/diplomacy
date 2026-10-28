class InteractionWithCatapult extends InteractionWithRangeUnit {
	constructor(speed, range) {
		super(speed, range)
		this.mirrorInteraction = new MirroringInteraction(speed)
        this.way = this.mirrorInteraction.way

        this.rangeWay = new RangeWay()
        // UI only (TASK-1412): the fogged cell of this turn's blind shot, drawn as '?' while the
        // catapult is selected. Never saved or sent; an undo rebuilds the catapult without it.
        this.blindShotMark = undefined
    }
    nextTurn() {
        super.nextTurn()
        this.blindShotMark = undefined
    }
    // The blind-shot cell while it is still fogged for the owner; a revealed cell forgets the mark.
    visibleBlindShotMark(catapult) {
        const mark = this.blindShotMark
        if (!mark)
            return undefined
        if (!isFogOfWar || !grid.fogOfWar || grid.fogOfWar[mark.x]?.[mark.y]) {
            this.blindShotMark = undefined
            return undefined
        }
        return catapult.isMyTurn ? mark : undefined
    }
    // S6 neutral style: a dashed white ring with a white '?' over a dark halo.
    drawBlindShotMark(ctx, catapult) {
        const mark = this.visibleBlindShotMark(catapult)
        if (!mark)
            return
        const p = grid.arr[mark.x][mark.y].hexagon.calcPos(), r = basis.r * 0.33
        ctx.save()
        ctx.setLineDash([r * 0.32, r * 0.24])
        ctx.lineCap = 'round'
        for (const [color, width] of [['rgba(0,0,0,0.6)', 0.3], ['#ffffff', 0.13]]) {
            ctx.beginPath()
            ctx.arc(p.x, p.y - basis.r * 0.04, r * 1.05, 0, 2 * Math.PI)
            ctx.strokeStyle = color
            ctx.lineWidth = r * width
            ctx.stroke()
        }
        ctx.setLineDash([])
        ctx.font = `700 ${r * 1.5}px ${Text.defaultFamily}`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.lineJoin = 'round'
        ctx.lineWidth = r * 0.3
        ctx.strokeStyle = 'rgba(0,0,0,0.7)'
        ctx.strokeText('?', p.x, p.y - basis.r * 0.02)
        ctx.fillStyle = '#ffffff'
        ctx.fillText('?', p.x, p.y - basis.r * 0.02)
        ctx.restore()
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
    isMoveArea(coord) {
    	return this.way.getDistance(coord) <= this.moves
    }
    // Siege never damages units: an open-ground unit is not a target, a hidden
    // unit in fog is unharmed and a garrisoned town/building only loses hp.
    hitUnit() {}
    demonShieldsPortal() { return false } // A demon never shields its portal.
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
    // A 0-hp enemy town takes no damage, but a shot marks it hit, so it does not heal at its
    // owner's turn start. Once marked this round it is no target: another shot would be wasted.
    cellHasUnmarkedZeroHpTown(cell, unit) {
        const building = cell.building
        return this.cellHasEnemyBuilding(cell, unit) && building.isTown() && !building.killed &&
            !building.hp && !building.wasHitted
    }
    canHitSomethingOnCell(cell, catapult) {
        return !this.cantRangeInteract(cell.coord, catapult) &&
            (this.cellHasAttackableBuilding(cell, catapult) ||
                this.cellHasUnmarkedZeroHpTown(cell, catapult))
    }
    sendInstructions(cell, catapult) {
        let coord = cell.coord

        if (isFogOfWar && !grid.fogOfWar[coord.x][coord.y]) {
            if (this.cantRangeInteract(coord, catapult)) {
                this.removeSelect()
                return true
            }

            // blind area cant be fogged
            if (this.cellHasEnemyUnit(cell, catapult) &&
                    !this.cellHasEnemyBuilding(cell, catapult) &&
                    !this.cellHasEnemyBuildingProduction(cell, catapult)) {
                // the shot is spent on a hidden unit, which takes no damage
                this.addThisUndo(catapult)
                this.moves = 0
                this.addKillUnitUndo(catapult)
                this.blindShotMark = {x: coord.x, y: coord.y}
                this.removeSelect()
                return true
            }
            let result = this.sendAttackInstructions(cell, catapult)
            if (!this.undoAdded) {
                this.addThisUndo(catapult)
                this.moves = 0
                this.addKillUnitUndo(catapult)
            }
            if (!this.moves)
                this.blindShotMark = {x: coord.x, y: coord.y}
            return result
        }
        
        // No blind area: an enemy building anywhere in range is shot, even one
        // the catapult could also walk to.
        let hasEnemyBuilding = this.cellHasEnemyBuilding(cell, catapult) ||
            this.cellHasEnemyBuildingProduction(cell, catapult)
        if (cell.building.isStaticNature) {
            this.removeSelect()
            return true
        }
        if (hasEnemyBuilding && !this.cantRangeInteract(coord, catapult))
            return this.sendAttackInstructions(cell, catapult)

        // Siege never targets units; any other cell outside the move area is a no-op.
        if (this.cellHasEnemy(cell, catapult) || !this.isMoveArea(coord)) {
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
    canHitSomethingOnCell(cell, unit) {
        return this.moves > 0 && !unit.player.ignoresCell(cell) &&
            !this.cantRangeInteract(cell.coord, unit) &&
            (this.cellHasAttackableBuilding(cell, unit) ||
                this.cellHasEnemyBuildingProduction(cell, unit) ||
                this.cellHasUnmarkedZeroHpTown(cell, unit))
    }
    sendInstructions(cell, unit) {
        if (!this.moves || unit.player.ignoresCell(cell)) return true
        if (this.canHitSomethingOnCell(cell, unit)) {
            // a 0-hp enemy town is only marked hit (no damage, no capture)
            if (!this.buildingAttack(cell, unit))
                this.removeSelect()
            return true
        }
        // Reject occupied and enemy-building destinations before movement can
        // invoke the inherited melee/capture path: a 0-hp enemy town is shot,
        // never entered, and a town already marked this round is no target.
        if (cell.unit.notEmpty() || this.cellHasEnemyBuilding(cell, unit) ||
                this.cellHasEnemyBuildingProduction(cell, unit)) {
            this.removeSelect()
            return true
        }
        return InterationWithUnit.prototype.sendInstructions.call(this, cell, unit)
    }
}
