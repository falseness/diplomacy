class Farm extends Building
{
    constructor(x, y, income, town)
    {
        let hp = 12
        super(x, y, 'farm', hp)
        
        this.income = income
        this.town = town
    }
    getInfo()
    {
        let farm = super.getInfo()
        
        farm.info.income = this.income
        
        return farm
    }
    nextTurn()
    {
        
    }
}