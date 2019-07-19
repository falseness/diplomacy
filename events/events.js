function createEvents() {
    document.addEventListener('click', click)
    
    if (!mobilePhone) {
        document.addEventListener('mousemove', mousemove)
        document.addEventListener('mousewheel', mousewheel)

        document.addEventListener('keydown', keyboard)
    }
    else {
        document.addEventListener('touchstart', touchstart)
        document.addEventListener('touchmove', touchmove)
        document.addEventListener('touchend', touchend)
    }
}

/*document.addEventListener('touchmove', function(event) {
event.preventDefault();
event.stopPropagation();

}, false);

document.addEventListener('touchend', function(event) {
event.preventDefault();
event.stopPropagation();
    
}, false);*/
function touchstart(event) {
    event.preventDefault()
    event.stopPropagation()
    
    let pos = getEventPos(event)
    gameEvent.touchstart(pos)
}
function touchmove(event) {
    event.preventDefault()
    event.stopPropagation()
    
    let pos = getEventPos(event)
    gameEvent.touchmove(pos)
}
function touchend(event) {
    event.preventDefault()
    event.stopPropagation()
    
    let pos = getEventPos(event)
    //gameEvent.touchend(pos)
}
function keyboard(event) {
    gameEvent.keyboard(event.keyCode)
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

        this.lastKeyboardPressTime = 0
        this.keyboardPressInterval = 100

        this.interface = {
            town: _townInterface,
                entity: _entityInterface
        }
        if (!mobilePhone) {
            this.screen = new Screen(nextTurnButtonSize, 0.015 * HEIGHT)
            this.extremeScreen = new Screen(0.005 * HEIGHT, 0.02 * HEIGHT)
        }
        else {
            this.mobileSreen = new MobileScreen()
            this.touchStartPoint = {}
            this.touchStartTime = 0
            this.minTouchOffset = 0.005 * HEIGHT
            this.minTouchInterval = 200
        }
    }
    touchend(pos) {
        
    }
    touchmove(pos) {
        let touchOffset = {
            x: pos.x - this.touchStartPoint.x,
            y: pos.y - this.touchStartPoint.y
        }
        
        if(Math.abs(touchOffset.x) > this.minTouchOffset){
            this.mobileScreen.setSpeedX(-touchOffset.x);
            this.touchStartPoint.x = pos.x
        }
    }
    touchstart(pos) {
        this.touchStartPoint.x = pos.x
        this.touchstartPoint.y = pos.y
        this.touchStartTime = new Date()
        
        return
        /*
        document.addEventListener('touchmove', function(event) {
        event.preventDefault();
        event.stopPropagation();
        var otk={};
        nowPoint=event.changedTouches[0];
        otk.x=nowPoint.pageX-startPoint.x;
        if(Math.abs(otk.x)>200){
        if(otk.x<0){}
        if(otk.x>0){}
        startPoint={x:nowPoint.pageX,y:nowPoint.pageY};
        }
        }, false);
        document.addEventListener('touchend', function(event) {
        var pdelay=new Date(); 
        nowPoint=event.changedTouches[0];
        var xAbs = Math.abs(startPoint.x - nowPoint.pageX);
        var yAbs = Math.abs(startPoint.y - nowPoint.pageY);
        if ((xAbs > 20 || yAbs > 20) && (pdelay.getTime()-ldelay.getTime())<200) {
        if (xAbs > yAbs) {
        if (nowPoint.pageX < startPoint.x){/*СВАЙП ВЛЕВО}
        else{/*СВАЙП ВПРАВО}
        }
        else {
        if (nowPoint.pageY < startPoint.y){/*СВАЙП ВВЕРХ}
        else{/*СВАЙП ВНИЗ}
        }
        }
        }, false);
        */
    }
    keyboard(keycode) {
        if (Date.now() - this.lastKeyboardPressTime < this.keyboardPressInterval)
            return

        this.lastKeyboardPressTime = Date.now()
        if (keycode == 13)
            nextTurn()
        if (keycode == 27)
            debug = !debug
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
        if (!mobilePhone) {
            this.screen.move()
            this.extremeScreen.move()
        }
        else
            this.mobileSreen.move()
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