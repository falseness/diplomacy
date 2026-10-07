// Client streaming queue for action-based online play, shadow phase (artifacts/actions_feature_prd.txt sec. 6.2;
// server/docs/auth-lobby-protocol.md 4.6 in diplomacy_server). In a lobby game every action the recorder
// (options/actionRecorder.js) logs is sent as game:action {gameID, seq, action, hash}, seq 1, 2, ... per turn, hash the
// local stateHash() after the action: the unit/skip/train/build/destroy actions, {t: 'undo'} and {t: 'end', hash}.
// The local state has already advanced (the engine is deterministic), so the queue only orders delivery: exactly one
// action is in flight, the next one is sent when its ack arrives (or after ONLINE_ACK_TIMEOUT). The full board still
// goes in nextTurn as before.
// Shadow phase: {ok: false} acks, timeouts and acked hashes that differ from the local hash are logged and counted
// (console, ActionStream.stats()) but not acted on.
// start(socket, gameID) attaches the stream to the open game (SetupServerCommunicationLogic); restart() runs when a
// board is delivered (a new turn, a reconnect's reloaded turn) and on a transport reconnect: it drops the queue and
// the in-flight action, starts seq again from 1 and restarts the action log from the board on screen; stop() detaches
// the stream. A late ack of a dropped entry is ignored.
const ActionStream = {
    socket: null,
    gameID: null,
    // The seq of the last queued action of this turn.
    seq: 0,
    // [{seq, action, hash}] not sent yet; inFlight: the one sent entry awaiting its ack.
    queue: [],
    inFlight: null,
    timer: null,
    counters: {sent: 0, acked: 0, failed: 0, timeouts: 0, hashMismatches: 0, restarts: 0},
    start(socket, gameID) {
        this.stop()
        this.socket = socket
        this.gameID = gameID
        this.counters = {sent: 0, acked: 0, failed: 0, timeouts: 0, hashMismatches: 0, restarts: 0}
        actionLog.listener = (action, hash) => this.enqueue(action, hash)
    },
    stop() {
        actionLog.listener = null
        this.drop()
        this.socket = null
        this.gameID = null
    },
    // The unsent and in-flight actions belong to a turn the page no longer shows.
    restart() {
        if (!this.socket)
            return
        this.drop()
        ++this.counters.restarts
        actionLog.start({player: whooseTurn, round: gameRound})
    },
    drop() {
        clearTimeout(this.timer)
        this.timer = null
        this.queue = []
        this.inFlight = null
        this.seq = 0
    },
    enqueue(action, hash) {
        if (!this.socket)
            return
        this.queue.push({seq: ++this.seq, action: JSON.parse(JSON.stringify(action)), hash: hash})
        this.pump()
    },
    pump() {
        if (this.inFlight || !this.queue.length)
            return
        const entry = this.inFlight = this.queue.shift()
        ++this.counters.sent
        this.timer = setTimeout(() => this.settle(entry, {ok: false, seq: entry.seq, reason: 'TIMEOUT'}),
            ONLINE_ACK_TIMEOUT)
        this.socket.emit('game:action', {gameID: this.gameID, seq: entry.seq, action: entry.action, hash: entry.hash},
            ack => this.settle(entry, ack))
    },
    settle(entry, ack) {
        if (this.inFlight !== entry)
            return
        clearTimeout(this.timer)
        this.timer = null
        this.inFlight = null
        if (!ack || typeof ack !== 'object' || ack.ok !== true) {
            const reason = ack && typeof ack === 'object' ? ack.reason : 'BAD_ACK'
            if (reason === 'TIMEOUT')
                ++this.counters.timeouts
            else
                ++this.counters.failed
            console.warn('game:action refused', entry.seq, entry.action.t, reason, this.stats())
        } else {
            ++this.counters.acked
            if (ack.hash !== entry.hash) {
                ++this.counters.hashMismatches
                console.warn('game:action hash mismatch', entry.seq, entry.action.t, ack.hash, entry.hash)
            }
        }
        this.pump()
    },
    stats() {
        return {...this.counters, queued: this.queue.length, inFlight: this.inFlight ? this.inFlight.seq : null}
    }
}
