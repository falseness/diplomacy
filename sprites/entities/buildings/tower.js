class Tower extends Building {
    static maxHP = 7
    static healSpeed = 2
    static rangeIncrease = 1
    constructor(x, y) {
        const name = 'tower'
        super(x, y, name)
        
        external.push(this)
    }
    static get description() {
        let res = super.description
        res.info['archer range increase'] = this.rangeIncrease
        res.info['archer range increase'] += "\n\narchers can't shoot through it"
        return res
    }
    get rangeIncrease() {
        return this.constructor.rangeIncrease
    }
    get info() {
        let tower = super.info
        tower.info['range increase'] = this.rangeIncrease
        return tower
    }
    isBarrier() {
        return true
    }
    get isExternal() {
        return true
    }
}

class Bastion extends Building {
    static maxHP = 6
    static healSpeed = 2
    constructor(x, y) {
        const name = 'bastion'
        super(x, y, name)
        
        external.push(this)
    }
    static get description() {
        let res = super.description
        res.info['heal speed'] += "\n\narchers can't shoot through it"
        return res
    }
    isBarrier() {
        return true
    }
    get isExternal() {
        return true
    }
}
