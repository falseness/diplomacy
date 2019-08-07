class InteractionWithArcher extends InteractionWithRangeUnit {
    constructor(speed, range, borderStrokeWidth = 0.1 * basis.r) {
        super(speed, range, borderStrokeWidth = 0.1 * basis.r)
        this.rangeWay = new ArcherRangeWay()
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