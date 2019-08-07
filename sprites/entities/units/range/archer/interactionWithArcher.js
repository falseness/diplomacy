class InteractionWithArcher extends InteractionWithRangeUnit {
    constructor(speed, range, borderStrokeWidth = 0.1 * basis.r) {
        super(speed, range, borderStrokeWidth = 0.1 * basis.r)
        this.standartRangeWay = new ArcherRangeWay()
        this.hillRangeWay = new RangeWay()
        this.standartRange = this.range
        this.rangeWay = this.standartRangeWay
    }
    select(archer) {
        if (archer.onHill) {
            this.range = this.standartRange + archer.rangeIncrease
            this.rangeWay = this.hillRangeWay
        }
        else {
            this.range = this.standartRange
            this.rangeWay = this.standartRangeWay
        }
        super.select(archer)
    }
}
class ArcherRangeWay extends RangeWay {
    notUsedHandler(v, coord, moves, player, used, Q, enemyEntityQ = []) {
        this.markCoord(v, coord, used)
        if (grid.getBuilding(coord).isWall()) {
            this.distance[coord.x][coord.y] = Math.max(moves, this.distance[v.x][v.y] + 1)
            enemyEntityQ.push(coord)
            return
        }
        Q.push(coord)
    }
}