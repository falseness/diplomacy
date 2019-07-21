class Farm extends Building {
    constructor(x, y, income, town) {
        const hp = 4
        const healSpeed = 1
        super(x, y, 'farm', hp, healSpeed)

        this.income = income
        this.town = town
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