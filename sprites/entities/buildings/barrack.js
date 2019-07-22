class Barrack extends Building {
    constructor(x, y, income, town) {
        const hp = 6
        const healSpeed = 1
        super(x, y, 'barrack', hp, healSpeed)

        this.income = income
        this.town = town
        
        this.unitProduction = new Empty()
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
    prepare(what) {
        if (this.town.getGold() < townProduction[what].cost)
            return false
        if (this.unitProduction.notEmpty())
            return false
        
        this.town.minusGold(townProduction[what].cost)
        this.unitProduction = new townProduction[what].production(
            townProduction[what].turns, townProduction[what].cost, 
            townProduction[what].class, what)

        return true
    }
    select() {
        super.select()
        if (this.isMyTurn())
            barrackInterface.change(this.getInfo(), players[this.getPlayer()].getFullColor())    
    }
    removeSelect() {
        border.setVisible(false)
        grid.setDrawLogicText(false)
        super.removeSelect()
        barrackInterface.setVisible(false)
    }
    getInfo() {
        let barrack = super.getInfo()

        barrack.info.income = this.income
        barrack.town = {
            gold: (this.town.getInfo()).info.gold
        }
        if (this.unitProduction.notEmpty()) {
            barrack.info.train = this.unitProduction.getName()
            barrack.info.turns = this.unitProduction.turns
        }

        return barrack
    }
    unitPreparingLogic() {
        if (this.unitProduction.isEmpty())
            return
        
        let preparingFinished = this.unitProduction.nextTurn()
        if (!preparingFinished)
            return
            
        if (grid.arr[this.coord.x][this.coord.y].unit.notEmpty()) {
            this.unitProduction.cantCreateNow()
            return
        }
        let newUnit = this.unitProduction.create(this.coord.x, this.coord.y, this.town)
        this.town.units.push(newUnit)
        
        this.unitProduction = new Empty()
    }
    nextTurn(whooseTurn) {
        if (!this.isMyTurn())
            return
        
        this.unitPreparingLogic()
    }
}