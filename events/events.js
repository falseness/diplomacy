function createEvents() {
    document.addEventListener('click', click)
    
    if (!mobilePhone) {
        document.addEventListener('mousemove', mousemove)
        document.addEventListener('wheel', mousewheel)

        document.addEventListener('keydown', keydown)
        document.addEventListener('keyup', keyup)
        window.addEventListener('blur', windowBlur)
    }
    else {
        document.addEventListener('touchstart', touchstart)
        document.addEventListener('touchmove', touchmove)
        document.addEventListener('touchend', touchend)
        document.addEventListener('touchcancel', touchend)
    }
}
// The menu has its own listeners (menu.setEvents); the game's must not act on
// the game left behind or on its hidden buttons while the menu is shown.
function removeEvents() {
    document.removeEventListener('click', click)
    document.removeEventListener('mousemove', mousemove)
    document.removeEventListener('wheel', mousewheel)
    document.removeEventListener('keydown', keydown)
    document.removeEventListener('keyup', keyup)
    window.removeEventListener('blur', windowBlur)
    document.removeEventListener('touchstart', touchstart)
    document.removeEventListener('touchmove', touchmove)
    document.removeEventListener('touchend', touchend)
    document.removeEventListener('touchcancel', touchend)
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
    if (gameEvent.keyboardZoom(event))
        return
    gameEvent.keyboard(event.keyCode, event.shiftKey, event.repeat, event.timeStamp)
}
function keyup(event) {
    gameEvent.releaseZoomKey(event)
    gameEvent.keyup(event.keyCode, event.timeStamp)
}
function click(event) {
    let pos = getEventPos(event)
    let realPos = getRealEventPos(event)
    gameEvent.click(pos, realPos)
}

function mousemove(event) {
    let pos = getEventPos(event)
    let realPos = getRealEventPos(event)
    if (event.target?.tagName == 'CANVAS')
        gameEvent.setPointerPosition(pos)
    gameEvent.mousemove(pos, realPos, event.timeStamp)
}
// a key released while the window is unfocused never sends keyup
function windowBlur() {
    gameEvent.resetKeyboardZoom()
    gameEvent.resetCameraInput()
}
function isEditableTarget(target) {
    if (!target)
        return false
    return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || !!target.isContentEditable
}

// ctrl+wheel is the browser's page zoom; the map must not zoom along with it
function mousewheel(event) {
    if (event.ctrlKey)
        return
    let pos = getEventPos(event)
    gameEvent.mousewheel(pos, event.wheelDelta ?? -event.deltaY)
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
        // insertion order keeps the most recently pressed key last
        this.pressed_horizontal_keys = new Set()
        this.pressed_vertical_keys = new Set()
        this.mouseEdgeDirection = { x: 0, y: 0 }
        // last mouse position over the canvas in device pixels (getEventPos), the keyboard zoom anchor
        this.pointerPosition = null
        // physical zoom keys (event.code) held since their zooming keydown -> zoom direction; last pressed wins
        this.heldZoomKeys = new Map()
        // current smooth keyboard zoom: { direction, applied: ln of zoom applied so far }, null when idle
        this.keyboardZoomMotion = null

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
                // the zoom step is relative to the previous touchmove, not to the touchstart
                this.pitchStartDist = pointPythagorean(pos[0], pos[1])
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
    static kILetterKeycode = 73
    static kKeyboardZoomStep = 1.1
    // keyboard zoom runs smoothly at one step per this many ms; a tap zooms exactly one step
    static kKeyboardZoomStepDuration = 100
    // 1 zoom in, -1 zoom out, 0 not a zoom shortcut; Ctrl/Meta/Alt combinations stay browser zoom
    getZoomShortcutDirection(event) {
        if (event.ctrlKey || event.metaKey || event.altKey)
            return 0
        // the =/+ key zooms in with or without Shift
        if (event.code == 'NumpadAdd' || event.code == 'Equal' || event.key == '+' || event.key == '=')
            return 1
        if (event.code == 'NumpadSubtract' || event.key == '-')
            return -1
        return 0
    }
    // starts a smooth zoom per physical press during gameplay; returns true if the event was consumed
    keyboardZoom(event) {
        if (menu.visible) {
            this.resetKeyboardZoom()
            return false
        }
        if (isEditableTarget(event.target))
            return false
        const direction = this.getZoomShortcutDirection(event)
        if (!direction)
            return false
        event.preventDefault()
        const key = event.code || event.key
        if (event.repeat || this.heldZoomKeys.has(key))
            return true
        this.heldZoomKeys.set(key, direction)
        this.keyboardZoomMotion = { direction, applied: 0 }
        return true
    }
    releaseZoomKey(event) {
        this.heldZoomKeys.delete(event.code || event.key)
    }
    resetKeyboardZoom() {
        this.heldZoomKeys.clear()
        this.keyboardZoomMotion = null
    }
    // zooms while a key is held; after release finishes the current press up to one full step
    updateKeyboardZoom(frameDuration) {
        if (!this.heldZoomKeys.size && !this.keyboardZoomMotion)
            return
        if (menu.visible) {
            this.resetKeyboardZoom()
            return
        }
        const held = this.heldZoomKeys.size > 0
        if (held) {
            const direction = [...this.heldZoomKeys.values()].pop()
            if (this.keyboardZoomMotion?.direction != direction)
                this.keyboardZoomMotion = { direction, applied: 0 }
        }
        const motion = this.keyboardZoomMotion
        if (!motion)
            return
        const step = Math.log(Events.kKeyboardZoomStep)
        let amount = step * Math.min(frameDuration, Screen.kMaxFrameDuration) / Events.kKeyboardZoomStepDuration
        if (!held)
            amount = Math.min(amount, step - motion.applied)
        if (amount <= 0) {
            this.keyboardZoomMotion = null
            return
        }
        this.screen.zoomBy(this.getZoomAnchor(), Math.exp(motion.direction * amount))
        motion.applied += amount
    }
    setPointerPosition(pos) {
        if (Number.isFinite(pos.x) && Number.isFinite(pos.y) &&
                pos.x >= 0 && pos.x <= WIDTH && pos.y >= 0 && pos.y <= HEIGHT)
            this.pointerPosition = { x: pos.x, y: pos.y }
    }
    getZoomAnchor() {
        return this.pointerPosition ?? { x: WIDTH / 2, y: HEIGHT / 2 }
    }
    isPressKeyCode(keycode) {
        let keys = new Set([Events.kEnterKeycode, Events.kEscapeKeycode, Events.kZKeycode, Events.kBackspaceKeycode,
            Events.kILetterKeycode])
        
        return keys.has(keycode)
    }
    keyboard(keycode, isShiftPressed, isRepeat = false, time = undefined) {
        if (this.isPressKeyCode(keycode)) {
            if (keycode == Events.kEscapeKeycode) {
                debug = !debug
                return
            }
            if (keycode == Events.kILetterKeycode) {
                grid.showChanceOfWinning = true
                grid.fillChancesOfWinning(this.selected)
                return
            }
            
            if (this.waitingMode) {
                return
            }
            
            if (keycode == Events.kEnterKeycode) {
                // A held key must not end the turns of the next players (or select their units) unseen.
                if (isRepeat)
                    return
                if (isShiftPressed) {
                    // the same 1-second guard as the mouse next-turn button
                    if (nextTurnButton.unactive)
                        return
                    nextTurnPauseInterface.hideButDontUpdateTimer()
                    nextTurn()
                    nextTurnButton.deactivate()
                    return
                }
                // Behind the 'Player N' overlay Enter only dismisses it, as a click does.
                if (nextTurnPauseInterface.visible) {
                    nextTurnPauseInterface.click()
                    return
                }
                if (nextTurnButton.highlightButton) {
                    if (nextTurnButton.unactive)
                        return
                    nextTurn()
                    nextTurnButton.deactivate()
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
                // moveTo stops the camera; keep held keys and mouse edge scrolling
                this.updateScreenSpeed()
                return
            }
            if (keycode == Events.kZKeycode || keycode == Events.kBackspaceKeycode) {
                AiRuntime.undoHumanCommand()
            }
            return 
        }
        
        if (this.goLeftKeys.has(keycode) || this.goRightKeys.has(keycode)) {
            // auto-repeat keeps the original press order
            if (!isRepeat)
                this.pressed_horizontal_keys.delete(keycode)
            this.pressed_horizontal_keys.add(keycode)
            this.updateScreenSpeed(time)
        }
        else if (this.goUpKeys.has(keycode) || this.goDownKeys.has(keycode)) {
            if (!isRepeat)
                this.pressed_vertical_keys.delete(keycode)
            this.pressed_vertical_keys.add(keycode)
            this.updateScreenSpeed(time)
        }
        
        /*if (keycode == 81) {
            saveManager.save()
        }
        if (keycode == 87) {
            saveManager.load()
        }*/
    }
    keyup(keycode, time = undefined) {
        // a 65 
        // w 87
        // d 68
        // s 83
        if (this.pressed_horizontal_keys.delete(keycode) ||
                this.pressed_vertical_keys.delete(keycode))
            this.updateScreenSpeed(time)
    }
    // held keys win on their axis; otherwise the mouse edge direction applies
    getKeysDirection(pressedKeys, negativeKeys) {
        if (pressedKeys.size == 0)
            return null
        let lastKey = [...pressedKeys].pop()
        return negativeKeys.has(lastKey) ? -1 : 1
    }
    // forgets held camera keys and the mouse edge direction, stopping their scrolling
    resetCameraInput() {
        this.pressed_horizontal_keys.clear()
        this.pressed_vertical_keys.clear()
        this.mouseEdgeDirection = { x: 0, y: 0 }
        this.updateScreenSpeed()
    }
    updateScreenSpeed(time = undefined) {
        this.screen.advanceTo(time)
        let x = this.getKeysDirection(this.pressed_horizontal_keys, this.goLeftKeys)
        let y = this.getKeysDirection(this.pressed_vertical_keys, this.goUpKeys)
        this.screen.setDirectionX(x ?? this.mouseEdgeDirection.x)
        this.screen.setDirectionY(y ?? this.mouseEdgeDirection.y)
    }
    mousewheel(pos, scale) {
        this.screen.scale(pos, scale)
    }
    mousemove(pos, realPos, time = undefined) {
        this.mouseEdgeDirection = this.screen.getEdgeDirection(pos)
        this.updateScreenSpeed(time)
    }
    moveScreen(frameDuration, frameTime = undefined) {
        this.updateKeyboardZoom(frameDuration)
        this.screen.move(frameDuration, frameTime)
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
        grid.clearChancesOfWinning()
        this.selected.removeSelect()
        this.selected = new Empty()
        this.hideAll()
    }
    sendInstructions(coord) {
        let instructionsAreNotLongerNeeded = this.selected.sendInstructions(grid.arr[coord.x][coord.y])
        AiRuntime.recordHumanCommand()
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
        if (isCoordNotOnMap(coord, grid.arr.length, grid.arr[0].length) ||
            grid.arr[coord.x][coord.y].building.isMapEdge) {
            this.hideAll()
            this.selected.removeSelect()
            this.selected = new Empty()

            return
        }
        
        const hidden = isFogOfWar && !grid.fogOfWar[coord.x][coord.y]
        if (!hidden && coordsEqually(this.selected.coord, coord)) {
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
        if (hidden) {
            this.hideAll()
            this.selected.removeSelect()
            this.selected = new Empty()
            // Public landmarks may be inspected without consulting the hidden
            // occupant. Keep this after the normal instruction/legality path.
            const building = grid.arr[coord.x][coord.y].building
            if (isFogLandmark(building)) {
                building.select()
                this.selected = building
            }

            return
        }
        this.selected.removeSelect()
        this.clickOnCell(coord)
        if (this.waitingMode) {
            this.interface.barrack.visible = this.interface.town.visible = false; 
        }
    }
}

// replace Events with this class for map creation
class EventsMapCreation {
    static bushes_coords = []
    static vertical_line_symmery = true
    clickOnCell(coord) {
        this.addBush(coord)
        if (!this.constructor.vertical_line_symmery) {
            return
        }
        let new_coord = {
            x: grid.arr.length - coord.x - 1,
            y: coord.y
        }
        this.addBush(new_coord)
    
    }
    pop_bushes_coords() {
        if (this.constructor.bushes_coords.length == 0) {
            return
        }
        let coord = this.constructor.bushes_coords[this.constructor.bushes_coords.length - 1]
        let cell = grid.arr[coord.x][coord.y]
        cell.building = new Empty()
        this.constructor.bushes_coords.pop()
    }
    keyboard(keycode, isShiftPressed, isRepeat, time) {
        if (keycode != Events.kBackspaceKeycode) {
            super.keyboard(keycode, isShiftPressed, isRepeat, time)
            return
        }
        this.pop_bushes_coords()
        if (this.constructor.vertical_line_symmery) {
            this.pop_bushes_coords()
        }
    }
    addBush(coord) {
        let cell = grid.arr[coord.x][coord.y]
        if (!cell.building.isEmpty()) {
            console.log('trying to create on empty building')
            return
        }
        cell.building = new Bush(coord.x, coord.y)

        this.constructor.bushes_coords.push(coord)
        console.log(JSON.stringify(this.constructor.bushes_coords))
    }
};
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

// WebKit can suppress the compatibility click when a canvas changes during a
// touch. Handle a stationary single-finger tap directly, and suppress the later
// compatibility click so Chromium does not activate the same control twice.
if (mobilePhone) {
    let tapStart = null
    document.addEventListener('touchstart', event => {
        tapStart = event.target.tagName === 'CANVAS' && event.touches.length === 1
            ? {x: event.touches[0].clientX, y: event.touches[0].clientY} : null
    }, {passive: true})
    document.addEventListener('touchmove', event => {
        if (tapStart && (event.touches.length !== 1 ||
            Math.hypot(event.touches[0].clientX - tapStart.x,
                event.touches[0].clientY - tapStart.y) > 10)) tapStart = null
    }, {passive: true})
    document.addEventListener('touchcancel', () => { tapStart = null }, {passive: true})
    document.addEventListener('touchend', event => {
        const activate = tapStart && event.touches.length === 0
        tapStart = null
        if (!activate || typeof menu === 'undefined' || !menu) return
        event.preventDefault()
        if (menu.visible) menuClick(event)
        else click(event)
    }, {passive: false})
}
