class Nature extends Building {
    constructor(x, y, name) {
        super(x, y, name)
        nature.push(this)
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
            info: ""
        }
        return res
    }
    nextTurn() {}
}

// nature that does not change over game and is impassable
class StaticNature extends Nature {
    get info() {
        let res = super.info
        res.info += "units can't stand on it" 
        return res
    }
    isObstacle() {
        return true
    }
    // it seems that it is about "hittable by range unit or not"
    get hasBar() {
        return false
    }
    get isAlwaysVisible() {
        return true
    }

    get isStaticNature() {
        return true;
    }
}