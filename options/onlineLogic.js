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
        const diff = {...message.diff}
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
        remoteEffects.play(before, hints)
        // A unit whose path left the fog has no visible start to match: it slides along the last
        // visible segment, from where it came into view.
        for (const hint of hints) {
            const unit = grid.getUnit(hint.to)
            if (unit.notEmpty() && !moveTween.isActive(unit))
                moveTween.start(unit, hint.path)
        }
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

// Rebase disjoint local actions on a newer same-turn co-op view. Components
// cannot act on one another's influence area. Coordinate-keyed entity lists
// still need merging when both components insert/remove external entities.
function rebaseOnlineValue(base, local, remote) {
    const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b)
    if (equal(base, local)) return remote
    if (equal(base, remote) || equal(local, remote)) return local
    if (Array.isArray(base) && Array.isArray(local) && Array.isArray(remote)) {
        const coord = value => value && (value.coord ||
            (Number.isInteger(value.x) && Number.isInteger(value.y) ? value : null))
        if ([...base, ...local, ...remote].every(value => coord(value))) {
            const key = value => coord(value).x + ':' + coord(value).y
            const keyed = list => Object.fromEntries(list.map(value => [key(value), value]))
            const merged = rebaseOnlineValue(keyed(base), keyed(local), keyed(remote))
            return Object.values(merged)
        }
        if (base.length === local.length && base.length === remote.length)
            return base.map((value, i) => rebaseOnlineValue(value, local[i], remote[i]))
    } else if (base && local && remote && typeof base === 'object' &&
            typeof local === 'object' && typeof remote === 'object') {
        const merged = {}
        for (const key of new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)])) {
            const value = rebaseOnlineValue(base[key], local[key], remote[key])
            if (value !== undefined) merged[key] = value
        }
        return merged
    }
    // Shared fields changed by authority (for example a terminal result) win.
    return remote
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

// Stops the open online game: the signed-in session socket stays connected for
// the hub and only loses the game's listeners.
function closeOnlineGameSocket() {
    onlineSocket = null
    onlineGameFreeze = null
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
    on(socket, 'error', error => error === 'KICKED' ? removedByHost() : fail('The server rejected the action.'))
    onlineCommit = null
    gameDiffHandler.reset(gameID)
    // Competitive scheduling gives each player one active turn per round.
    // A waiting connection may become active in that same round when its
    // component predecessor finishes. Reconnect deliberately reloads authority.
    let competitiveDelivery = null
    let acceptedBoard = null
    function receiveBoard(body, active) {
        if (socket !== onlineSocket || failed) return false
        const board = typeof body === 'string' ? JSON.parse(body) : body
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
        // A partial board's lists cannot be rebased (hidden entities look removed): reload it.
        const continuing = !!(board.gameSettings?.coop && !board.hiddenInfo && acceptedBoard && active &&
            !gameEvent.waitingMode && board.gameRound === acceptedBoard.gameRound &&
            board.whooseTurn === whooseTurn && !board.gameSettings.coop.result)
        let restored = board
        let undo, selected, runningTimer
        if (continuing) {
            const local = JSON.parse(JSON.stringify(getGameObject()))
            restored = {...board}
            for (const key of ['grid', 'players', 'external', 'externalProduction', 'nature', 'goldmines'])
                restored[key] = rebaseOnlineValue(acceptedBoard[key], local[key], board[key])
            // The current turn's clock and undo scope continue across peer commits.
            restored.timers = board.timers.map((value, index) =>
                index === whooseTurn ? local.timers[index] : value)
            runningTimer = timer
            selected = gameEvent.selected.notEmpty() ? {
                coord: {...gameEvent.selected.coord}, unit: !!gameEvent.selected.isUnit
            } : null
            undo = actionManager.arr
            const lists = packed => packed.players.map(player => ({
                units: player.units.map(unit => ({...unit.coord})),
                towns: player.towns.map(town => ({...town.coord}))
            }))
            for (const action of undo) {
                action.playerEntityLists = rebaseOnlineValue(lists(acceptedBoard), action.playerEntityLists, lists(board))
                action.externalOrder = rebaseOnlineValue(acceptedBoard.external.map(e => e.coord),
                    action.externalOrder, board.external.map(e => e.coord))
            }
        }
        // Clear references and panels while their old board still exists.
        // A received board may remove a selected entity or hide its cell.
        // A lobby game opened from the menu may have no board yet.
        if (grid) {
            gameEvent.removeSelection()
            gameEvent.hideAll()
        }
        loadFromJson(JSON.stringify(restored))
        if (menu.visible) enterLobbyGame()
        // Waiting and newly joined recipients need bounds for the received map too.
        GameManager.updateCameraBorders()
        acceptedBoard = board
        if (continuing) {
            timer = runningTimer
            actionManager.arr = undo
            gameEvent.removeSelection()
            if (selected) {
                const entity = selected.unit ? grid.getUnit(selected.coord) : grid.getBuilding(selected.coord)
                if (entity.notEmpty() && (!isFogOfWar ||
                        grid.fogOfWar[selected.coord.x][selected.coord.y])) {
                    entity.select()
                    gameEvent.selected = entity
                }
            }
        }
        if (!board.gameSettings?.coop) competitiveDelivery = {round: board.gameRound, active}
        onlineCommit = commit || null
        // A partial board's end comes from the server's status, not from the local lists.
        if (hiddenInfo && players[0].isGameEnded) {
            showHiddenGameEnd()
            return 'ended'
        }
        return continuing ? 'continued' : true
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
        const gameObject = getGameObject()
        // whoseTurn currently means the only index of CURRENT player on client
        socket.emit('nextTurn', JSON.stringify({'gameID': gameID, 'game': gameObject, 'whooseTurn': whooseTurn}))
    }
}
