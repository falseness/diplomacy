class Tower extends Building {
    constructor(x, y) {
        const name = 'tower'
        const hp = 5
        const healSpeed = 1
        super(x, y, name, hp, healSpeed)
        this.rangeIncrease = 1
        external.push(this)
    }
    get info() {
        let tower = super.info
        tower.info['range increase'] = this.rangeIncrease
        return tower
    }
}