class Nature extends Building {
    constructor(x, y, name) {
        super(x, y, name)
        nature.push(this)
    }
    hasBar() {
        return false
    }
    isObstacle() {
        return true
    }
    get isNature() {
        return true
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
    get info() {
        let res = {
            name: this.name,
            isDescriptionInfo: true,
            info: "units can't stand on it"
        }
        return res
    }
    nextTurn() {}
}