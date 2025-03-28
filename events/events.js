function createEvents() {
    document.addEventListener('click', click)
    
    if (!mobilePhone) {
        document.addEventListener('mousemove', mousemove)
        document.addEventListener('mousewheel', mousewheel)

        document.addEventListener('keydown', keydown)
        document.addEventListener('keyup', keyup)
    }
    else {
        document.addEventListener('touchstart', touchstart)
        document.addEventListener('touchmove', touchmove)
        document.addEventListener('touchend', touchend)
        document.addEventListener('touchcancel', touchend)
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
    event.stopPropagation()
    
    let pos = getTouchesPos(event)
    gameEvent.touchstart(pos, event.touches.length)
}
function touchmove(event) {
    event.stopPropagation()
    
    let pos = getTouchesPos(event)
    gameEvent.touchmove(pos, event.touches.length)
}
function touchend(event) {
    event.stopPropagation()
    
    let pos = getTouchesPos(event)
    gameEvent.touchend(pos, event.touches.length)
}
function keydown(event) {
    gameEvent.keyboard(event.keyCode, event.shiftKey)
}
function keyup(event) {
    gameEvent.keyup(event.keyCode)
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
    constructor(_barrackInterface, _townInterface, _entityInterface, 
            _statisticsInterface, _nextTurnPauseInterface) {
        this.selected = new Empty()
        // if we wait for server answer then we can not send instructions
        this.waitingMode = false

        this.interface = {
            barrack: _barrackInterface,
            town: _townInterface,
            entity: _entityInterface,
            statistics: _statisticsInterface,
            nextTurnPause: _nextTurnPauseInterface
        }
        this.goLeftKeys = new Set([65, 37])
        this.goRightKeys = new Set([68, 39])
        this.goUpKeys = new Set([87, 38])
        this.goDownKeys = new Set([83, 40])
        this.pressed_horizontal_keys = new Set()
        this.pressed_vertical_keys = new Set()

        if (!mobilePhone) {
            this.screen = new ComputerScreen(0.002 * HEIGHT, 0.04 * HEIGHT)
        }
        else {
            this.screen = new MobileScreen()
            this.pitchStartDist = 0
            this.scaling = false
            this.pitchStartPos = {}
            
            this.touchStartPoint = {}
            this.touchStartTime = 0
            this.minTouchOffset = 0//0.005 * HEIGHT
            this.minTouchInterval = 200
            this.scalingStopped = true
        }
    }
    touchend(pos, touchesCount) {
        this.scaling = false
        this.scalingStopped = !touchesCount
    }
    touchmove(pos, touchesCount) {
        if (touchesCount > 2) {
            this.scaling = false
            return
        }
        if (touchesCount == 2) {
            if (this.scaling) {
                this.screen.scale(pos, this.pitchStartDist, this.pitchStartPos)
            }
            return
        }
        this.scaling = false
        if (!this.scalingStopped)
            return
        
        let touchOffset = {  
            x: pos.x - this.touchStartPoint.x,
            y: pos.y - this.touchStartPoint.y
        }
        
        if(Math.abs(touchOffset.x) > this.minTouchOffset){
            this.screen.setSpeedX(touchOffset.x);
            this.touchStartPoint.x = pos.x
        }
        if(Math.abs(touchOffset.y) > this.minTouchOffset){
            this.screen.setSpeedY(touchOffset.y);
            this.touchStartPoint.y = pos.y
        }
    }
    touchstart(pos, touchesCount) {
        this.scaling = false
        if (touchesCount > 2)
            return
        if (touchesCount == 2) {
            this.pitchStartPos = getAveragePoint(pos)
            this.pitchStartDist = pointPythagorean(pos[0], pos[1])
            this.scaling = true
            return
        }
        this.touchStartPoint.x = pos.x
        this.touchStartPoint.y = pos.y
        this.touchStartTime = new Date()
        
        return
    }
    static kEnterKeycode = 13
    static kEscapeKeycode = 27
    static kZKeycode = 90
    static kBackspaceKeycode = 8
    isPressKeyCode(keycode) {
        let keys = new Set([Events.kEnterKeycode, Events.kEscapeKeycode, Events.kZKeycode, Events.kBackspaceKeycode])
        
        return keys.has(keycode)
    }
    keyboard(keycode, isShiftPressed) {
        if (this.isPressKeyCode(keycode)) {
            if (keycode == Events.kEscapeKeycode) {
                debug = !debug
            }
            
            if (this.waitingMode) {
                return
            }
            
            if (keycode == Events.kEnterKeycode) {
                if (isShiftPressed || nextTurnButton.highlightButton) {
                    nextTurnPauseInterface.hideButDontUpdateTimer()
                    nextTurn()
                    return
                }

                let unit = players[whooseTurn].findIdleUnit()
                if (!unit) {
                    nextTurnButton.highlightButton = true
                    return
                }
                this.removeSelection()
                unit.select()
                this.selected = unit
                this.screen.moveTo(unit.pos)
                
                return
            }
            if (keycode == Events.kZKeycode || keycode == Events.kBackspaceKeycode) {
                undoManager.undo()
            }
            return 
        }
        
        if (this.goLeftKeys.has(keycode))  {
            this.screen.goLeft()
            this.pressed_horizontal_keys.add(keycode)
        }
        else if (this.goRightKeys.has(keycode)) {
            this.screen.goRight()
            this.pressed_horizontal_keys.add(keycode);
        }
        else if (this.goUpKeys.has(keycode)) {
            this.screen.goUp()
            this.pressed_vertical_keys.add(keycode)
        }
        else if (this.goDownKeys.has(keycode)) {
            this.screen.goDown()
            this.pressed_vertical_keys.add(keycode)
        }
        
        /*if (keycode == 81) {
            saveManager.save()
        }
        if (keycode == 87) {
            saveManager.load()
        }*/
    }
    keyup(keycode) {
        // a 65 
        // w 87
        // d 68
        // s 83
        // он останавливается даже если мышка за пределами экрана, пофиксь
        
        if (this.goLeftKeys.has(keycode) || this.goRightKeys.has(keycode)) {
            this.pressed_horizontal_keys.delete(keycode)
            if (this.pressed_horizontal_keys.size == 0)
                this.screen.stopX()
        }
        if (this.goUpKeys.has(keycode) || this.goDownKeys.has(keycode)) {
            this.pressed_vertical_keys.delete(keycode)
            if (this.pressed_vertical_keys.size == 0)
                this.screen.stopY()
        }
    }
    mousewheel(pos, scale) {
        this.screen.scale(pos, scale)
    }
    mousemove(pos, realPos) {
        this.screen.changeSpeed(pos)
    }
    moveScreen() {
        this.screen.move()
    }
    draw(ctx) {
        this.screen.draw(ctx)
    }
    removeSelection() {
        this.selected.removeSelect()
        this.selected = new Empty()
    }
    selectSomethingOnCell(cell) {
        if (cell.unit.notEmpty()) {
            cell.unit.select()
            this.selected = cell.unit
        } 
        else if (cell.building.notEmpty()) {
            cell.building.select()
            this.selected = cell.building
        }
        else {
            this.selected = new Empty()
        }
    }
    clickOnCell(coord) {
        //console.log(coord.x, coord.y)
        let cell = grid.arr[coord.x][coord.y]
        this.selectSomethingOnCell(cell)
    }
    hideAll() {
        border.clean()
        grid.drawLogicText = false

        this.interface.entity.visible = false
        this.interface.barrack.visible = false
        this.interface.town.visible = false
        this.interface.statistics.visible = false
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
        let clickToButton = this.interface.nextTurnPause.click(pos) ||
            undoButton.click(pos) || backToMenuButton.click(pos) || 
            this.interface.statistics.click(pos) || this.interface.entity.click(pos) || 
            this.interface.barrack.click(pos) || this.interface.town.click(pos) || 
            nextTurnButton.click(pos) || iButton.click(pos)

        if (clickToButton)
            return 
            
        let coord = getCoord(realPos.x, realPos.y)
        if (isCoordNotOnMap(coord, grid.arr.length, grid.arr[0].length)) {
            this.hideAll()
            this.selected.removeSelect()
            this.selected = new Empty()

            return
        }
        
        if (coordsEqually(this.selected.coord, coord)) {
            this.selected.removeSelect()
            if (this.selected.isUnit) {
                this.selected = grid.arr[this.selected.coord.x][this.selected.coord.y].building
            }
            else if (this.selected.isBuilding) {
                this.selected = new Empty()
            }
            else {
                console.log("not unit and not building???")
            }
            this.selected.select()
            if (this.waitingMode) {
                this.interface.barrack.visible = this.interface.town.visible = false; 
            }
            return
        }
        
        if (!this.waitingMode && this.selected.needInstructions()) {
            this.sendInstructions(coord)
            return
        }
        if (isFogOfWar && !grid.fogOfWar[coord.x][coord.y]) {
            this.hideAll()
            this.selected.removeSelect()
            this.selected = new Empty()

            return
        }
        this.selected.removeSelect()
        this.clickOnCell(coord)
        if (this.waitingMode) {
            this.interface.barrack.visible = this.interface.town.visible = false; 
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