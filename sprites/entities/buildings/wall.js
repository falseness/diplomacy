class Wall extends Building {
    static maxHP = 7
    static healSpeed = 2
    constructor(x, y) {
        const name = 'wall'
        super(x, y, name, hp, healSpeed)
        this.destroyable = true
        external.push(this)
    }
    static get description() {
        let res = super.description
        res.info['heal speed'] += "\n\nowner can destroy it instantly" +
            "\narchers can't shoot through it" + "\nunits can't stand on it"
        return res
    }
    get info() {
        let res = super.info
        res.destroyable = this.destroyable && this.isMyTurn
        return res
    }
    isWall() {
        return true
    }
    isBarrier() {
        return true
    }
}
function updateExternal() {
    for (let i = 0; i < external.length; ++i) {
        if (external[i].killed) {
            external.splice(i--, 1)
        }
    }
    for (let i = 0; i < externalProduction.length; ++i) {
        if (externalProduction[i].killed) {
            externalProduction.splice(i--, 1)
        }
    }
}