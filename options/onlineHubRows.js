// Online hub list (server/docs/auth-lobby-protocol.md 3-4): the rows built from a
// lobby:list ack, the vertical scroll model and the lobby:listChanged re-fetch.
// No canvas or DOM here; menu/menu.js draws the rows.

function hubSettingsText(settings) {
    if (!settings) return 'unknown game'
    const parts = [settings.mode === 'coop'
        ? `co-op: humans ${settings.coop?.humans}, seed ${settings.coop?.seed}, size ${settings.coop?.size}`
        : `competitive: ${settings.mapName}, ${settings.players} players`]
    if (settings.fogOfWar) parts.push('fog')
    if (settings.asyncMoves === true) parts.push('asynchronous moves')
    const timers = [...new Set(settings.timer || [])]
    if (timers.length) parts.push(timers.join('/') + ' timer')
    return parts.join(' · ')
}

function hubGameRowText(game) {
    const parts = [hubSettingsText(game.settings), 'round ' + game.round, (game.players || []).join(', ')]
    if (game.yourTurn) parts.push('your turn')
    return parts.join(' · ')
}

function hubLobbyRowText(lobby) {
    return [hubSettingsText(lobby.settings), `${lobby.members.length}/${lobby.capacity}`,
        'host ' + lobby.host.nickname].join(' · ')
}

// After a reload the lobby I am a member of is reachable only from this row (lobby:list myLobbyId).
function hubMyLobbyRowText(lobby) {
    return lobby ? 'return to my lobby · ' + hubLobbyRowText(lobby) : 'return to my lobby'
}

// The 'return to my lobby' row (when the ack has myLobbyId), your games (in the ack's
// newest-first order), then the open lobbies.
function buildHubRows(list) {
    const myGames = list?.myGames || [], lobbies = list?.lobbies || []
    const rows = []
    const myLobbyId = list?.myLobbyId || null
    if (myLobbyId)
        rows.push({kind: 'myLobby', id: myLobbyId,
            text: hubMyLobbyRowText(lobbies.find(lobby => lobby.lobbyId === myLobbyId))})
    rows.push({kind: 'header', id: null, text: 'your games'})
    if (!myGames.length) rows.push({kind: 'empty', id: null, text: 'no games'})
    for (const game of myGames)
        rows.push({kind: 'game', id: game.gameID, text: hubGameRowText(game), yourTurn: !!game.yourTurn})
    rows.push({kind: 'header', id: null, text: 'lobbies'})
    if (!lobbies.length) rows.push({kind: 'empty', id: null, text: 'no open lobbies'})
    for (const lobby of lobbies)
        rows.push({kind: 'lobby', id: lobby.lobbyId, text: hubLobbyRowText(lobby)})
    return rows
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

// Requests lobby:list while active and again on every lobby:listChanged push.
// session: {connect() -> socket with on(), request(event, payload) -> ack promise}.
class HubListFeed {
    constructor(session, onRows) {
        this.session = session
        this.onRows = onRows
        this.active = false
        this.socket = null
        this.sequence = 0
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
    // Only the latest answer is shown; an error ack keeps the current rows.
    async refresh() {
        const sequence = ++this.sequence
        const ack = await this.session.request('lobby:list', {})
        if (!this.active || sequence !== this.sequence || !ack.ok) return null
        const rows = buildHubRows(ack)
        this.onRows(rows, ack)
        return rows
    }
}
