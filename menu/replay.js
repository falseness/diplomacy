// Replay viewer shell (PRD sec. 9.2), offline. A recording:
//   {snapshots: [{round, board}], turns: [{round, playerIndex, actions: [...], endHash}]}
// board: a saved game object (or its JSON text) at the start of that round, as loadFromJson reads it;
// actions: the PRD sec. 3 schema ({t:'unit', from, to, expect}, 'skip', 'train', 'build', 'destroy',
// 'undo', 'end'). The timeline has one 'start' entry per turn and one entry per action; the position
// is the last applied entry. A turn starts from its round snapshot when it is the first turn of a
// round with one, else the turn advances by the rules (income, moves, productions: nothing extra is
// stored). Stepping back reloads the round snapshot and applies the entries up to the position.
// Actions go through window.applyAction when present, otherwise through replayExecuteAction, which
// drives the same UI calls a player's clicks do. Display only: the fog view ('off' = everything
// visible, or a player's vision) and the move tween; while an action runs the fog is the acting
// player's, as in the game.
const REPLAY_ACTION_TYPES = ['unit', 'skip', 'train', 'build', 'destroy', 'undo', 'end']

// The board state without timers (they hold wall-clock time), FNV-1a 32-bit hex.
function replayStateHash() {
    const {timers, ...state} = getGameObject()
    const text = JSON.stringify(state)
    let hash = 0x811c9dc5
    for (let i = 0; i < text.length; ++i) {
        hash ^= text.charCodeAt(i)
        hash = Math.imul(hash, 0x01000193) >>> 0
    }
    return hash.toString(16).padStart(8, '0')
}

function replayCoord(coord) {
    return coord && Number.isInteger(coord.x) && Number.isInteger(coord.y) &&
        !isCoordNotOnMap(coord, grid.arr.length, grid.arr[0].length) ? grid.arr[coord.x][coord.y] : null
}

function replayClearSelection() {
    // Before the first board is loaded there is no grid.
    if (grid) gameEvent.hideAll()
    gameEvent.removeSelection()
}

function replayOwnBuilding(cell) {
    const building = cell && cell.building
    return building && building.notEmpty() && !building.killed && building.isMyTurn ? building : null
}

// {ok, reason}; a rejected action leaves the state unchanged. An accepted action pushes an
// undo entry ('undo' pops one), as the UI path does.
function replayExecuteAction(action) {
    const reject = reason => {
        replayClearSelection()
        return {ok: false, reason}
    }
    const entries = actionManager.arr.length
    const pushed = () => {
        replayClearSelection()
        return actionManager.arr.length > entries ? {ok: true} : {ok: false, reason: 'rejected by the rules'}
    }
    if (!action || !REPLAY_ACTION_TYPES.includes(action.t))
        return reject('unknown action')
    replayClearSelection()
    if (action.t === 'end')
        return {ok: true}
    if (action.t === 'undo')
        return actionManager.undo() ? {ok: true} : reject('nothing to undo')
    if (action.t === 'unit' || action.t === 'skip') {
        const from = action.t === 'unit' ? action.from : action.at
        const cell = replayCoord(from)
        const unit = cell && cell.unit
        if (!unit || unit.isEmpty() || unit.killed || !unit.isMyTurn)
            return reject('no own unit')
        if (action.expect && action.expect.name !== undefined && action.expect.name !== unit.name)
            return reject('unexpected unit')
        gameEvent.clickOnCell(from)
        if (action.t === 'skip') {
            skipMovesOfSelected()
            return pushed()
        }
        const target = replayCoord(action.to)
        if (!target || !gameEvent.selected.needInstructions())
            return reject('no target or no moves')
        gameEvent.selected.sendInstructions(target)
        return pushed()
    }
    const producerCoord = action.t === 'destroy' ? action.at : action.producer
    const building = replayOwnBuilding(replayCoord(producerCoord))
    if (!building)
        return reject('no own building')
    if (action.t === 'destroy') {
        if (action.layer !== undefined && action.layer !== replayBuildingLayer(building))
            return reject('unexpected layer')
        gameEvent.selected = building
        destroySelected()
        return pushed()
    }
    const configured = Object.prototype.hasOwnProperty.call(production, action.product) ? production[action.product] : null
    if ((building.name !== 'town' && building.name !== 'barrack') || building.isBadlyDamaged || !configured)
        return reject('cannot produce')
    const isUnit = configured.production.isUnitProduction()
    // A barrack trains units only (its panel lists no buildings).
    if (building.name === 'barrack' && !isUnit)
        return reject('cannot produce')
    if (isUnit !== (action.t === 'train'))
        return reject(isUnit ? 'a unit is trained' : 'a building needs a cell')
    const cell = isUnit ? null : replayCoord(action.at)
    if (!isUnit && !cell)
        return reject('no cell')
    gameEvent.selected = building
    building.select()
    if (!building.prepare(action.product))
        return reject('cannot prepare')
    if (!isUnit) {
        if (!building.activeProduction || !building.activeProduction.canCreateOnCell(cell, building))
            return reject('cannot build there')
        building.sendInstructions(cell)
    }
    return pushed()
}

// The action as the rules API (options/actionApi.js) takes it: its destroy layer is 'building' for every own
// building (options/actionRecorder.js records it so), while a recording may name the building's kind
// ('town', 'production'; replayBuildingLayer), which replayExecuteAction checks.
function replayEngineAction(action) {
    if (action.t === 'destroy' && (action.layer === 'town' || action.layer === 'production'))
        return {...action, layer: 'building'}
    return action
}

function replayBuildingLayer(building) {
    if (building.isTown())
        return 'town'
    if (building.isBuildingProduction())
        return 'production'
    return 'building'
}

// Cells from the unit's cell to `to` along the way its selection computed (UI only, for the tween).
function replayUnitPath(from, to) {
    const unit = grid.getUnit(from)
    if (!unit || unit.isEmpty() || !unit.interaction || !unit.interaction.way)
        return null
    gameEvent.clickOnCell(from)
    const way = unit.interaction.way
    const path = [{x: to.x, y: to.y}]
    for (let guard = 0; guard < 64 && !coordsEqually(path[0], from); ++guard) {
        const parent = way.getParent(path[0])
        if (coordsEqually(parent, path[0]))
            break
        path.unshift(parent)
    }
    replayClearSelection()
    return coordsEqually(path[0], from) ? path : null
}

class ReplaySession {
    static parse(source) {
        const recording = typeof source === 'string' ? JSON.parse(source) : source
        if (!recording || !Array.isArray(recording.snapshots) || !Array.isArray(recording.turns) ||
                !recording.snapshots.length || !recording.turns.length)
            throw new Error('not a replay: snapshots and turns needed')
        for (const turn of recording.turns) {
            if (!Number.isInteger(turn.round) || !Number.isInteger(turn.playerIndex) || !Array.isArray(turn.actions))
                throw new Error('not a replay: a turn needs round, playerIndex and actions')
        }
        if (!recording.snapshots.some(snapshot => snapshot.round === recording.turns[0].round))
            throw new Error('not a replay: no snapshot for the first round')
        return recording
    }
    constructor(source) {
        this.recording = ReplaySession.parse(source)
        this.showUndos = false
        this.fogView = 'off'
        this.position = -1
        this.results = []
        this.drift = new Set()
        this.playTimer = null
        this.speed = 1
        this.buildTimeline()
    }
    // Compacted view: an undo and the action it undid are both left out.
    turnActionIndexes(turn) {
        const indexes = []
        turn.actions.forEach((action, index) => {
            if (action.t === 'end')
                return
            if (action.t === 'undo' && !this.showUndos) {
                indexes.pop()
                return
            }
            indexes.push(index)
        })
        return indexes
    }
    buildTimeline() {
        this.entries = []
        this.turnStarts = []
        this.recording.turns.forEach((turn, turnIndex) => {
            this.turnStarts.push(this.entries.length)
            this.entries.push({kind: 'start', turn: turnIndex})
            for (const index of this.turnActionIndexes(turn))
                this.entries.push({kind: 'action', turn: turnIndex, index, action: turn.actions[index]})
        })
    }
    snapshotFor(turnIndex) {
        const turn = this.recording.turns[turnIndex]
        const previous = this.recording.turns[turnIndex - 1]
        if (previous && previous.round === turn.round)
            return null
        return this.recording.snapshots.find(snapshot => snapshot.round === turn.round) || null
    }
    // The turn whose snapshot an entry is replayed from.
    baseTurn(entryIndex) {
        let turnIndex = this.entries[entryIndex].turn
        while (turnIndex > 0 && !this.snapshotFor(turnIndex))
            --turnIndex
        return turnIndex
    }
    get turnIndex() {
        return this.position < 0 ? -1 : this.entries[this.position].turn
    }
    get turn() {
        return this.recording.turns[this.turnIndex]
    }
    get atEnd() {
        return this.position >= this.entries.length - 1
    }
    loadBoard(board) {
        moveTween.clear()
        loadFromJson(typeof board === 'string' ? board : JSON.stringify(board))
        gameSettings.isOnline = false
        actionManager.clear()
    }
    // The rules part of a turn change (advanceOfflineTurn without saves, UI and AI).
    advanceTo(playerIndex) {
        for (let guard = 0; guard < players.length; ++guard) {
            whooseTurn = (whooseTurn + 1) % players.length
            actionManager.clear()
            externalNextTurn()
            natureNextTurn()
            players[whooseTurn].nextTurn()
            if (whooseTurn === playerIndex)
                return true
        }
        return false
    }
    restoreRulesFog() {
        if (isFogOfWar && grid.visionWay)
            players[whooseTurn].changeFogOfWarByVision()
    }
    applyEntry(entryIndex, animate = false) {
        const entry = this.entries[entryIndex]
        const turn = this.recording.turns[entry.turn]
        replayClearSelection()
        if (entry.kind === 'start') {
            const snapshot = this.snapshotFor(entry.turn)
            if (snapshot) this.loadBoard(snapshot.board)
            else this.advanceTo(turn.playerIndex)
            actionManager.clear()
            this.restoreRulesFog()
            this.results[entryIndex] = whooseTurn === turn.playerIndex ? {ok: true} :
                {ok: false, reason: `turn of player ${whooseTurn}, recorded ${turn.playerIndex}`}
        } else {
            this.restoreRulesFog()
            const action = entry.action
            const unit = action.t === 'unit' ? grid.getUnit(action.from) : null
            const path = animate && unit && unit.notEmpty() ? replayUnitPath(action.from, action.to) : null
            let result
            try {
                result = typeof applyAction == 'function' ? applyAction(replayEngineAction(action)) : replayExecuteAction(action)
            } catch (error) {
                console.log('replay action failed', error)
                result = {ok: false, reason: String(error && error.message || error)}
            }
            this.results[entryIndex] = {ok: !!(result && result.ok), reason: result && result.reason}
            if (path && unit && !unit.killed && !coordsEqually(unit.coord, action.from)) {
                const end = path.findIndex(cell => coordsEqually(cell, unit.coord))
                if (end > 0) moveTween.start(unit, path.slice(0, end + 1))
            }
        }
        const next = this.entries[entryIndex + 1]
        if (turn.endHash && (!next || next.turn !== entry.turn)) {
            if (replayStateHash() === turn.endHash) this.drift.delete(entry.turn)
            else this.drift.add(entry.turn)
        }
        this.position = entryIndex
    }
    seek(target, animate = false) {
        target = Math.max(0, Math.min(this.entries.length - 1, target))
        const base = this.turnStarts[this.baseTurn(target)]
        if (this.position < 0 || target < this.position || base > this.position)
            this.position = base - 1
        while (this.position < target)
            this.applyEntry(this.position + 1, animate && this.position + 1 === target)
        this.applyView()
        this.onChange?.()
    }
    stepForward() {
        if (this.atEnd)
            return false
        this.seek(this.position + 1, true)
        return true
    }
    stepBack() {
        if (this.position <= 0)
            return false
        moveTween.clear()
        this.seek(this.position - 1)
        return true
    }
    jumpToTurn(turnIndex) {
        moveTween.clear()
        this.seek(this.turnStarts[Math.max(0, Math.min(this.turnStarts.length - 1, turnIndex))])
    }
    jumpToRound(round) {
        const turnIndex = this.recording.turns.findIndex(turn => turn.round === round)
        if (turnIndex >= 0) this.jumpToTurn(turnIndex)
    }
    // Keeps the position: the same turn and, in it, the last applied action still shown.
    setShowUndos(show) {
        if (this.showUndos === !!show)
            return
        const entry = this.entries[this.position]
        this.showUndos = !!show
        this.buildTimeline()
        let target = this.turnStarts[entry.turn]
        if (entry.kind === 'action') {
            for (let i = target + 1; i < this.entries.length && this.entries[i].turn === entry.turn &&
                    this.entries[i].index <= entry.index; ++i)
                target = i
        }
        this.position = -1
        moveTween.clear()
        this.seek(target)
    }
    get fogViewAvailable() {
        return isFogOfWar && !!grid.visionWay
    }
    // 'off': everything visible; a player index: that player's vision.
    setFogView(view) {
        this.fogView = view === 'off' ? 'off' : Number(view)
        this.applyView()
        // Looking at what that player sees.
        if (this.fogView !== 'off' && players[this.fogView] && grid)
            gameEvent.screen.moveToPlayer(players[this.fogView])
        this.onChange?.()
    }
    applyView() {
        replayClearSelection()
        if (!this.fogViewAvailable)
            return
        if (this.fogView === 'off') {
            for (const column of grid.fogOfWar) column.fill(1)
        } else if (players[this.fogView]) {
            players[this.fogView].changeFogOfWarByVision()
        }
    }
    play(speed) {
        this.pause()
        this.speed = speed
        const tick = () => {
            if (!this.stepForward() || this.atEnd) {
                this.pause()
                this.onChange?.()
                return
            }
            this.playTimer = setTimeout(tick, 1000 / this.speed)
        }
        this.playTimer = setTimeout(tick, 1000 / this.speed)
    }
    pause() {
        clearTimeout(this.playTimer)
        this.playTimer = null
    }
    get playing() {
        return this.playTimer !== null
    }
    describe(entryIndex = this.position) {
        const entry = this.entries[entryIndex]
        if (!entry)
            return ''
        const turn = this.recording.turns[entry.turn]
        const actions = this.entries.filter(other => other.turn === entry.turn && other.kind === 'action')
        const number = entry.kind === 'start' ? 0 : actions.indexOf(entry) + 1
        const result = this.results[entryIndex]
        const action = entry.kind === 'start' ? 'turn start' : replayActionText(entry.action)
        return `round ${turn.round} · player ${turn.playerIndex} · action ${number}/${actions.length}: ${action}` +
            (result && !result.ok ? ` (rejected: ${result.reason})` : '') +
            (this.drift.has(entry.turn) ? ' · hash drift' : '')
    }
}

function replayActionText(action) {
    const at = coord => coord ? `${coord.x},${coord.y}` : '?'
    switch (action.t) {
    case 'unit': return `${action.expect?.name || 'unit'} ${at(action.from)} → ${at(action.to)}`
    case 'skip': return `skip ${at(action.at)}`
    case 'train': return `train ${action.product} at ${at(action.producer)}`
    case 'build': return `build ${action.product} ${at(action.producer)} → ${at(action.at)}`
    case 'destroy': return `destroy ${action.layer || 'building'} ${at(action.at)}`
    default: return action.t
    }
}

// The open replay (null when none): the game loop draws its board, the game's own input stays off.
let replayViewer = null

// The controls below the board: step back/forward, play x1/x4, pause, jump to round/turn, fog view,
// undos shown/compacted, exit.
class ReplayControls {
    constructor(session, onExit) {
        this.session = session
        const bar = this.container = document.createElement('div')
        bar.id = 'replay-controls'
        bar.style.cssText = 'position:absolute;left:0;right:0;bottom:0;z-index:2;display:flex;flex-wrap:wrap;' +
            'gap:6px;align-items:center;padding:6px;background:rgba(255,255,255,0.85);font:14px Arial'
        bar.addEventListener('click', event => event.stopPropagation())
        const button = (id, text, handler) => {
            const element = document.createElement('button')
            element.id = id
            element.textContent = text
            element.addEventListener('click', handler)
            bar.append(element)
            return element
        }
        button('replay-back', '◀ step', () => { session.pause(); session.stepBack() })
        button('replay-step', 'step ▶', () => { session.pause(); session.stepForward() })
        button('replay-play1', 'play x1', () => session.play(1))
        button('replay-play4', 'play x4', () => session.play(4))
        button('replay-pause', 'pause', () => { session.pause(); this.update() })
        this.jump = document.createElement('select')
        this.jump.id = 'replay-jump'
        session.recording.turns.forEach((turn, index) => {
            const option = document.createElement('option')
            option.value = String(index)
            option.textContent = `round ${turn.round} · player ${turn.playerIndex}`
            this.jump.append(option)
        })
        this.jump.addEventListener('change', () => { session.pause(); session.jumpToTurn(Number(this.jump.value)) })
        bar.append(this.jump)
        this.fog = document.createElement('select')
        this.fog.id = 'replay-fog'
        bar.append(this.fog)
        this.fog.addEventListener('change', () => session.setFogView(this.fog.value))
        const label = document.createElement('label')
        this.undos = document.createElement('input')
        this.undos.type = 'checkbox'
        this.undos.id = 'replay-undos'
        this.undos.addEventListener('change', () => { session.pause(); session.setShowUndos(this.undos.checked) })
        label.append(this.undos, ' show undos')
        bar.append(label)
        button('replay-exit', 'exit', onExit)
        this.status = document.createElement('span')
        this.status.id = 'replay-status'
        bar.append(this.status)
        document.body.append(bar)
    }
    update() {
        const session = this.session
        const fogOptions = ['off'].concat(session.fogViewAvailable ?
            players.map((player, index) => index).filter(index => !players[index].isNeutral) : [])
        if (this.fog.options.length !== fogOptions.length) {
            this.fog.textContent = ''
            for (const value of fogOptions) {
                const option = document.createElement('option')
                option.value = String(value)
                option.textContent = value === 'off' ? 'fog off' : `view as player ${value}`
                this.fog.append(option)
            }
        }
        this.fog.value = String(session.fogView)
        this.jump.value = String(session.turnIndex)
        this.undos.checked = session.showUndos
        this.status.textContent = session.describe() + (session.playing ? ` · playing x${session.speed}` : '')
    }
    remove() {
        this.container.remove()
    }
}

class ReplayViewer {
    constructor(source) {
        this.session = new ReplaySession(source)
    }
    open() {
        this.savedMoveCamera = otherSettings.moveCameraToUndoTarget
        otherSettings.moveCameraToUndoTarget = false
        try {
            this.session.seek(0)
        } catch (error) {
            otherSettings.moveCameraToUndoTarget = this.savedMoveCamera
            throw error
        }
        replayViewer = this
        GameManager.clearBasisValues()
        // Only the camera follows the mouse; clicks and keys do not reach the game.
        removeEvents()
        if (!mobilePhone) {
            document.addEventListener('mousemove', mousemove)
            document.addEventListener('wheel', mousewheel)
        }
        nextTurnPauseInterface.visible = false
        gameEvent.screen.moveToPlayer(players[whooseTurn])
        this.controls = new ReplayControls(this.session, () => this.close())
        this.session.onChange = () => this.controls.update()
        this.controls.update()
        lastGameFrameTime = undefined
        framesPerSecond = 60
        requestAnimationFrame(gameLoop)
    }
    close() {
        this.session.pause()
        this.controls.remove()
        otherSettings.moveCameraToUndoTarget = this.savedMoveCamera
        moveTween.clear()
        replayViewer = null
        gameExit = true
        removeEvents()
        menu.visible = true
        menu.start()
        // The replays screen stayed selected while the replay was shown: show its inputs again.
        if (menu.selectedTree === menu.replays) menu.replays.enter()
        else menu.setTree(menu.replays)
    }
    drawOverlay(ctx) {
        const text = this.session.describe()
        ctx.save()
        ctx.font = Math.min(18 * window.devicePixelRatio, WIDTH / 40) + 'px Arial'
        ctx.textAlign = 'center'
        ctx.fillStyle = 'rgba(255, 255, 255, 0.85)'
        ctx.fillRect(WIDTH * 0.1, HEIGHT * 0.01, WIDTH * 0.8, HEIGHT * 0.05)
        ctx.fillStyle = 'black'
        ctx.fillText(`replay · ${text}`, WIDTH / 2, HEIGHT * 0.045)
        ctx.restore()
    }
}

// 'replays' (behind otherSettings.showReplays until the server serves game:replay): a recording
// from a file or a URL.
class ReplayTree {
    constructor(_menu) {
        this.menu = _menu
        this.container = null
        this.title = new Text(WIDTH / 2, HEIGHT * 0.3, 0.04 * WIDTH, 'replays', 'black')
        this.status = new Text(WIDTH / 2, HEIGHT * 0.6, 0.025 * WIDTH, '', '#747474')
        this.buttons = []
    }
    setParent(parent, _menu, pos0X = WIDTH / 2 - WIDTH * 0.25 / 2) {
        this.buttons = [Menu.getButton({x: pos0X, y: HEIGHT * 0.7}, 'back', _menu.setTree, parent, true, _menu)]
    }
    enter() {
        this.leave()
        const div = this.container = document.createElement('div')
        div.id = 'replay-open'
        div.style.cssText = `position:absolute;left:${WIDTH / 2 / devicePixelRatio}px;` +
            `top:${HEIGHT * 0.4 / devicePixelRatio}px;transform:translateX(-50%);z-index:1;` +
            'display:flex;flex-direction:column;gap:8px;font:16px Arial'
        div.addEventListener('click', event => event.stopPropagation())
        const file = document.createElement('input')
        file.type = 'file'
        file.id = 'replay-file'
        file.accept = '.json,application/json'
        file.addEventListener('change', () => file.files[0] && this.openFile(file.files[0]))
        const row = document.createElement('div')
        const url = document.createElement('input')
        url.id = 'replay-url'
        url.placeholder = 'recording URL'
        const open = document.createElement('button')
        open.id = 'replay-open-url'
        open.textContent = 'open'
        open.addEventListener('click', () => this.openUrl(url.value))
        row.append(url, open)
        div.append(file, row)
        document.body.append(div)
    }
    leave() {
        this.container?.remove()
        this.container = null
    }
    openFile(file) {
        this.status.text = 'reading…'
        const reader = new FileReader()
        reader.onload = () => this.open(reader.result)
        reader.onerror = () => { this.status.text = 'could not read the file' }
        reader.readAsText(file)
    }
    async openUrl(url) {
        this.status.text = 'loading…'
        try {
            const response = await fetch(url)
            if (!response.ok) throw new Error(`HTTP ${response.status}`)
            this.open(await response.text())
        } catch (error) {
            this.status.text = `could not load: ${error.message}`
        }
    }
    open(source) {
        let viewer
        try {
            viewer = new ReplayViewer(source)
        } catch (error) {
            this.status.text = error.message
            return false
        }
        try {
            viewer.open()
        } catch (error) {
            console.error('replay: could not open', error)
            this.status.text = `could not open: ${error.message}`
            return false
        }
        this.status.text = ''
        this.leave()
        return true
    }
    click(pos) {
        for (const button of this.buttons) button.click(pos)
    }
    draw(ctx) {
        this.title.draw(ctx)
        this.status.draw(ctx)
        for (const button of this.buttons) button.draw(ctx)
    }
}
