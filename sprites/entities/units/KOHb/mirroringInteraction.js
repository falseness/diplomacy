class MirroringInteraction extends InterationWithUnit{
    constructor(speed) {
        super(speed)
    }
    move(coord, cell, arr, unit) {
        let oldX = unit.coord.x
        
        super.move(coord, cell, arr, unit)
        
        let newX = unit.coord.x
        unit.mirrorX = newX < oldX
    }
}