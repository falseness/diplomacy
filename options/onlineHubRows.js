// Online hub list (server/docs/auth-lobby-protocol.md 3-4): the rows built from a
// lobby:list ack and the game:myFinished games, the vertical scroll model and the lobby:listChanged re-fetch.
// No canvas or DOM here; menu/menu.js draws the rows.

// One line of a game's settings (lobby room title, replay list); every online game runs the same long clock, so it is not shown.
function hubSettingsText(settings) {
    if (!settings) return 'unknown game'
    const parts = [settings.mode === 'coop'
        ? `co-op: humans ${settings.coop?.humans}, seed ${settings.coop?.seed}, size ${settings.coop?.size}`
        : `competitive: ${settings.mapName}, ${settings.players} players`]
    if (settings.fogOfWar) parts.push('fog')
    if (settings.asyncMoves === true) parts.push('asynchronous moves')
    return parts.join(' · ')
}

const HUB_COOP_SIZE_TITLES = {tiny: 'Small map', normal: 'Normal map', big: 'Big map'}

// Title, mode and tags of a row; competitive titles are the map name, co-op ones the map size.
function hubSettingsFields(settings) {
    if (!settings) return {title: 'unknown game', mode: null, tags: []}
    const coop = settings.mode === 'coop'
    const size = settings.coop?.size
    const tags = [coop ? `${settings.coop?.humans} humans` : `${settings.players} players`]
    if (settings.fogOfWar) tags.push('fog')
    if (settings.asyncMoves === true) tags.push('async')
    if (coop) tags.push(`seed ${settings.coop?.seed}`)
    return {
        title: coop ? HUB_COOP_SIZE_TITLES[size] || `${size} map` : settings.mapName,
        mode: coop ? 'co-op' : 'competitive',
        tags,
    }
}

const hubHexColour = rgb => rgb ? '#' + [rgb.r, rgb.g, rgb.b].map(c => c.toString(16).padStart(2, '0')).join('') : null

// The board colour of human seat `slot` (seats are 1..n in both modes): coopPlayerColor (ai/generateMap.js) for
// co-op, the shipped map variant's player rgb (maps in options/gamestart.js) for competitive; null when unknown.
function hubSeatColour(settings, slot) {
    if (settings?.mode === 'coop')
        return typeof coopPlayerColor === 'function' ? hubHexColour(coopPlayerColor(slot)) : null
    const variants = typeof maps !== 'undefined' && settings ? maps[settings.mapName] : null
    const variant = Array.isArray(variants) ? variants.find(map => map.players.length === settings.players + 1) : null
    return hubHexColour(variant?.players[slot]?.rgb)
}

// Nicknames in seat order -> [{name, colour}].
function hubPlayers(settings, names) {
    return (names || []).map((name, i) => ({name, colour: hubSeatColour(settings, i + 1)}))
}

// The plain-text summary of a row (onlineHub.rowTexts, the drawn text): built from the structured fields.
function hubRowText(row) {
    const head = () => [row.title, row.mode, ...row.tags].filter(part => part != null)
    const names = () => row.players.map(player => player.name).join(', ')
    switch (row.kind) {
    case 'game':
        return [...head(), 'round ' + row.round, names(), ...(row.yourTurn ? ['your turn'] : [])].join(' · ')
    case 'finished':
        return [...head(), row.result, `${row.rounds} rounds`, names(),
            ...(row.finishedAt ? ['finished ' + row.finishedAt.slice(0, 10)] : [])].filter(part => part != null).join(' · ')
    case 'lobby':
        return [...head(), `${row.seats.filled}/${row.seats.capacity}`, 'host ' + row.host].join(' · ')
    case 'myLobby':
        return row.title === undefined ? 'return to my lobby'
            : 'return to my lobby · ' + hubRowText({...row, kind: 'lobby'})
    default:
        return row.text
    }
}

function hubGameRow(game) {
    return {kind: 'game', id: game.gameID, ...hubSettingsFields(game.settings), round: game.round,
        players: hubPlayers(game.settings, game.players), yourTurn: !!game.yourTurn}
}

function hubFinishedRow(game) {
    return {kind: 'finished', id: game.gameID, ...hubSettingsFields(game.settings), result: game.result ?? null,
        finishedAt: game.finishedAt ?? null, rounds: game.rounds, players: hubPlayers(game.settings, game.players)}
}

function hubLobbyRow(lobby, kind = 'lobby') {
    return {kind, id: lobby.lobbyId, ...hubSettingsFields(lobby.settings),
        players: hubPlayers(lobby.settings, lobby.members.map(member => member.nickname)),
        seats: {filled: lobby.members.length, capacity: lobby.capacity}, host: lobby.host.nickname}
}

const withText = row => ({...row, text: hubRowText(row)})

// The 'return to my lobby' row (when the ack has myLobbyId; after a reload my lobby is reachable only from it),
// your games (in the ack's newest-first order), the finished games (game:myFinished, newest first), then the open lobbies.
function buildHubRows(list, finishedGames = []) {
    const myGames = list?.myGames || [], lobbies = list?.lobbies || [], finished = finishedGames || []
    const rows = []
    const myLobbyId = list?.myLobbyId || null
    if (myLobbyId) {
        const lobby = lobbies.find(entry => entry.lobbyId === myLobbyId)
        rows.push(lobby ? hubLobbyRow(lobby, 'myLobby') : {kind: 'myLobby', id: myLobbyId})
    }
    const header = text => rows.push({kind: 'header', id: null, text})
    const empty = text => rows.push({kind: 'empty', id: null, text})
    header('your games')
    if (!myGames.length) empty('no games')
    for (const game of myGames) rows.push(hubGameRow(game))
    header('finished')
    if (!finished.length) empty('no finished games')
    for (const game of finished) rows.push(hubFinishedRow(game))
    header('lobbies')
    if (!lobbies.length) empty('no open lobbies')
    for (const lobby of lobbies) rows.push(hubLobbyRow(lobby))
    return rows.map(withText)
}

// Fixed-height rows in a view of viewHeight; offset is the scrolled distance from the top.
class HubScrollModel {
    constructor(rowHeight, viewHeight) {
        this.rowHeight = rowHeight
        this.viewHeight = viewHeight
        this.rowCount = 0
        this.offset = 0
    }
    get maxOffset() {
        return Math.max(0, this.rowCount * this.rowHeight - this.viewHeight)
    }
    setRowCount(count) {
        this.rowCount = count
        this.scrollTo(this.offset)
    }
    scrollTo(offset) {
        this.offset = Math.min(this.maxOffset, Math.max(0, offset))
    }
    scrollBy(delta) {
        this.scrollTo(this.offset + delta)
    }
    // One scroll-button step: a page minus one row.
    get pageStep() {
        return Math.max(this.rowHeight, this.viewHeight - this.rowHeight)
    }
    isRowFullyVisible(index) {
        const top = index * this.rowHeight - this.offset
        return top >= -1e-6 && top + this.rowHeight <= this.viewHeight + 1e-6
    }
    // Indices of the rows at least partly inside the view.
    get visibleRange() {
        const first = Math.floor(this.offset / this.rowHeight)
        const last = Math.min(this.rowCount, Math.ceil((this.offset + this.viewHeight) / this.rowHeight)) - 1
        return {first, last}
    }
    // Row index under y (measured from the view's top), or -1.
    rowAt(y) {
        if (y < 0 || y > this.viewHeight) return -1
        const index = Math.floor((y + this.offset) / this.rowHeight)
        return index < this.rowCount ? index : -1
    }
}

// The hub's places for the rows of buildHubRows: the 'return to my lobby' bar (the myLobby row or null), the left
// panel (your games, then the 'finished' heading and the finished games) and the right panel (the open lobbies).
// The 'your games' and 'lobbies' headings become the panel headings.
function hubPanelRows(rows) {
    const myLobby = rows.find(row => row.kind === 'myLobby') || null
    const heading = text => rows.findIndex(row => row.kind === 'header' && row.text === text)
    const games = heading('your games'), lobbies = heading('lobbies')
    if (games < 0 || lobbies < games) return {myLobby, games: [], lobbies: []}
    return {myLobby, games: rows.slice(games + 1, lobbies), lobbies: rows.slice(lobbies + 1)}
}

// A panel's vertical scroll over rows of their own heights in a view of viewHeight; offset is the scrolled
// distance from the top.
class HubPanelScroll {
    constructor() {
        this.heights = []
        this.tops = []
        this.viewHeight = 0
        this.offset = 0
    }
    get contentHeight() {
        return this.heights.reduce((sum, height) => sum + height, 0)
    }
    get maxOffset() {
        return Math.max(0, this.contentHeight - this.viewHeight)
    }
    setHeights(heights) {
        this.heights = heights
        let top = 0
        this.tops = heights.map(height => (top += height) - height)
        this.scrollTo(this.offset)
    }
    setViewHeight(viewHeight) {
        this.viewHeight = viewHeight
        this.scrollTo(this.offset)
    }
    scrollTo(offset) {
        this.offset = Math.min(this.maxOffset, Math.max(0, offset))
    }
    scrollBy(delta) {
        this.scrollTo(this.offset + delta)
    }
    // The least scroll that shows row index whole (its top when it is taller than the view).
    reveal(index) {
        const top = this.tops[index], bottom = top + this.heights[index]
        if (top < this.offset || bottom - top > this.viewHeight) this.scrollTo(top)
        else if (bottom > this.offset + this.viewHeight) this.scrollTo(bottom - this.viewHeight)
    }
    // Indices of the rows at least partly inside the view.
    get visibleRange() {
        let first = 0
        while (first < this.heights.length && this.tops[first] + this.heights[first] <= this.offset) ++first
        let last = first - 1
        while (last + 1 < this.heights.length && this.tops[last + 1] < this.offset + this.viewHeight) ++last
        return {first, last}
    }
    // Row index under y (measured from the view's top), or -1.
    rowAt(y) {
        if (y < 0 || y > this.viewHeight) return -1
        const at = y + this.offset
        return this.tops.findIndex((top, i) => at >= top && at < top + this.heights[i])
    }
    // The thumb of a scroll track trackHeight long: offset 0 at the top, maxOffset at the bottom, its length the
    // visible share of the content (at least minHeight); null when nothing overflows.
    thumb(trackHeight, minHeight = 0) {
        const maxOffset = this.maxOffset
        if (maxOffset <= 0) return null
        const height = Math.min(trackHeight, Math.max(minHeight, trackHeight * this.viewHeight / this.contentHeight))
        return {top: (trackHeight - height) * this.offset / maxOffset, height}
    }
}

// Requests lobby:list and game:myFinished while active and again on every lobby:listChanged push.
// session: {connect() -> socket with on(), request(event, payload) -> ack promise, myFinishedGames() -> ack promise}.
class HubListFeed {
    constructor(session, onRows) {
        this.session = session
        this.onRows = onRows
        this.active = false
        this.socket = null
        this.sequence = 0
        this.finished = []
    }
    start() {
        this.active = true
        const socket = this.session.connect()
        if (this.socket !== socket) {
            this.socket = socket
            socket.on('lobby:listChanged', () => { if (this.active && this.socket === socket) this.refresh() })
        }
        return this.refresh()
    }
    stop() {
        this.active = false
    }
    // Only the latest answers are shown; an error lobby:list ack keeps the current rows, an error game:myFinished
    // ack the last finished games. The rows follow the lobby:list ack at once and again when changed finished games
    // arrive, so a slow game:myFinished never holds the list back.
    async refresh() {
        const sequence = ++this.sequence
        const current = () => this.active && sequence === this.sequence
        const list = this.session.request('lobby:list', {})
        const finished = this.session.myFinishedGames ? this.session.myFinishedGames()
            : this.session.request('game:myFinished', {})
        let listAck = null
        finished.then(ack => {
            if (!current() || !ack?.ok || JSON.stringify(ack.games) === JSON.stringify(this.finished)) return
            this.finished = ack.games
            if (listAck) this.onRows(buildHubRows(listAck, this.finished), listAck)
        }, () => {})
        const ack = await list
        if (!current() || !ack.ok) return null
        listAck = ack
        const rows = buildHubRows(ack, this.finished)
        this.onRows(rows, ack)
        return rows
    }
}
