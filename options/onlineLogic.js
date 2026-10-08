// Production game server; window.DIPLOMACY_SERVER overrides it for local runs.
const DEFAULT_ONLINE_SERVER = 'wss://playdiplomacy.online:8080'

let onlineLobby = null
let onlineSocket = null
let onlineCommit = null
// [target, event, handler] of the open game; a lobby game's socket is the
// signed-in session socket, which outlives the game and only loses these.
let onlineListeners = []

function onlineLobbyText() {
    if (!gameSettings.isOnline || !onlineLobby) return ''
    const mode = onlineLobby.mode === 'coop' ? 'Co-op' : 'Competitive'
    if (onlineLobby.occupiedHumans === null) return mode + ' — finding human players…'
    return mode + ' — Humans: ' + onlineLobby.occupiedHumans + '/' + onlineLobby.humanCapacity +
        (onlineLobby.occupiedHumans === onlineLobby.humanCapacity ? ' — Full' : ' — Waiting for players')
}

let SendNextTurn

// The game:action stream (options/actionStream.js); null where only the online scripts are loaded.
function onlineActionStream() {
    return typeof ActionStream === 'undefined' ? null : ActionStream
}


// The turn clock is not started here: it starts when the turn overlay is hidden
// (nextTurnPauseInterface.visible = false calls timer.updateLastPause), so it
// neither runs behind the overlay nor restarts when the overlay is dismissed.
function unfreezeGame() {
    gameEvent.waitingMode = false
    nextTurnButton.highlightButton = false
    undoButton.enableClick()
    nextTurnButton.enableClick()
    nextTurnButton.setNextPlayerColor(players[whooseTurn].hexColor)
}


class OnlineLogic {
    constructor() {
        this.__playingRightNow = []
    }
    updatePlayingRightNow(playerIndex) {
        this.__playingRightNow.push(playerIndex)
    }
    isPlayingRightNow(playerIndex) {
        return this.__playingRightNow.includes(playerIndex)
    }
}

// Live spectating, client side (PRD sec. 8): the server (server/spectate.js) sends each other
// player's action as game:diff {gameID, seq, actorSeat, diff, paths?}, the cells that changed as
// this player sees them. A diff is applied in place with applyCellDiff (cell records, no
// loadFromJson), both while waiting (waitingMode stays on and the board keeps rendering) and in
// the middle of the local player's own turn: the local turn (whooseTurn) is never taken from a
// remote diff, and the selection and undo stack are kept (parallel players cannot touch the cells
// of the local player's pending actions). paths are the visible segments of the moved units' paths,
// [{unitId, segments: [[{x, y}, ...], ...]}]; the last visible segment is drawn with the movement
// tween (moveTween). seq numbers the messages of this socket in the game without gaps: a message
// ahead of the next expected one is buffered until the gap is filled, an applied seq is dropped.
// Speculative peer units are pictures, not rule entities. Never register them in
// grid/players or serialize them into actions, undo snapshots or stateHash().
const onlineObservation = {
    board: null,
    round: null,
    units: new Map(),
    unitActors: new Map(),
    buildings: new Map(),
    hexagons: new Map(),
    clear() {
        this.board = null
        this.round = null
        this.units.clear()
        this.unitActors.clear()
        this.buildings.clear()
        this.hexagons.clear()
    },
    receive(message) {
        if (this.board !== grid || this.round !== gameRound) {
            this.clear()
            this.board = grid
            this.round = gameRound
        }
        const changed = new Set((message.changedCells || []).map(cell => cell.x + ',' + cell.y))
        for (const cell of message.diff.cells || []) {
            if (!grid.arr[cell.x]?.[cell.y]) continue
            const key = cell.x + ',' + cell.y
            const localHex = grid.getHexagon(cell)
            const observedHex = this.hexagons.get(key)
            const affected = changed.has(key)
            const building = cell.building
            if (Object.hasOwn(cell, 'building') && (affected || building?.owner === message.actorSeat ||
                    this.buildings.get(key)?.actor === message.actorSeat)) {
                const BuildingClass = building?.name === 'town' ? Town : building && getClass(building.name)
                if (!building || BuildingClass) this.buildings.set(key, {actor: message.actorSeat,
                    sprite: building ? this.sprite(building, cell, BuildingClass, basis.r * 1.4) : null})
            }
            // Capture trails include cells without a unit. Keep their colours,
            // and remember the actor so undo can restore neutral/previous land.
            if (cell.colour === message.actorSeat || observedHex?.actor === message.actorSeat ||
                    localHex.playerColor === message.actorSeat) {
                if (cell.colour === null || (Number.isInteger(cell.colour) && players[cell.colour])) {
                    const suburb = typeof cell.isSuburb === 'boolean' ? cell.isSuburb :
                        cell.colour === localHex.playerColor && localHex.isSuburb
                    this.hexagons.set(key, {actor: message.actorSeat,
                        hexagon: new Hexagon(cell.x, cell.y, cell.colour, suburb)})
                }
            }
            const record = cell.unit
            const previous = this.units.get(key) || grid.getUnit(cell)
            // Another seat's context may contain old copies of unrelated units.
            // Observe the acting seat's units and their vacated cells only.
            if (!affected && record?.owner !== message.actorSeat && previous?.playerColor !== message.actorSeat) continue
            // Our own commands remain visible immediately, even if the peer's
            // isolated board still contains an older copy of our unit.
            if (record && record.owner === whooseTurn) {
                this.units.delete(key)
                this.unitActors.delete(key)
                continue
            }
            let sprite = null
            const UnitClass = record && getClass(record.name)
            if (UnitClass && Number.isInteger(record.owner) && players[record.owner]) {
                // Skip constructors: unit constructors mutate the rule board.
                sprite = this.sprite(record, cell, UnitClass, -basis.r * 0.125)
            }
            this.units.set(key, sprite)
            this.unitActors.set(key, message.actorSeat)
        }
        return {observation: true}
    },
    sprite(record, cell, Class, margin) {
        const sprite = Object.create(Class.prototype, Object.fromEntries(
            Object.entries({...record, coord: {x: cell.x, y: cell.y}})
                .map(([key, value]) => [key, {value, writable: true, configurable: true}])))
        Object.defineProperty(sprite, 'playerColor', {value: record.owner ?? cell.colour})
        sprite.pos = sprite.calcPos()
        sprite.hpBar = new HealthBar({x: sprite.pos.x + assets.size / 2,
            y: sprite.pos.y + assets.size / 2 + margin}, sprite.maxHP)
        sprite.updateHPBar()
        return sprite
    },
    acceptBoard(board) {
        const pending = board.coopCommit?.pendingSeats
        if (board.gameRound !== this.round || !Array.isArray(pending) || board.gameSettings?.coop?.result) {
            this.clear()
            return
        }
        const keep = new Set(pending)
        for (const [key, actor] of this.unitActors) if (!keep.has(actor)) {
            this.units.delete(key)
            this.unitActors.delete(key)
        }
        for (const map of [this.hexagons, this.buildings])
            for (const [key, entry] of map) if (!keep.has(entry.actor)) map.delete(key)
        this.board = grid
    },
    hidesBuilding(cell) {
        return this.board === grid && this.buildings.has(cell.coord.x + ',' + cell.coord.y)
    },
    hidesUnit(cell) {
        return this.board === grid && this.units.has(cell.coord.x + ',' + cell.coord.y) &&
            !(cell.unit.notEmpty() && cell.unit.playerColor === whooseTurn)
    },
    hexagonFor(cell) {
        if (this.board !== grid || cell.hexagon.playerColor === whooseTurn ||
                (cell.unit.notEmpty() && cell.unit.playerColor === whooseTurn)) return null
        return this.hexagons.get(cell.coord.x + ',' + cell.coord.y)?.hexagon || null
    },
    draw(ctx) {
        if (this.board !== grid) return
        for (const {sprite} of this.buildings.values()) if (sprite) {
            drawCachedImage(ctx, cachedImages[sprite.bodyImageName], sprite.pos)
            Entity.prototype.drawBars.call(sprite, ctx)
            const cell = grid.getCell(sprite.coord)
            if (cell.unit.notEmpty() && !this.hidesUnit(cell) && !moveTween.isActive(cell.unit)) cell.unit.draw(ctx)
        }
        for (const sprite of this.units.values()) {
            if (!sprite) continue
            const local = grid.getUnit(sprite.coord)
            if (local.notEmpty() && local.playerColor === whooseTurn) continue
            // Only server-filtered unit records enter this layer. Its shared
            // vision may reveal a peer beyond our turn-opening fog.
            drawCachedImage(ctx, cachedImages[sprite.bodyImageName], sprite.pos)
            Entity.prototype.drawBars.call(sprite, ctx)
        }
    }
}

const gameDiffHandler = {
    gameID: null,
    lastSeq: 0,
    // seq -> message waiting for an earlier one.
    buffered: new Map(),
    // A new game or a new socket (the server counts seq per socket from 1).
    reset(gameID = null, lastSeq = 0) {
        this.gameID = gameID
        this.lastSeq = lastSeq
        this.buffered.clear()
        remoteEffects.clear()
        onlineObservation.clear()
    },
    // Takes one game:diff message; returns the applyCellDiff results of the messages applied now,
    // in seq order (empty when it was buffered, stale or for another game).
    receive(message) {
        if (!message || !message.diff || (this.gameID !== null && message.gameID !== this.gameID))
            return []
        if (!Number.isInteger(message.seq))
            return [this.apply(message)]
        if (message.seq <= this.lastSeq)
            return []
        this.buffered.set(message.seq, message)
        const applied = []
        while (this.buffered.has(this.lastSeq + 1)) {
            const next = this.buffered.get(++this.lastSeq)
            this.buffered.delete(this.lastSeq)
            applied.push(this.apply(next))
        }
        return applied
    },
    apply(message) {
        if (typeof grid === 'undefined' || !grid)
            return null
        if (message.observation) return onlineObservation.receive(message)
        const observing = onlineObservation.board === grid
        const diff = {...message.diff}
        // The wire boardDiff tags entities by list/owner; applyCellDiff uses runtime layer tags.
        // In particular a town update must not be mistaken for an unsupported building and removed.
        const suburbs = new Map()
        for (const cell of diff.cells || [])
            if (cell.building?.list === 'towns')
                for (const suburb of cell.building.suburbs || [])
                    suburbs.set(cellDiffKey(suburb), suburb.isSuburb !== false)
        diff.cells = (diff.cells || []).map(cell => {
            const wire = cell.building?.list || cell.production?.list || cell.unit?.owner !== undefined
            if (!wire && 'isSuburb' in cell) return cell
            const local = grid.arr[cell.x][cell.y].hexagon
            const unit = cell.unit ? {...cell.unit} : null
            if (unit) delete unit.owner
            const building = cell.building?.list ? revealedCellEntity(cell.building) : cell.building
            if (cell.building?.list === 'towns') {
                delete building.buildings
                delete building.buildingProduction
            }
            return {...cell, unit,
                isSuburb: 'isSuburb' in cell ? Boolean(cell.isSuburb) : suburbs.has(cellDiffKey(cell)) ? suburbs.get(cellDiffKey(cell)) :
                    local.playerColor === cell.colour && local.isSuburb,
                building,
                production: cell.production?.list ? revealedCellEntity(cell.production) : cell.production}
        })
        if (diff.meta) {
            diff.meta = {...diff.meta}
            delete diff.meta.whooseTurn
        }
        const segmented = Array.isArray(message.paths) ? message.paths : []
        const hints = segmented.map(entry => this.pathHint(entry)).filter(Boolean)
        if (hints.length || Array.isArray(diff.paths))
            diff.paths = (Array.isArray(diff.paths) ? diff.paths : []).concat(hints)
        const before = remoteEffects.snapshot(diff.cells)
        const result = applyCellDiff(diff)
        // Wire metadata uses boardDiff's fields envelope. The local viewer/turn
        // and timer stay local; public round/settings and authoritative status advance.
        const fields = diff.meta?.fields
        if (fields) {
            if (Number.isInteger(fields.gameRound)) gameRound = fields.gameRound
            if (fields.gameSettings) gameSettings = fields.gameSettings
            if (typeof fields.isFogOfWar === 'boolean') isFogOfWar = fields.isFogOfWar
            if (hiddenInfo && fields.status) hiddenStatus = fields.status
        }
        // Updating a child may recreate it at the end of its town's list. Restore the
        // wire order after all cells are applied, without recreating unchanged children.
        for (const cell of message.diff.cells || []) {
            if (cell.building?.list !== 'towns') continue
            const town = cellDiffTownAt(cell)
            if (!town) continue
            for (const field of ['buildings', 'buildingProduction']) {
                const order = new Map((cell.building[field] || []).map((entry, index) =>
                    [cellDiffKey(entry.coord), index]))
                town[field].sort((a, b) => (order.get(cellDiffKey(a.coord)) ?? Infinity) -
                    (order.get(cellDiffKey(b.coord)) ?? Infinity))
            }
        }
        remoteEffects.play(before, hints)
        // A unit whose path left the fog has no visible start to match: it slides along the last
        // visible segment, from where it came into view.
        for (const hint of hints) {
            const unit = grid.getUnit(hint.to)
            if (unit.notEmpty() && !moveTween.isActive(unit))
                moveTween.start(unit, hint.path)
        }
        if (observing) onlineObservation.receive(message)
        return result
    },
    // {from, to, path} for applyCellDiff from {segments} (a hint already in that shape is kept):
    // from is where the unit was first seen, path its last visible segment.
    pathHint(entry) {
        if (!entry)
            return null
        if (!Array.isArray(entry.segments))
            return entry.path || (entry.from && entry.to) ? entry : null
        const segments = entry.segments.filter(segment => Array.isArray(segment) && segment.length)
        if (!segments.length)
            return null
        const last = segments[segments.length - 1]
        return {from: segments[0][0], to: last[last.length - 1], path: last}
    }
}

// Effects of remote diffs (PRD sec. 7.6): a sound, hit flash or highlight of another player's
// action plays only for cells the local player sees (fog off, or in vision before or after the
// diff and not an unknown cell), so effects never leak what happens in the fog. gameDiffHandler
// takes a snapshot of the diff's cells before applyCellDiff and plays the effects of the change:
// a unit or building losing hp or a unit killed -> 'hit'/'death' sound and hit flash, a town
// changing owner -> 'capture' sound and highlight, a unit arriving -> 'move' sound and highlight
// of its cell and of its visible path. sound, hitFlash and highlight are the effect functions
// (tests spy on them); flashes and highlights are drawn by grid.draw for a short time.
const remoteEffects = {
    flashMs: 400,
    highlightMs: 800,
    // {kind: 'hit' | 'highlight', cells, startTime} being drawn.
    active: [],
    // name -> Audio-like object with play(); the game ships no sound assets yet.
    sounds: {},
    now() {
        return typeof performance != 'undefined' ? performance.now() : Date.now()
    },
    visible(cell) {
        if (!grid.arr[cell.x] || !grid.arr[cell.x][cell.y])
            return false
        if (grid.arr[cell.x][cell.y].hexagon.unknown)
            return false
        return !isFogOfWar || Boolean(grid.fogOfWar[cell.x][cell.y])
    },
    // The diff's cells before the diff: what stood there and whether the player saw it.
    snapshot(records) {
        return (Array.isArray(records) ? records : []).filter(record => grid.arr[record.x] && grid.arr[record.x][record.y])
            .map(record => {
                const cell = grid.arr[record.x][record.y]
                return {x: record.x, y: record.y, visible: this.visible(record),
                    unit: cell.unit.notEmpty() ? cell.unit : null, unitHp: cell.unit.hp,
                    building: cell.building.notEmpty() ? cell.building : null,
                    buildingHp: cell.building.hp, buildingColour: cell.building.playerColor}
            })
    },
    // Plays the effects of the change since snapshot before; hints are the diff's path hints.
    play(before, hints = []) {
        const highlighted = new Map()
        const highlight = cell => highlighted.set(cell.x + ',' + cell.y, {x: cell.x, y: cell.y})
        const pathEnds = new Set(hints.map(hint => hint.to && hint.to.x + ',' + hint.to.y))
        for (const cell of before) {
            const coord = {x: cell.x, y: cell.y}
            if (!cell.visible && !this.visible(coord))
                continue
            const unit = grid.getUnit(coord)
            const building = grid.getBuilding(coord)
            if (cell.unit && cell.unit.killed) {
                this.sound('death', coord)
                this.hitFlash(coord)
            }
            else if (cell.unit && unit === cell.unit && unit.hp < cell.unitHp) {
                this.sound('hit', coord)
                this.hitFlash(coord)
            }
            if (cell.building && building === cell.building) {
                if (building.hp < cell.buildingHp) {
                    this.sound('hit', coord)
                    this.hitFlash(coord)
                }
                if (building.isTown() && building.playerColor !== cell.buildingColour) {
                    this.sound('capture', coord)
                    highlight(coord)
                }
            }
            if (unit.notEmpty() && unit !== cell.unit) {
                this.sound('move', coord)
                if (!pathEnds.has(coord.x + ',' + coord.y))
                    highlight(coord)
            }
        }
        for (const hint of hints)
            for (const cell of Array.isArray(hint.path) ? hint.path : [])
                if (this.visible(cell)) highlight(cell)
        if (highlighted.size)
            this.highlight([...highlighted.values()])
    },
    sound(name, cell) {
        const sound = this.sounds[name]
        if (sound && typeof sound.play === 'function')
            sound.play()
    },
    hitFlash(cell) {
        this.active.push({kind: 'hit', cells: [{x: cell.x, y: cell.y}], startTime: this.now()})
    },
    highlight(cells) {
        this.active.push({kind: 'highlight', cells: cells.map(cell => ({x: cell.x, y: cell.y})), startTime: this.now()})
    },
    clear() {
        this.active = []
    },
    // Drawn over the board; a cell that fell back into the fog is no longer drawn.
    draw(ctx) {
        if (!this.active.length)
            return
        const now = this.now()
        this.active = this.active.filter(effect =>
            now - effect.startTime < (effect.kind === 'hit' ? this.flashMs : this.highlightMs))
        for (const effect of this.active) {
            const fade = 1 - (now - effect.startTime) / (effect.kind === 'hit' ? this.flashMs : this.highlightMs)
            ctx.save()
            ctx.lineWidth = Math.max(1, basis.r * 0.1)
            for (const cell of effect.cells) {
                if (!this.visible(cell))
                    continue
                const pos = grid.arr[cell.x][cell.y].hexagon.calcPos()
                ctx.beginPath()
                ctx.arc(pos.x, pos.y, basis.r * 0.75, 0, 2 * Math.PI)
                if (effect.kind === 'hit') {
                    ctx.fillStyle = 'rgba(255, 40, 40, ' + (0.6 * fade) + ')'
                    ctx.fill()
                }
                else {
                    ctx.strokeStyle = 'rgba(255, 230, 80, ' + fade + ')'
                    ctx.stroke()
                }
            }
            ctx.restore()
        }
    }
}

// The public terrain of lobby games by gameID (game:terrain under the server's HIDDEN_INFO, PRD sec. 6.3): sent once
// per game:open, before the board; the boards then carry no nature, only terrainId and terrainChanges.
const onlineTerrains = new Map()

function cacheOnlineTerrain(message) {
    if (!message || typeof message.gameID !== 'string' || typeof message.terrainId !== 'string' ||
            !Array.isArray(message.nature)) return false
    onlineTerrains.set(message.gameID, message)
    return true
}

// The board to load: a board without nature (terrainId) gets the cached terrain plus its terrainChanges
// (boardWithTerrain, options/filteredView.js); null when that terrain is not cached. Other boards stay as they are.
function boardWithOnlineTerrain(gameID, board) {
    if (!('terrainId' in board)) return board
    const terrain = onlineTerrains.get(gameID)
    if (!terrain || terrain.terrainId !== board.terrainId) return null
    return boardWithTerrain(board, terrain)
}

// The online recovery panel (#online-recovery) with the message; returns its
// button factory, button(label, action).
function showOnlinePanel(label, message) {
    document.getElementById('online-recovery')?.remove()
    const panel = document.createElement('div')
    panel.id = 'online-recovery'
    panel.setAttribute('role', 'alertdialog')
    panel.setAttribute('aria-label', label)
    panel.style.cssText = 'position:fixed;inset:30% 10% auto;z-index:10000;padding:24px;background:white;color:black;text-align:center;border:2px solid #444;font:20px sans-serif'
    const text = document.createElement('p')
    text.textContent = message
    panel.append(text)
    const button = (label, action) => {
        const b = document.createElement('button')
        b.textContent = label
        b.style.cssText = 'padding:12px 24px;margin:8px;font:inherit'
        b.onclick = event => { event.stopPropagation(); action() }
        panel.append(b)
        return b
    }
    document.body.append(panel)
    return button
}

// A short message over the game that goes away by itself (#online-notice); the game is not frozen.
function showOnlineNotice(message, duration = 3000) {
    document.getElementById('online-notice')?.remove()
    const notice = document.createElement('div')
    notice.id = 'online-notice'
    notice.setAttribute('role', 'status')
    notice.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:10000;padding:8px 16px;background:rgba(0,0,0,0.75);color:white;font:18px sans-serif;pointer-events:none'
    notice.textContent = message
    document.body.append(notice)
    setTimeout(() => notice.remove(), duration)
}

// Freezes the open online game, if any (set by SetupServerCommunicationLogic).
let onlineGameFreeze = null

// The server runs other rules code (an ack RULES_VERSION_MISMATCH, protocol doc
// section 2.7): freeze the open game and offer a reload that fetches the new client.
function showRulesVersionPanel() {
    if (onlineGameFreeze) onlineGameFreeze()
    const button = showOnlinePanel('New version available',
        'A new version of the game is available. Reload the page to keep playing online.')
    button('Reload', () => location.reload()).focus()
}

// The server speaks another browser protocol (an OUTDATED_CLIENT ack, protocol doc section 4.9): same reload offer.
function showOutdatedClientPanel() {
    if (onlineGameFreeze) onlineGameFreeze()
    const button = showOnlinePanel('Please reload', 'This page is outdated: please reload it.')
    button('Reload', () => location.reload()).focus()
}

// Stops the open online game: the signed-in session socket stays connected for
// the hub and only loses the game's listeners.
function closeOnlineGameSocket() {
    onlineSocket = null
    onlineGameFreeze = null
    onlineActionStream()?.stop()
    delete window.kick
    for (const [target, event, handler] of onlineListeners) target.off(event, handler)
    onlineListeners = []
}

// A lobby game (lobby:started or a 'your games' row): game:open on the signed-in
// session socket; the first board enters the game, with no save-slot picker.
function openLobbyGame(gameID) {
    gameSettings.isOnline = true
    SetupServerCommunicationLogic(gameID)
}

function enterLobbyGame() {
    menu.selectedTree?.leave?.()
    GameManager.clearBasisValues()
    lastGameFrameTime = undefined
    framesPerSecond = 60
    requestAnimationFrame(gameLoop)
}

// Plays the lobby game gameID over the signed-in session socket.
function SetupServerCommunicationLogic(gameID) {
    closeOnlineGameSocket()
    const socket = onlineSocket = onlineSession.connect()
    const listeners = onlineListeners
    // Every recorded action of this game is streamed as game:action (options/actionStream.js); a refusal's resync
    // board is loaded by resyncBoard.
    onlineActionStream()?.start(socket, gameID, resyncBoard)
    const on = (target, event, handler) => {
        target.on(event, handler)
        listeners.push([target, event, handler])
    }
    document.getElementById('online-recovery')?.remove()
    // The host kicks a seat from the DevTools console: kick(playerIndex).
    window.kick = async playerIndex => {
        const ack = await onlineSession.kickPlayer(gameID, playerIndex)
        if (ack.ok) console.log('kick ok', playerIndex)
        else console.warn('kick failed', ack.error)
    }
    let failed = false
    // Set by an 'error' KICKED or a kicked: true board; this seat sends no more turns.
    let kicked = false
    // Freezes the board (no more turns from this socket).
    const freeze = () => {
        failed = true
        onlineLobby = null
        gameEvent.waitingMode = true
        nextTurnButton.disableClick()
        undoButton.disableClick()
        nextTurnPauseInterface.visible = false
        if (typeof timer !== 'undefined' && timer) timer.pause()
    }
    onlineGameFreeze = () => { if (socket === onlineSocket) freeze() }
    // Freezes the board and shows a panel with the message; returns the panel's button factory.
    const showPanel = (label, message) => {
        freeze()
        return showOnlinePanel(label, message)
    }
    const backToMenu = button => button('Back to menu', () => {
        document.getElementById('online-recovery')?.remove()
        menu.back()
    })
    const fail = message => {
        if (socket !== onlineSocket || failed) return
        const button = showPanel('Online connection problem',
            message + ' Retry to reload the saved turn, or go back to the menu.')
        const retry = button('Retry', () => {
            document.getElementById('online-recovery')?.remove()
            SetupServerCommunicationLogic(gameID)
        })
        backToMenu(button)
        retry.focus()
    }
    const removedByHost = () => {
        if (socket !== onlineSocket) return
        kicked = true
        backToMenu(showPanel('Removed from game', 'You were removed from this game by the host.')).focus()
    }
    // The shipped Socket.IO 3.0 client reports transport startup errors on its manager.
    on(socket.io, 'error', () => fail(socket.connected ? 'Connection lost.' : 'Could not connect. Check your connection.'))
    on(socket, 'connect_error', () => fail('Could not connect. Check your connection.'))
    on(socket, 'disconnect', () => fail('Connection lost.'))
    on(socket, 'error', error => error === 'KICKED' ? removedByHost()
        : fail(error === 'OUTDATED_CLIENT' ? 'This page is outdated: please reload it.' : 'The server rejected the action.'))
    onlineCommit = null
    gameDiffHandler.reset(gameID)
    // Competitive scheduling gives each player one active turn per round.
    // A waiting connection may become active in that same round when its
    // component predecessor finishes. Reconnect deliberately reloads authority.
    let competitiveDelivery = null
    let acceptedBoard = null
    // Set when a board named a terrain this client does not hold and game:open was re-sent for it.
    let terrainRequested = false
    function receiveBoard(body, active) {
        if (socket !== onlineSocket || failed) return false
        const board = boardWithOnlineTerrain(gameID, typeof body === 'string' ? JSON.parse(body) : body)
        if (!board) {
            // game:open answers with game:terrain first; a second miss is a protocol error.
            if (terrainRequested) fail('The server sent an unknown map.')
            else {
                terrainRequested = true
                requestCurrentGame()
            }
            return false
        }
        terrainRequested = false
        const commit = board.coopCommit
        if (board.gameSettings?.coop) {
            if (!commit || !Number.isSafeInteger(commit.revision) || commit.revision < 0 ||
                    typeof commit.gameID !== 'string') return false
            if (onlineCommit && (commit.gameID !== onlineCommit.gameID ||
                    commit.revision <= onlineCommit.revision)) return false
        }
        if (!board.gameSettings?.coop) {
            if (!Number.isSafeInteger(board.gameRound) || board.gameRound < 0) return false
            if (competitiveDelivery && (board.gameRound < competitiveDelivery.round ||
                    (board.gameRound === competitiveDelivery.round &&
                        (competitiveDelivery.active || !active)))) return false
        }
        // Protocol 2 supplies an authoritative filtered snapshot and accepted prefix.
        const continuing = !!(board.gameSettings?.coop && (!board.hiddenInfo || board.coopContinuing) && acceptedBoard && active &&
            !gameEvent.waitingMode && board.gameRound === acceptedBoard.gameRound &&
            board.whooseTurn === whooseTurn && !board.gameSettings.coop.result)
        if (continuing && typeof BROWSER_PROTOCOL !== 'undefined' && BROWSER_PROTOCOL === 2 && onlineActionStream()) {
            const update = board.coopContinuing
            if (!update || !Number.isSafeInteger(update.lastSeq) || !update.snapshot ||
                    !Array.isArray(update.snapshot.cells) || !Array.isArray(update.accepted)) {
                fail('The server sent an incomplete turn update.')
                return false
            }
            onlineActionStream().continueFrom(update, () => {
                gameEvent.removeSelection()
                gameEvent.hideAll()
                const cells = update.snapshot.cells.filter(cell =>
                    JSON.stringify(packCellRecord(cell.x, cell.y)) !== JSON.stringify(cell))
                applyCellDiff({...update.snapshot, cells})
                // Cell application preserves object identity; restore authoritative
                // list order too, since order participates in the state hash.
                const order = (live, packed) => {
                    const byCoord = new Map(live.map(value => [cellDiffKey(value.coord), value]))
                    live.splice(0, live.length, ...packed.map(value => byCoord.get(cellDiffKey(value.coord))))
                }
                board.players.forEach((player, i) => {
                    order(players[i].units, player.units)
                    order(players[i].towns, player.towns)
                    player.towns.forEach((town, j) => {
                        order(players[i].towns[j].buildings, town.buildings)
                        order(players[i].towns[j].buildingProduction, town.buildingProduction)
                    })
                })
                for (const [live, packed] of [[external, board.external], [externalProduction, board.externalProduction],
                    [nature, board.nature], [goldmines, board.goldmines]]) order(live, packed)
                gameSettings = board.gameSettings
                if (hiddenInfo) hiddenStatus = board.status
            })
            acceptedBoard = board
            onlineObservation.acceptBoard(board)
            onlineCommit = commit
            return 'continued'
        }
        // Clear references and panels while their old board still exists.
        // A received board may remove a selected entity or hide its cell.
        // A lobby game opened from the menu may have no board yet.
        if (grid) {
            gameEvent.removeSelection()
            gameEvent.hideAll()
        }
        loadFromJson(JSON.stringify(board))
        onlineObservation.acceptBoard(board)
        if (menu.visible) enterLobbyGame()
        // Waiting and newly joined recipients need bounds for the received map too.
        GameManager.updateCameraBorders()
        acceptedBoard = board
        onlineActionStream()?.restart(board.actionResume)
        if (active && board.actionResume?.ended) {
            // End reached the server before the connection dropped; finish its commit.
            socket.emit('nextTurn', JSON.stringify({gameID, endHash: stateHash()}))
            return 'continued'
        }
        if (!board.gameSettings?.coop) competitiveDelivery = {round: board.gameRound, active}
        onlineCommit = commit || null
        // A partial board's end comes from the server's status, not from the local lists.
        if (hiddenInfo && players[0].isGameEnded) {
            showHiddenGameEnd()
            return 'ended'
        }
        return true
    }
    // The server refused an action of this turn and sent its board after the accepted ones (TASK-686): load it in
    // place of the local state, which ran ahead. The turn, its clock and (when the turn was ended locally and its
    // nextTurn dropped) the controls go on; the selection and the undo stack (loadFromJson clears it: its entries were
    // recorded on the replaced board) start again. Returns true when the board was loaded.
    function resyncBoard(body, turnEnded) {
        if (socket !== onlineSocket || failed) return false
        const board = boardWithOnlineTerrain(gameID, typeof body === 'string' ? JSON.parse(body) : body)
        if (!board || board.whooseTurn !== whooseTurn || board.gameRound !== gameRound) {
            fail('The server corrected a move this page cannot show.')
            return false
        }
        // The wall clock is local: the server's board carries the turn-start timers.
        const restored = {...board, timers: getGameObject().timers}
        const runningTimer = timer
        onlineObservation.clear()
        if (grid) {
            gameEvent.removeSelection()
            gameEvent.hideAll()
        }
        loadFromJson(JSON.stringify(restored))
        if (turnEnded) {
            // onlineNextTurn saved the remaining time into timers; the reloaded timer resumes from it.
            unfreezeGame()
            timer.updateLastPause()
        } else timer = runningTimer
        showOnlineNotice('Move corrected by server')
        return true
    }
    // The end of a hidden-information game: the board stays frozen under the result banner.
    function showHiddenGameEnd() {
        gameEvent.waitingMode = true
        nextTurnButton.highlightButton = false
        nextTurnButton.disableClick()
        undoButton.disableClick()
        nextTurnPauseInterface.visible = false
        if (typeof timer !== 'undefined' && timer) timer.pause()
    }
    onlineLobby = {mode: gameSettings.coop ? 'coop' : 'competitive', occupiedHumans: null}
    on(socket, 'game:terrain', message => {
        if (socket === onlineSocket && message?.gameID === gameID) cacheOnlineTerrain(message)
    })
    on(socket, 'lobbyStatus', status => {
        if (socket !== onlineSocket) return
        onlineLobby = status
    })

    on(socket, 'gameStarted', game => {
        console.log('gameStarted')

        const delivery = receiveBoard(game, true)
        if (!delivery || delivery === 'continued' || delivery === 'ended') return

        nextTurnPauseInterface.visible = false
        unfreezeGame()
        gameEvent.screen.moveToPlayer(players[whooseTurn])

    });
    on(socket, 'playYourTurn', game => {

        console.log(`playYourTurn`)
        const delivery = receiveBoard(game, true)
        if (!delivery || delivery === 'continued' || delivery === 'ended') return
        nextTurnPauseInterface.visible = true

        unfreezeGame()

        gameEvent.screen.moveToPlayer(players[whooseTurn])

    });
    on(socket, 'waitYouTurn', game => {
        console.log(`waitYouTurn`)

        const board = typeof game === 'string' ? JSON.parse(game) : game
        const delivery = receiveBoard(board, false)
        if (!delivery || delivery === 'ended') return
        // game:open answers a kicked seat with its board marked kicked: true.
        if (board.kicked) { removedByHost(); return }

        if (isFogOfWar) {
            players[whooseTurn].changeFogOfWarByVision()
        }

        gameEvent.waitingMode = true
        nextTurnButton.setNextPlayerColor(players[whooseTurn].hexColor)
        undoButton.disableClick()
        nextTurnPauseInterface.visible = false
        nextTurnButton.highlightButton = false
        nextTurnButton.disableClick()
        timer.pause()
    });

    // Other players' actions as this seat sees them, applied live (waiting or mid-turn).
    on(socket, 'game:diff', message => {
        if (socket !== onlineSocket || failed) return
        gameDiffHandler.receive(message)
    })

    const requestCurrentGame = async () => {
        const ack = await onlineSession.openGame(gameID)
        if (!ack.ok && ack.error !== 'TIMEOUT') fail('The server rejected the action.')
    }
    on(socket, 'connect', () => {
        if (socket !== onlineSocket) return
        // A transport reconnect keeps this socket and its listeners. Resume
        // only from the saved turn requested below; local uncommitted actions
        // must not survive an ambiguous disconnect.
        failed = false
        document.getElementById('online-recovery')?.remove()
        onlineCommit = null
        competitiveDelivery = null
        acceptedBoard = null
        // Unacked and unsent actions belong to the dropped local turn; the reloaded board restarts the log.
        onlineActionStream()?.restart()
        // The server numbers game:diff per socket, from 1 again.
        gameDiffHandler.reset(gameID)
        // The session re-sends auth:session, then game:open.
    })
    requestCurrentGame()
    SendNextTurn = () => {
        if (kicked) return
        if (failed || !socket.connected) { fail('Connection lost.'); return }
        console.log('SendNextTurn')
        console.trace('SendNextTurn called')
        // Protocol 2 (TASK-687): no board, only the hash of the turn's 'end' (actionRecorder.js recordEnd); the server
        // commits its replay of the streamed actions (TASK-684), so send after the stream flushed.
        const send = () => {
            if (socket === onlineSocket && !failed) {
                // The queued end may have waited for reveal acknowledgements.
                const ended = actionLog.lastTurn()?.actions.at(-1)
                const endHash = ended?.action.t === 'end' ? ended.hash : stateHash()
                socket.emit('nextTurn', JSON.stringify({gameID: gameID, endHash: endHash}))
            }
        }
        const stream = onlineActionStream()
        if (stream) stream.afterFlush(send)
        else send()
    }
}
