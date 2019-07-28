class UndoManager {
    constructor() {
        this.arr = []
        this.maximumSize = 5
    }
    clear() {
        this.arr = []
    }
    addUndo() {
        if (this.arr.length == this.maximumSize)
            this.arr.shift()
        else if (this.arr.length > this.maximumSize)
            console.log("ERROR")
        
        this.arr.push([])
    }
    addToLastUndo(additive) {
        this.arr[this.arr.length - 1].push(additive)
    }
    undo() {
        return
        if (!this.arr.length)
            return
            
        //console.log(players[1].towns[0])
        //console.log(players[2].towns[0])
        
        gameEvent.hideAll()
        gameEvent.removeSelection()
        /*
        let elements = this.arr.pop()
        for (let i = elements.length - 1; i >= 0; --i) {
            let el = JSON.parse(elements[i])
            
            let x = el.hexagon.coord.x
            let y = el.hexagon.coord.y
            grid.arr[x][y].unit = new Empty()
            grid.arr[x][y].building = new Empty()
            
            unpacker.unpackHexagon(el.hexagon)
            if (el.building.name == 'town') {
                players[el.hexagon.player].deleteTownFromArray(el.building.coord)
                unpacker.unpackTown(el.building)
            }
            else {
                unpacker.fullUnpackBuilding(el.building)
            }
            
            unpacker.fullUnpackUnit(el.unit)
        }*/
    }
}