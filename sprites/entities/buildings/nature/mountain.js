class Mountain extends StaticNature {
    constructor(x, y) {
        const name = 'mountain'
        super(x, y, name)
    }
    get info() {
        let res = super.info
        res.info += "\narchers can't shoot through it" 
        return res
    }
    isBarrier() {
        return true
    }
}

// Rectangular storage remains intact while these cells carve out a hex map.
class InvisibleMountain extends Mountain {
    constructor(x, y) {
        super(x, y)
        this.name = 'invisibleMountain'
    }
    get isInvisible() {
        return true
    }
    get isMapEdge() {
        return true
    }
    draw() {}
    select() {}
}
