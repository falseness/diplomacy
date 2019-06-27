class Building extends Entity {
    constructor(x, y, name, hp) {
        super(x, y, name, hp)
        grid.arr[x][y].building = this
    }
    needInstructions() {
        return false
    }
    select() {
        entityInterface.change(this.getInfo(), players[this.getPlayer()].getFullColor())
    }
    removeSelect() {
        entityInterface.setVisible(false)
    }
}