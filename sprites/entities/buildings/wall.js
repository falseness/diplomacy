class Wall extends Building {
    static maxHP = 5
    static healSpeed = 2
    constructor(x, y) {
        const name = 'wall'
        super(x, y, name)
        this.destroyable = true
        external.push(this)
    }
    static get description() {
        let res = super.description
        res.info['heal speed'] += "\n\narchers can't shoot through it" +
            "\nunits can't stand on it"
        return res
    }
    // obstacle -> cant stand
    // barrier -> cant shoot
    isObstacle(playerColor) {
        return this.playerColor == playerColor
    }
    isBarrier() {
        return true
    }
    get isExternal() {
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