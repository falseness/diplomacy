class InteractionWithArcher extends InteractionWithRangeUnit {
    constructor(speed, range, borderStrokeWidth = 0.1 * basis.r) {
        super(speed, range, borderStrokeWidth = 0.1 * basis.r)
        this.standartRangeWay = new ArcherRangeWay()
        this.hillRangeWay = new RangeWay()
        this.standartRange = this.range
        this.rangeWay = this.standartRangeWay
    }
    // range and range way depend on the archer's current cell (hill/tower/town); the AI never
    // selects its units, so they are recomputed on every move, at turn start and before commands
    updateRange(archer) {
        if (archer.onHill) {
            this.range = this.standartRange + archer.rangeIncrease
            this.rangeWay = this.hillRangeWay
        }
        else {
            this.range = this.standartRange
            this.rangeWay = this.standartRangeWay
        }
    }
    select(archer) {
        this.updateRange(archer)
        super.select(archer)
    }
    changeCoord(coord, archer, killUnit) {
        super.changeCoord(coord, archer, killUnit)
        this.updateRange(archer)
    }
    getAvailableCommandDestinations(archer) {
        this.updateRange(archer)
        return super.getAvailableCommandDestinations(archer)
    }
}
class ArcherRangeWay extends RangeWay {
    isCellImpassable(neighbour, v0, arr, player) {
        return false
    }
    notUsedHandler(v, coord, moves, player, used, Q, enemyEntityQ = []) {
        this.markCoord(v, coord, used)
        if (grid.getBuilding(coord).isBarrier()) {
            this.distance[coord.x][coord.y] = Math.max(moves, this.distance[v.x][v.y] + 1)
            // now it might not be an enemy but it doesn't matter
            enemyEntityQ.push(coord)
            return
        }
        Q.push(coord)
    }
}