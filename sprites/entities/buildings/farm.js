class Farm extends Building {
    constructor(x, y, income, town) {
        const hp = 6
        super(x, y, 'farm', hp)

        this.income = income
        this.town = town
    }
    getIncome() {
        return this.income
    }
    getInfo() {
        let farm = super.getInfo()

        farm.info.income = this.income

        return farm
    }
    nextTurn() {

    }
}