class Goldmine extends Building {
    static income = 50
    static roundsToOpen = 7
    constructor(x, y) {
        super(x, y, 'goldmine')
        goldmines.push(this)
    }
    toJSON() {
        let res = {
            name: this.name,
            coord: {
                x: this.coord.x,
                y: this.coord.y
            }
        }
        return res
    }
    get potentialIncome() {
        return this.constructor.income
    }
    get income() {
        if (this.isOpened) 
            return this.potentialIncome
        return 0
    }
    get roundsToOpen() {
        return this.constructor.roundsToOpen
    }
    get isLongOpened() {
        //thats need cuz building must open/build up first work (then generate income)
        return gameRound > this.roundsToOpen
    }
    get isOpened() {
        return gameRound >= this.roundsToOpen
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
    get info() {
        let res = {
            name: this.name,
            info: {
                income: this.potentialIncome
            }
        }
        if (!this.isOpened)
            res.info['rounds to open'] = this.roundsToOpen - gameRound
        return res
    }
}