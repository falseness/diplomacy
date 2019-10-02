class InteractionWithRangeUnit extends InterationWithUnit {
    constructor(speed, range, borderStrokeWidth = 0.1 * basis.r) {
        super(speed)
        this.way = new RangeUnitMoveWay()
        this.rangeWay = new RangeWay()

        this.range = range
        this.borderStrokeWidth = borderStrokeWidth
    }
    isTurnFinished(unit) {
        return unit.isMyTurn && this.isMovesOver
    }
    select(rangeUnit) {
        super.select(rangeUnit)

        if (this.isTurnFinished(rangeUnit))
            return
            
        attackBorder.newBrokenLine('white',//rangeUnit.player.hexColor, 
            this.borderStrokeWidth, rangeUnit.player.hexColor)
        this.rangeWay.create(rangeUnit.coord, this.range, 
            grid.arr, rangeUnit.playerColor, attackBorder)
    }
    removeSelect() {
        super.removeSelect()
        attackBorder.visible = false
    }
    cellHasEnemyUnit(cell, rangeUnit) {
        return cell.unit.notEmpty() &&
            cell.unit.playerColor != rangeUnit.playerColor
    }
    cantRangeInteract(coord, rangeUnit) {
        return this.rangeWay.getDistance(coord) > this.range ||
            coordsEqually(rangeUnit.coord, coord)
    }
    hitBuildingProduction(building, unit) {
        if (building.isExternalProduction()) {
            undoManager.lastUndo.externalProduction = building.toUndoJSON()
        }
        else {
            undoManager.lastUndo.buildingProduction = building.toUndoJSON()
        }

        building.hit(unit.dmg)
    }
    hitBuilding(cell, unit) {
        if (cell.building.isBuildingProduction()) {
            this.hitBuildingProduction(cell.building, unit)
            return
        }
        super.hitBuilding(cell, unit)
    }
    buildingAttack(cell, rangeUnit) {
        this.addThisUndo(rangeUnit)
        this.undoAdded = true
        
        this.moves = 0

        if (cell.building.isHitable) {
            this.hitBuilding(cell, rangeUnit)

            this.addKillUnitUndo(rangeUnit)

            this.removeSelect()
            return true
        }
        this.markIgnoredBuilding(cell)
    }
    sendInstructions(cell, rangeUnit) {
        let coord = cell.coord

        if (cell.building.isNature) {
            this.removeSelect()
            return true
        }

        this.undoAdded = false
        

        if (this.cantRangeInteract(coord, rangeUnit)) {
            //this.removeSelect()
            return super.sendInstructions(cell, rangeUnit)
        }
        if (this.cellHasEnemyBuilding(cell, rangeUnit)) {
            let result = this.buildingAttack(cell, rangeUnit)
            if (result)
                return true
        }

        if (this.cellHasEnemyUnit(cell, rangeUnit)) {
            if (!this.undoAdded)
                this.addThisUndo(rangeUnit)

            this.hitUnit(cell, rangeUnit)

            this.addKillUnitUndo(rangeUnit)

            this.moves = 0

            this.removeSelect()
            return true
        }
        if (this.undoAdded) {//attack building but not hitable
            this.removeSelect()
            return true
        }

        if (cell.building.isBuildingProduction() && 
            cell.building.playerColor != rangeUnit.playerColor) {
            let result = this.buildingAttack(cell, rangeUnit)
            if (result)
                return true
        }
        if (cell.unit.notEmpty()) {
            // ally unit
            this.removeSelect()
            return true
        }
        
        return super.sendInstructions(cell, rangeUnit)
    }
}
class RangeWay extends Way {
    constructor() {
        super()
    }
    isCellImpassable(neighbour, v0, arr, player) {
        return false
    }
    markCoord(v, coord, used) {
        this.distance[coord.x][coord.y] = this.distance[v.x][v.y] + 1

        this.parent[coord.x][coord.y] = v
        used[coord.x][coord.y] = true
    }
    notUsedHandler(v, coord, moves, player, used, Q, enemyEntityQ = []) {
        Q.push(coord)
        this.markCoord(v, coord, used)
    }
    create(v0, moves, arr, player, bord, changeLogicText = true, newBorder = false) {
        // dont chage logic text and create border by default
        super.create(v0, moves, arr, player, bord, changeLogicText, newBorder)
    }
}
class RangeUnitMoveWay extends Way {
    isCellImpassable(neighbour, v0, arr, player) {
        let cell = arr[neighbour.x][neighbour.y]
        return this.cellHasEnemyEntity(cell, player) || 
            super.isCellImpassable(neighbour, v0, arr, player)
    }
}