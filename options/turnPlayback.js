// Step-by-step turn playback, part 1: recording an offline AI turn (UI only; the rules result is unchanged).
//
// During an offline AI player's turn (SimpleAiPlayer and its subclasses SimpleAiPlayerWithEconomy and
// TutorialDefenderAiPlayer; hot seat, tutorials and AI-played co-op slots) this keeps:
//   snapshot  the board (JSON.stringify(getGameObject()), the string loadFromJson reads) taken right before the
//             player's nextTurn() turn-start processing: advanceOfflineTurn (nextTurn.js) has already passed the
//             turn to the player and run externalNextTurn() and natureNextTurn();
//   actions   [{action, hash}]: first {t: 'start'} (the player's turn-start processing, Player.prototype.nextTurn:
//             income or the hot-seat opening skip, crisis penalty, units' and towns' nextTurn, heals, production),
//             then every command the AI gave that the rules took (an undo entry was pushed), in the action schema
//             of options/actionApi.js ({t: 'unit' | 'skip' | 'train' | 'build' | 'destroy'}), each with
//             stateHash() after it;
//   endHash   stateHash() when the AI's play() returned.
//   turnPlayback.lastRecording(playerIndex) -> {player, round, snapshot, actions, endHash} | null
// Loading the snapshot (loadFromJson) and running turnPlayback.applyStep over the actions reproduces every hash
// and endHash (tests/client/test-turn-playback-record.js in diplomacy_server).
//
// The AI keeps its own executors: the hooks below only watch Unit sendInstructions / skipMoves,
// PreparingManufacture / Town prepare (unit production) and Town sendInstructions (a placement) while a recorded
// turn's play() runs and draw no random number. getGameObject() prunes killed entities from the lists (every
// state hash does that too); the AI skips killed entities anyway, so its choices stay the same.
//
// Off (nothing recorded) for online games (the server plays those turns), for partial boards, while
// turnPlayback.enabled is false, and for headless AI runs (gameSettings.testAI: benchmarks, training) unless
// turnPlayback.enabled is true.
//
// Client only (index.html, after nextTurn.js); not a rules script (server/gameScriptList.js).

const turnPlayback = {
    // null: on for the shipped game, off for gameSettings.testAI runs; true / false force it.
    enabled: null,
    recordings: {},
    active: null,
    depth: 0,
    isRecordingOn() {
        if (this.enabled === false)
            return false
        if (typeof gameSettings !== 'undefined' && gameSettings && gameSettings.isOnline)
            return false
        if (typeof hiddenInfo !== 'undefined' && hiddenInfo)
            return false
        if (this.enabled === true)
            return true
        return !(typeof gameSettings !== 'undefined' && gameSettings && gameSettings.testAI)
    },
    // The recording of the player's last AI turn (a finished one: endHash set), or null.
    lastRecording(playerIndex) {
        const recording = this.recordings[playerIndex]
        return recording && recording.endHash !== null ? recording : null
    },
    // A new game: nothing of the previous one stays readable.
    reset() {
        this.recordings = {}
        this.active = null
        this.depth = 0
    },
    copyCoord(coord) {
        return {x: coord.x, y: coord.y}
    },
    // Right before the player's turn-start processing (SimpleAiPlayer.prototype.nextTurn, wrapped below).
    beginTurn(player) {
        if (!this.isRecordingOn() || typeof players === 'undefined')
            return null
        const index = players.indexOf(player)
        if (index < 0 || index !== whooseTurn)
            return null
        const recording = {player: index, round: gameRound, snapshot: JSON.stringify(getGameObject()), actions: [],
            endHash: null}
        this.recordings[index] = recording
        return recording
    },
    // After the turn-start processing (Player.prototype.nextTurn), before the AI plays.
    recordStart(recording) {
        if (recording)
            recording.actions.push({action: {t: 'start'}, hash: stateHash()})
    },
    // Runs the AI's play() with its commands recorded.
    play(recording, execute) {
        if (!recording)
            return execute()
        const previous = this.active
        this.active = recording
        this.depth = 0
        try {
            return execute()
        } finally {
            this.active = previous
            this.depth = 0
            recording.endHash = stateHash()
        }
    },
    // A wrapped executor: records `action` when the outermost call pushed an undo entry.
    track(action, original, self, args) {
        if (!this.active || this.depth > 0 || !action)
            return original.apply(self, args)
        const recording = this.active
        const previous = actionManager.lastAction
        this.depth++
        let result
        try {
            result = original.apply(self, args)
        } finally {
            this.depth--
        }
        if (actionManager.lastAction !== previous)
            recording.actions.push({action: action, hash: stateHash()})
        return result
    },
    // Re-applies one recorded step on a board loaded from the recording's snapshot ({ok, reason?}).
    applyStep(action) {
        if (action && action.t === 'start') {
            Player.prototype.nextTurn.call(players[whooseTurn])
            return {ok: true}
        }
        return applyAction(action)
    },
    // Wraps the AI turn and the executors (once; index.html loads this after the classes).
    install() {
        if (this.installed)
            return
        this.installed = true
        const self = this
        const wrap = (proto, name, toAction) => {
            const original = proto[name]
            proto[name] = function() {
                if (!self.active || self.depth > 0)
                    return original.apply(this, arguments)
                return self.track(toAction(this, arguments), original, this, arguments)
            }
        }
        wrap(Unit.prototype, 'sendInstructions', (unit, args) => {
            if (!args[0] || !args[0].coord)
                return null
            const expect = {name: unit.name}
            if (unit.id !== undefined)
                expect.id = unit.id
            return {t: 'unit', from: self.copyCoord(unit.coord), to: self.copyCoord(args[0].coord), expect: expect}
        })
        wrap(Unit.prototype, 'skipMoves', unit => ({t: 'skip', at: self.copyCoord(unit.coord)}))
        const trainAction = (producer, args) => {
            const configured = typeof args[0] === 'string' &&
                Object.prototype.hasOwnProperty.call(production, args[0]) ? production[args[0]] : null
            if (!configured || !configured.production.isUnitProduction())
                return null
            return {t: 'train', producer: self.copyCoord(producer.coord), product: args[0]}
        }
        wrap(Town.prototype, 'prepare', trainAction)
        wrap(PreparingManufacture.prototype, 'prepare', trainAction)
        wrap(Town.prototype, 'sendInstructions', (town, args) => {
            const candidate = town.activeProduction
            if (!candidate || candidate.isEmpty() || !args[0] || !args[0].coord)
                return null
            return {t: 'build', producer: self.copyCoord(town.coord), product: candidate.name,
                at: self.copyCoord(args[0].coord)}
        })
        const originalDestroy = destroyEntityWithUndo
        destroyEntityWithUndo = function(entity) {
            if (!self.active || self.depth > 0 || !entity || !entity.coord)
                return originalDestroy.apply(this, arguments)
            return self.track({t: 'destroy', at: self.copyCoord(entity.coord), layer: 'building'}, originalDestroy,
                this, arguments)
        }
        // A new game (MapManager.clearActionLog, options/gamestart.js) drops the last game's recordings.
        const originalReset = actionLog.reset
        actionLog.reset = function() {
            self.reset()
            return originalReset.apply(this, arguments)
        }
        // The AI turn: snapshot, the turn start as a 'start' step, then play() with its commands recorded.
        SimpleAiPlayer.prototype.nextTurn = function() {
            const recording = self.beginTurn(this)
            Player.prototype.nextTurn.call(this)
            self.recordStart(recording)
            self.play(recording, () => this.play())
        }
    }
}
turnPlayback.install()
