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