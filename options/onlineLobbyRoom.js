// Online lobby room (server/docs/auth-lobby-protocol.md 3.1-3.4): what the room
// screen shows for a lobby DTO, and the hub texts of lobby:join errors.
// No canvas or DOM here; menu/menu.js draws the view. Uses hubSettingsText from
// options/onlineHubRows.js.

const LOBBY_REMOVED_TEXT = 'you were removed from the lobby'
const LOBBY_WAITING_TEXT = 'waiting...'
const LOBBY_STARTING_TEXT = 'starting...'

// Members in join order (the host tagged), then a 'waiting...' row per free seat.
// kick: a kick button on this row (I am host and the row is another member).
// start: visible for the host only, enabled when every seat is taken.
function buildRoomView(lobby, myAccountId) {
    const members = lobby?.members || [], capacity = lobby?.capacity || 0
    const hostId = lobby?.host?.accountId ?? null
    const isHost = hostId !== null && hostId === myAccountId
    const rows = members.map(member => {
        const host = member.accountId === hostId
        return {kind: 'member', accountId: member.accountId, nickname: member.nickname, host,
            me: member.accountId === myAccountId,
            text: member.nickname + (host ? ' (host)' : ''), kick: isHost && !host}
    })
    for (let i = members.length; i < capacity; ++i)
        rows.push({kind: 'waiting', accountId: null, nickname: null, host: false, me: false,
            text: LOBBY_WAITING_TEXT, kick: false})
    return {
        lobbyId: lobby?.lobbyId ?? null,
        settingsText: hubSettingsText(lobby?.settings),
        countText: `${members.length}/${capacity}`,
        rows,
        isHost,
        kickAccountIds: rows.filter(row => row.kick).map(row => row.accountId),
        start: {visible: isHost, enabled: isHost && capacity > 0 && members.length === capacity},
    }
}

// Hub status text for a lobby:join error code.
const LOBBY_JOIN_ERROR_TEXT = {
    LOBBY_FULL: 'the lobby is full',
    ALREADY_IN_LOBBY: 'you are already in a lobby',
    NOT_FOUND: 'the lobby no longer exists',
    UNAUTHENTICATED: 'signed out, sign in again',
    TIMEOUT: 'no answer from the server',
}
function lobbyJoinErrorText(error) {
    return LOBBY_JOIN_ERROR_TEXT[error] || 'could not join the lobby'
}
