function click(event)
{
    townInterface.hide()
    let coord = getCoord(event.target.attrs.x, event.target.attrs.y)
    console.log(coord.x + ' ' + coord.y)
    //Нужно вынести это в отдельную функцию или класс:

    let entity

    if (selected)
    {
        entity = selected
        removeSelect(coord.x, coord.y)


    }
    else
    {
        entityInterface.draw()
        
        entity = select(coord.x, coord.y)
    }
    entityInterface.change(entity.getInfo(), players[entity.player].getHexColor())
}
function select(x, y)
{
    let hexagon = grid.arr[x][y]
    entity = hexagon.unit.isEmpty()?hexagon.building:hexagon.unit

    selected = entity.select(grid.arr)?entity:false

    return entity
}
function removeSelect(x, y)
{
    if (selected.move(x, y))
    {
        //selected = false Должен быть тут если что
        layers.entityInterface.visible(false)
        selected = false
    }
    else
    {
        select(selected.coord.x, selected.coord.y)
    }
}