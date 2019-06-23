function createEvents()
{
    document.addEventListener('click', click)
}
function click(event)
{
    let pos = getRealEventPos(event)
    //let coord = getCoord(pos.x, pos.y)
    
    //console.log(coord.x, coord.y)
    
    gameEvent.click(pos)
}
class Events
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
    getSelected()
    {
        return this.selected.entity
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
    clickOnCell(coord)
    {
        console.log(coord.x, coord.y)
        let cell = grid.arr[coord.x][coord.y]
        this.selectSomethingOnCell(cell)
    }
    hideAll()
    {
        border.clean()
        grid.setDrawLogicText(false)
        
        this.interface.town.setVisible(false)
    }
    nextTurn()
    {
        if (this.selected)
        {
            this.selected.entity.removeSelect()
            this.selected = false
        }
        this.hideAll()
    }
    click(pos)
    {
        if(nextTurnButton.click(pos))
            return
        
        if (this.interface.town.click(pos))
            return
            
        let coord = getCoord(pos.x, pos.y)
        if (isCoordNotOnMap(coord, grid.arr.length, grid.arr[0].length))
        {
            this.hideAll()
            this.selected = false
  
            return
        }
        
        if (this.selected)
        {
            let instructionsAreNotLongerNeeded = this.selected.entity.sendInstructions(grid.arr[coord.x][coord.y])
            if (instructionsAreNotLongerNeeded)
                this.selected = false
        }
        else
            this.clickOnCell(coord)
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