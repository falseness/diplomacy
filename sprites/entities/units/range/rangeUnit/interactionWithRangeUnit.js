class InteractionWithRangeUnit extends InterationWithUnit {
    constructor(speed, range, borderStrokeWidth = 0.1 * basis.r) {
        super(speed)
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
            this.borderStrokeWidth)
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
    sendInstructions(cell, rangeUnit) {
        let coord = cell.coord

        if (this.cantRangeInteract(coord, rangeUnit)) {
            this.removeSelect()
            return true
                // attack range > speed by default
        }

        if (this.cellHasEnemyBuilding(cell, rangeUnit)) {
            this.addThisUndo(rangeUnit)

            this.hitBuilding(cell, rangeUnit)

            this.addKillUnitUndo(rangeUnit)

            this.moves = 0
            this.removeSelect()
            return true
        }

        if (this.cellHasEnemyUnit(cell, rangeUnit)) {
            this.addThisUndo(rangeUnit)

            this.hitUnit(cell, rangeUnit)

            this.addKillUnitUndo(rangeUnit)

            this.moves = 0

            this.removeSelect()
            return true
        }
        if (cell.unit.notEmpty()) {
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