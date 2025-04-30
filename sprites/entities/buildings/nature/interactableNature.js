// todo: refactor. it is actually nature
class InteractableNature extends Nature {
    get info() {
        let res = super.info
        res.info += "\narchers can't shoot through it"
        return res
    }
    isBarrier() {
        return true
    }
    isObstacle() {
        return false
    }
    get isHitable() {
        return false
    }
    get isStandable() {
        return true
    }
    get isPassable() {
        return true
    }
    get canBeDestroyed() {
        return true
    }
}

class Bush extends InteractableNature {
    constructor(x, y) {
        const name = 'bush'
        super(x, y, name)
    }
}

class Hill extends InteractableNature {
    static rangeIncrease = 1
    constructor(x, y) {
        // is not done and probably won't be
        const name = 'mountain'
        super(x, y, name)
    }
    get rangeIncrease() {
        return this.constructor.rangeIncrease
    }
    get info() {
        let info = super.info
        info.info += '\nrange increase: ' + this.rangeIncrease
        info.info += "\nhiground"
        return info
    }
}