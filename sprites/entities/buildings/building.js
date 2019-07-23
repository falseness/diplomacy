class Building extends Entity {
    constructor(x, y, name, hp, healSpeed) {
        super(x, y, name, hp, healSpeed)
        grid.arr[x][y].building = this
    }
    needInstructions() {
        return false
    }
    toJson() {
        let res = {}
        
        res.name = name
        res.x = this.coord.x
        res.y = this.coord.y
        res.income = this.income
        res.town = this.town.getCoord()
        return res
    }
    kill() {
        grid.arr[this.coord.x][this.coord.y].building = new Empty()

        this.killed = true
    }
    select() {
        entityInterface.change(this.getInfo(), players[this.getPlayer()].getFullColor())
    }
    removeSelect() {
        entityInterface.setVisible(false)
    }
    isBuilding() {
        return true
    }
    nextTurn(whooseTurn) {
        if (this.getPlayer() == whooseTurn) {
            this.hp += this.getHPIncrease()
            
            this.wasHitted = false
        }
    }
}