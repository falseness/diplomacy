class Wall extends Building {
    constructor(x, y) {
        const name = 'wall'
        const hp = 7
        const healSpeed = 2
        super(x, y, name, hp, healSpeed)
        this.destroyable = true
        external.push(this)
    }
    get info() {
        let res = super.info
        res.destroyable = this.destroyable && this.isMyTurn
        return res
    }
    isWall() {
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