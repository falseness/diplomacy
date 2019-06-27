function createEvents() {
    document.addEventListener('click', click)
    document.addEventListener('mousemove', mousemove)
    document.addEventListener('mousewheel', mousewheel)
}

function click(event) {
    let pos = getEventPos(event)
    let realPos = getRealEventPos(event)
    gameEvent.click(pos, realPos)
}

function mousemove(event) {
    let pos = getEventPos(event)
    let realPos = getRealEventPos(event)
    gameEvent.mousemove(pos, realPos)
}

function mousewheel(event) {
    let pos = getEventPos(event)
    gameEvent.mousewheel(pos, event.wheelDelta)
}
class Events {
    constructor(_townInterface, _entityInterface) {
        this.selected = new Empty()
        this.interface = {
            town: _townInterface,
                entity: _entityInterface
        }

        this.screen = new Screen(0.1 * height, 0.015 * height)
        this.extremeScreen = new Screen(0.005 * height, 0.02 * height)
    }
    mousewheel(pos, scale) {
        this.screen.scale(pos, scale)
    }
    mousemove(pos, realPos) {
        if (!this.interface.town.getVisible())
            this.screen.changeSpeed(pos)

        this.extremeScreen.changeSpeed(pos)
    }
    moveScreen() {
        this.screen.move()
        this.extremeScreen.move()
    }
    draw(ctx) {
        this.screen.draw(ctx)
        this.extremeScreen.draw(ctx)
    }
    getSelected() {
        return this.selected
    }
    selectSomethingOnCell(cell) {
        if (cell.unit.notEmpty()) {
            cell.unit.select()
            this.selected = cell.unit
        } else if (cell.building.notEmpty()) {
            cell.building.select()
            this.selected = cell.building
        }
    }
    clickOnCell(coord) {
        console.log(coord.x, coord.y)
        let cell = grid.arr[coord.x][coord.y]
        this.selectSomethingOnCell(cell)
    }
    hideAll() {
        border.clean()
        grid.setDrawLogicText(false)

        this.interface.entity.setVisible(false)
        this.interface.town.setVisible(false)
    }
    nextTurn() {

        this.selected.removeSelect()
        this.selected = new Empty()
        this.hideAll()
    }
    sendInstructions(coord) {
        let instructionsAreNotLongerNeeded = this.selected.sendInstructions(grid.arr[coord.x][coord.y])
        if (instructionsAreNotLongerNeeded)
            this.selected = new Empty()
    }
    click(pos, realPos) {
        if (nextTurnButton.click(pos))
            return

        if (this.interface.entity.click(pos))
            return
        if (this.interface.town.click(pos))
            return

        let coord = getCoord(realPos.x, realPos.y)
        if (isCoordNotOnMap(coord, grid.arr.length, grid.arr[0].length)) {
            this.hideAll()
            this.selected.removeSelect()
            this.selected = new Empty()

            return
        }

        if (this.selected.needInstructions()) {
            this.sendInstructions(coord)
        } else {
            this.selected.removeSelect()
            this.clickOnCell(coord)
        }
    }
}
/*class Events
{
    constructor(_townInterface, _entityInterface)
    {
        this.selected = false
        this.interface = 
        {
            town: _townInterface,
            entity: _entityInterface
        }
    }
    click(cell)
    {
        if (this.selected)
        {
            
        }
        else
        {
            this.selectSomethingOnCell(cell)
        }
        /*
        this.interface.town.hide()
        
        let coord = getCoord(event.target.attrs.x, event.target.attrs.y)
        
        console.log(coord.x + ' ' + coord.y)
        
        let entity

        if (this.selected)
        {
            entity = this.selected
            this.removeSelect(coord.x, coord.y)
        }
        else
        {
            this.interface.entity.draw()
            entity = this.select(coord.x, coord.y)
        }
        
        this.interface.entity.change(entity.getInfo(), players[entity.player].getHexColor())*/
/*
    }
    selectSomethingOnCell(cell)
    {
        if (cell.unit.notEmpty())
        {
            cell.unit.select()
            this.selected = {entity:cell.unit, type: 'unit'}
        }
        else if (cell.building.notEmpty())
        {
            cell.building.select()
            this.selected = {entity:cell.building, type: 'building'}
        }
    }
    select(x, y)
    {
        let hexagon = grid.arr[x][y]
        let entity = hexagon.unit.isEmpty()?hexagon.building:hexagon.unit //Эту строчку нужно переделать
        
        this.selected = entity.select(grid.arr)?entity:false

        return entity
    }
    removeSelect(x, y)
    {
        if (this.selected.removeSelect(x, y))
        {
            layers.entityInterface.visible(false)
            this.selected = false
        }
        else
            this.select(this.selected.coord.x, this.selected.coord.y)
    }
    nextTurn()
    {
        this.selected = false
    }
}*/