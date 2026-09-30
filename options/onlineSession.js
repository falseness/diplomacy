// Signed-in online session (server/docs/auth-lobby-protocol.md section 2): one
// socket.io connection authenticated by auth:google or a stored auth:session token.
const ONLINE_SESSION_KEY = 'diplomacyOnlineSession'
const ONLINE_ACK_TIMEOUT = 10000

// Storage may be unavailable (private mode, blocked cookies); sign-in still works.
function readStoredSession() {
    try { return localStorage.getItem(ONLINE_SESSION_KEY) } catch (error) { return null }
}
function storeSession(token) {
    try { localStorage.setItem(ONLINE_SESSION_KEY, token) } catch (error) {}
}
function clearStoredSession() {
    try { localStorage.removeItem(ONLINE_SESSION_KEY) } catch (error) {}
}

class OnlineSession {
    constructor() {
        this.socket = null
        this.account = null
        // The lobby game on screen (game:open); re-opened after a reconnect.
        this.openGameID = null
    }
    connect() {
        if (this.socket) return this.socket
        // The one online socket: the hub and every lobby game use it.
        const socket = this.socket = io(window.DIPLOMACY_SERVER || DEFAULT_ONLINE_SERVER,
            {forceNew: true, timeout: 10000, auth: {browserProtocol: 1}})
        // A transport reconnect is a new server socket: authenticate it again,
        // then re-open the game on screen.
        socket.io.on('reconnect', async () => {
            if (!this.account || !await this.resume()) return
            if (this.openGameID) this.openGame(this.openGameID)
        })
        return socket
    }
    // Resolves the ack, or {ok: false, error: 'TIMEOUT'} when none arrives.
    request(event, payload) {
        const socket = this.connect()
        return new Promise(resolve => {
            const timer = setTimeout(() => resolve({ok: false, error: 'TIMEOUT'}), ONLINE_ACK_TIMEOUT)
            socket.emit(event, payload, ack => {
                clearTimeout(timer)
                resolve(ack && typeof ack === 'object' ? ack : {ok: false, error: 'BAD_ACK'})
            })
        })
    }
    get hasStoredSession() {
        return !!readStoredSession()
    }
    // Re-authenticates with the stored token; an invalid or expired token is cleared.
    async resume() {
        const sessionToken = readStoredSession()
        if (!sessionToken) return null
        const ack = await this.request('auth:session', {sessionToken})
        if (ack.ok) return this.account = ack.account
        if (ack.error === 'UNAUTHENTICATED') clearStoredSession()
        this.account = null
        return null
    }
    async signInWithGoogle(idToken) {
        const ack = await this.request('auth:google', {idToken})
        if (!ack.ok) return null
        storeSession(ack.sessionToken)
        return this.account = ack.account
    }
    // Resolves the ack; a successful rename updates the signed-in account.
    async setNickname(nickname) {
        const ack = await this.request('account:setNickname', {nickname})
        if (ack.ok) this.account = ack.account
        return ack
    }
    // lobby:create with a host-built initial board; mapName is null for co-op.
    createLobby(board, mapName) {
        return this.request('lobby:create', {board, mapName})
    }
    joinLobby(lobbyId) {
        return this.request('lobby:join', {lobbyId})
    }
    leaveLobby(lobbyId) {
        return this.request('lobby:leave', {lobbyId})
    }
    kickFromLobby(lobbyId, accountId) {
        return this.request('lobby:kick', {lobbyId, accountId})
    }
    startLobby(lobbyId) {
        return this.request('lobby:start', {lobbyId})
    }
    // game:open: the server answers with the board (playYourTurn/waitYouTurn/gameStarted), then acks.
    openGame(gameID) {
        this.openGameID = gameID
        return this.request('game:open', {gameID})
    }
    closeGame() {
        this.openGameID = null
    }
}

// Status text for an account:setNickname error code.
const NICKNAME_ERROR_TEXT = {
    NICKNAME_TAKEN: 'nickname is taken',
    NICKNAME_INVALID: '3-16 letters, digits, _ or -',
}
function nicknameErrorText(error) {
    return NICKNAME_ERROR_TEXT[error] || 'could not save nickname'
}

const onlineSession = new OnlineSession()

// 'play online': the hub for a signed-in or resumable session, else the sign-in screen.
// show.hub(null) marks a pending resume; show.* return false once the user has left.
async function openOnlineSession(show) {
    if (onlineSession.account) return show.hub(onlineSession.account)
    if (onlineSession.hasStoredSession) {
        if (show.hub(null) === false) return
        const account = await onlineSession.resume()
        if (account) return show.hub(account)
    }
    show.signIn()
}
