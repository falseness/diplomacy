class Farm extends Building {
    constructor(x, y, town) {
        const hp = 3
        const healSpeed = 1
        // позже объедини FarmProduction и  BarrackProduction 
        // и убери у них income
        super(x, y, 'farm', hp, healSpeed)

        const income = 2 
        this.income = income
        this.town = town
    }
    toJSON() {
        let res = {}
        
        res.name = name
        res.coord = {}
        res.coord.x = this.coord.x
        res.coord.y = this.coord.y
        res.hp = this.hp
        res.income = this.income
        res.town = {coord: this.town.getCoord()}
        res.wasHitted = this.wasHitted
        
        return res
    }
    getIncome() {
        return this.income
    }
    getPlayer() {
        return this.town.getPlayer()
    }
    kill() {
        super.kill()

        this.town.updateBuildingsArray()
    }
    getInfo() {
        let farm = super.getInfo()

        farm.info.income = this.income

        return farm
    }
}