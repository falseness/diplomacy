class RangeUnit extends Unit {
    constructor(x, y, name, hp, healSpeed, dmg, range, speed, salary, town) {
        super(x, y, name, hp, healSpeed, dmg, speed, salary, town)
        this.range = range

        this.rangeWay = new RangeWay()
    }
    select() {
        super.select()

        if (!this.moves && whooseTurn == this.getPlayer())
            return

            
        attackBorder.newBrokenLine(players[this.getPlayer()].getHexColor(), 0.1 * basis.r)
        this.rangeWay.create(this.coord, this.range, grid.arr, this.getPlayer(), attackBorder)
    }
    removeSelect() {
        attackBorder.setVisible(false)
        super.removeSelect()
    }
    sendInstructions(cell) {
        if (!this.isMyTurn())
            return true


        let coord = cell.hexagon.coord

        if (this.rangeWay.getDistance(coord) > this.range ||
            coordsEqually(this.coord, coord)) {
            this.removeSelect()
            return true
                // attack range > speed by default
        }

        if (this.cellHasEnemyBuilding(cell)) {
            cell.building.hit(this.getDMG())

            this.moves = 0
            this.removeSelect()
            return true
        }
        if (cell.unit.notEmpty()) {
            if (cell.unit.getPlayer() != this.getPlayer()) {
                cell.unit.hit(this.getDMG())

                this.moves = 0
            }
        }

        if (this.way.getDistance(coord) > this.moves) {
            this.removeSelect()
            return true
        }

        this.move(coord, grid.arr)
        if (!this.moves) {
            this.removeSelect()
            return true
        }

        this.select()
        return false
    }
}

class RangeWay extends Way {
    constructor() {
        super()
    }
    isCellImpassable() {
        return false
    }
    notUsedHandler(v, coord, moves, player, used, Q, enemyEntityQ = []) {
        Q.push(coord)
        this.distance[coord.x][coord.y] = this.distance[v.x][v.y] + 1

        this.parent[coord.x][coord.y] = v
        used[coord.x][coord.y] = true
    }
    create(v0, moves, arr, player, bord, changeLogicText = true, newBorder = false) {
        // dont chage logic text and create border by default
        super.create(v0, moves, arr, player, bord, changeLogicText, newBorder)
    }
}