class Catapult extends RangeUnit {
    constructor(x, y, town) {
        const hp = 3
        const healSpeed = 1
        const dmg = 1
        const speed = 1
        const salary = 6
        const range = 5
        super(x, y, 'catapult', hp, healSpeed, dmg, range, speed, salary, town)
        this.buildingDMG = 3
        this.mirrorX = false
    }
    get info() {
        let unit = super.getInfo()
        unit.info.dmg += '\nbuilding dmg: ' + this.getBuildingDMG()
        return unit
    }
    getBuildingDMG() {
        return this.buildingDMG
    }
    cellHasEnemy(cell) {
        return (this.cellHasEnemyBuilding(cell) ||
                (cell.unit.notEmpty() && cell.unit.getPlayer() != this.getPlayer))
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
        // catapult cant attack close
        if (this.way.getDistance(coord) <= this.moves && this.cellHasEnemy(cell)) {
            this.removeSelect()
            return true
        }
            
        
        if (this.cellHasEnemyBuilding(cell)) {
            this.addUndo()
            
            cell.building.hit(this.getBuildingDMG())

            this.moves = 0
            this.removeSelect()
            return true
        }
        if (cell.unit.notEmpty()) {
            if (cell.unit.getPlayer() != this.getPlayer()) {
                this.addUndo()
                
                cell.unit.hit(this.getDMG())

                this.moves = 0
            }
            this.removeSelect()
            return true
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
    move(coord, arr) {
        let oldX = this.coord.x
        super.move(coord, arr)
        let newX = this.coord.x

        this.mirrorX = newX < oldX
    }
    draw(ctx) {
        drawImage(ctx, this.mirrorX ? 'catapultLeft' : this.name, this.getPos())
    }
}