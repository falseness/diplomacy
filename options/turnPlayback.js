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
// Part 2 (TASK-1495), turnPlaybackView below: the playback of those turns on the screen, step by step.
//
// Client only (index.html, after nextTurn.js); not a rules script (server/gameScriptList.js).

const turnPlayback = {
    // null: on for the shipped game, off for gameSettings.testAI runs; true / false force it.
    enabled: null,
    recordings: {},
    // The recordings made since the last turn a human ended (nextTurn): the AI turns a playback shows (turnPlaybackView).
    fresh: [],
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
    // The last local human whose turn ended (nextTurn): the viewer of a playback shown on an AI slot's turn (hot seat).
    lastHuman: null,
    // A turn ends by nextTurn() (a human's button, key or timer; a hot-seat AI slot's turn too): the AI turns played
    // after it are the next playback's.
    // (a neutral or lost slot's automatic pass, advanceOfflineTurn's own nextTurn(), keeps them)
    turnEnded() {
        // (a playback still running, e.g. no frame drawn since it began, ends on the computed board first)
        if (typeof turnPlaybackView !== 'undefined')
            turnPlaybackView.supersede()
        const player = typeof players !== 'undefined' ? players[whooseTurn] : null
        if (!player || player.isNeutral || player.isLost)
            return
        this.fresh = []
        if (player.constructor === Player)
            this.lastHuman = whooseTurn
    },
    // The recordings made since the last turn end (turnEnded), finished ones only; the list is emptied.
    takeFresh() {
        const fresh = this.fresh.filter(recording => recording.endHash !== null)
        this.fresh = []
        return fresh
    },
    // A new game: nothing of the previous one stays readable.
    reset() {
        // (TASK-1496: a playback still running belongs to the last game: dropped, its board never put back)
        if (typeof turnPlaybackView !== 'undefined')
            turnPlaybackView.discard()
        this.recordings = {}
        this.fresh = []
        this.lastHuman = null
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
        // fog: the board's fog when the AI starts (the ended human's view; the AI's moves add their vision to it): rules
        // read it (a catapult's shot into fog, a placement next to fog), so a playback re-applies the steps with it.
        const recording = {player: index, round: gameRound, snapshot: JSON.stringify(getGameObject()), actions: [],
            endHash: null, fog: typeof isFogOfWar !== 'undefined' && isFogOfWar && grid.fogOfWar ?
                grid.fogOfWar.map(column => Array.from(column)) : null}
        this.recordings[index] = recording
        this.fresh.push(recording)
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
            // (a demon's turn start refreshes its units first: DemonPlayer.nextTurn, not wrapped outside a recorded phase)
            const player = players[whooseTurn]
            if (typeof DemonPlayer !== 'undefined' && player instanceof DemonPlayer)
                DemonPlayer.prototype.nextTurn.call(player)
            else
                Player.prototype.nextTurn.call(player)
            return {ok: true}
        }
        // TASK-1497: the local co-op demon phase's wave spawn (advanceCoopLocalPhase stage 'wave')
        if (action && action.t === 'wave') {
            const phase = gameSettings.coop && gameSettings.coop.localPhase
            if (!phase || phase.stage !== 'wave' || phase.round !== action.round || whooseTurn !== gameSettings.coop.demonSlot ||
                    !this.coopPhase)
                return {ok: false, reason: 'not a demon phase wave'}
            // (the phase's own stage step: spawnCoopWave(round), then stage 'demon', as the recorded phase did)
            this.coopPhase()
            return {ok: true}
        }
        return applyAction(action)
    },
    // TASK-1497: the local co-op demon phase being recorded (advanceCoopLocalPhase, wrapped below), or null.
    demonPhase: null,
    // advanceCoopLocalPhase as nextTurn.js defines it (not recording): a playback's wave step.
    coopPhase: null,
    // The local co-op demon phase (offline co-op: advanceCoopLocalPhase, nextTurn.js) is recorded like an AI turn: the
    // snapshot before the wave spawn, a {t: 'wave', round} step (spawnCoopWave), the demons' turn start {t: 'start'}
    // (DemonPlayer.nextTurn) and every command of their play() (spendGold's purchases, the combat AI's moves and
    // attacks). A phase resumed from a save at stage 'demon' starts its recording there (no wave step). The phase
    // itself runs unchanged (its saved localPhase semantics too).
    installDemonPhase() {
        if (typeof advanceCoopLocalPhase !== 'function' || typeof DemonPlayer !== 'function')
            return
        const self = this
        const originalPhase = this.coopPhase = advanceCoopLocalPhase
        advanceCoopLocalPhase = function() {
            const phase = gameSettings.coop && gameSettings.coop.localPhase
            const stage = phase && phase.stage
            if (stage === 'wave') {
                const recording = self.demonPhase = self.beginTurn(players[whooseTurn])
                if (recording)
                    recording.demon = true
                const result = originalPhase.apply(this, arguments)
                if (recording && self.demonPhase === recording)
                    recording.actions.push({action: {t: 'wave', round: phase.round}, hash: stateHash()})
                return result
            }
            if (stage === 'demon') {
                let recording = self.demonPhase
                if (!recording || recording.player !== whooseTurn || recording.endHash !== null) {
                    recording = self.beginTurn(players[whooseTurn])
                    if (recording)
                        recording.demon = true
                }
                self.demonPhase = recording
                try {
                    return originalPhase.apply(this, arguments)
                } finally {
                    self.demonPhase = null
                    if (recording && recording.endHash === null)
                        recording.endHash = stateHash()
                }
            }
            return originalPhase.apply(this, arguments)
        }
        const originalNextTurn = DemonPlayer.prototype.nextTurn
        DemonPlayer.prototype.nextTurn = function() {
            const result = originalNextTurn.apply(this, arguments)
            const recording = self.demonPhase
            if (recording && recording.player === players.indexOf(this) && !recording.actions.some(step => step.action.t === 'start'))
                self.recordStart(recording)
            return result
        }
        const originalPlay = DemonPlayer.prototype.play
        DemonPlayer.prototype.play = function() {
            const recording = self.demonPhase
            if (!recording || recording.player !== players.indexOf(this) || self.active)
                return originalPlay.apply(this, arguments)
            return self.play(recording, () => originalPlay.apply(this, arguments))
        }
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
        this.installDemonPhase()
    }
}
turnPlayback.install()

// Step-by-step turn playback, part 2 (TASK-1495), UI only: the rules result is unchanged (the computed board is what
// stays, the very objects advanceOfflineTurn left).
//
// When advanceOfflineTurn (nextTurn.js) is about to start the next human's turn (timer set, before the save and the
// pass-device screen) and AI turns were recorded since the last turn end (turnPlayback.takeFresh), begin() takes the
// computed board aside (the globals loadFromJson replaces: grid, players, timer, ...), saves the game (the computed
// board) and shows each recording: its snapshot is loaded (loadFromJson; the AI slots keep their classes for the
// effects' own/others' rule), the recorded fog restored for the rules, and the steps are applied one at a time
// (turnPlayback.applyStep): cells, borders, buildings, the viewer's fog, hp and units change step by step. A step the
// viewer sees (its cells in the viewer's fog) first glides the camera there (Screen.glideTo, one glide per step, as the
// attack replay of TASK-1428 does), then it is applied in the next frame and waits for its own move slide
// (moveTween, started along the unit's way), attack effects (attackFx, played in place: the playback owns the camera)
// and heal effects (healFx: a 'start' step's heals), or a short dwell for a train/build/destroy; an unseen step only
// waits one drawn frame. Every step's hash is compared with the recording's, and the end hash with its endHash.
// A mismatch, a rejected step or an exception ends the playback at once on the computed board and logs
// 'turn playback drift' with the step index (drifts). At the end the camera glides back to where it was.
// Pacing: the time of the effects, slides and glides runs on a scaled clock (the moveTween / attackFx / healFx clocks
// are wrapped while a playback runs): at every step the speed is set so that the steps left (estimated per kind) end
// within targetMs of the AI turn's start; past capMs whatever is left of it is applied at once. Never more than 30 s per
// AI turn: several AI turns in one playback play one after another in turn order, each with its own cap (TASK-1496).
// Player time: the next human's turn (the pass-device screen, the timer's start, input) begins only when the playback
// ends (begin's start callback); the timer is set before and not running during it. A click or a key during the playback
// skips it (the computed board at once); the camera can still pan and zoom.
// Off (today's behaviour: the computed board at once, others' attacks replayed after it) when otherSettings.replayOthers
// is false, when the 'Animations' row is off (animateMoves / animateAttacks false), online, for partial boards, in
// headless runs (gameSettings.testAI, no camera glide) and while turnPlayback.enabled is false.
// Safety (TASK-1496): a save during a playback stores the computed board (withLiveBoard, options/save.js); leaving the
// game (menu.stopGame) cancels it with nothing left running, and a new game drops it (discard); either settings row
// turned off jumps to the computed board (settingsChanged, also checked every frame); a tutorial result or a co-op game
// end found after recorded AI turns shows when the playback ends or is cut (finishAfter, nextTurn.js); a resize, pan or
// zoom keeps it going. A loaded snapshot gets the computed players' map settings (playerSettings: economyEnabled).
const turnPlaybackView = {
    // null: on when the conditions above hold; false / true force it (tests).
    enabled: null,
    targetMs: 25000,
    capMs: 29000,
    // A step's wait never exceeds this (real ms): an effect that does not end does not hold the playback.
    stepTimeoutMs: 4000,
    // ms (speed 1) a step of each kind is estimated to take (glide, slide, effect or dwell).
    estimates: {start: 900, wave: 1000, unit: 1250, skip: 60, train: 600, build: 600, destroy: 600},
    // Player fields set from the map (GameMap.createPlayers) that a loaded snapshot lacks (load()).
    playerSettings: ['economyEnabled', 'ignoresFog'],
    // Dwell (scaled ms) of a seen step with nothing animated (a train, a build, a destroy).
    dwellMs: 300,
    // TASK-1497: dwell (scaled ms) of a seen wave spawn (the new demons on their portals).
    waveDwellMs: 700,
    // The running playback, null when none.
    active: null,
    // Evidence and tests: the last playbacks' logs (bounded), drift records.
    logs: [],
    drifts: [],
    // Tests: called after each applied step (playback, index) and when a playback ends (log).
    onStep: null,
    onEnd: null,
    now() {
        return typeof performance != 'undefined' ? performance.now() : Date.now()
    },
    isOn() {
        if (this.enabled === false)
            return false
        if (typeof otherSettings !== 'undefined' && (otherSettings.replayOthers === false ||
                otherSettings.animateMoves === false || otherSettings.animateAttacks === false))
            return false
        if (typeof gameSettings !== 'undefined' && gameSettings && gameSettings.isOnline)
            return false
        if (typeof hiddenInfo !== 'undefined' && hiddenInfo)
            return false
        if (this.enabled === true)
            return true
        if (typeof gameSettings !== 'undefined' && gameSettings && gameSettings.testAI)
            return false
        const screen = typeof gameEvent !== 'undefined' && gameEvent ? gameEvent.screen : null
        return !!screen && typeof screen.glideTo === 'function' && typeof canvas !== 'undefined' && !!canvas && !!canvas.offset
    },
    isActive() {
        return this.active !== null
    },
    // The globals loadFromJson replaces (and those it writes: the stored timers).
    captureGlobals() {
        const timers = []
        for (let i = 0; i < players.length; ++i)
            timers.push(unpacker.getPlayerTimerByIndex(i))
        return {grid, players, external, externalProduction, nature, goldmines, timer, whooseTurn, gameRound, isFogOfWar,
            gameSettings, hiddenInfo, hiddenStatus, onlineGameStorage, timers}
    },
    restoreGlobals(g, storedTimers = true) {
        grid = g.grid
        players = g.players
        external = g.external
        externalProduction = g.externalProduction
        nature = g.nature
        goldmines = g.goldmines
        timer = g.timer
        whooseTurn = g.whooseTurn
        gameRound = g.gameRound
        isFogOfWar = g.isFogOfWar
        gameSettings = g.gameSettings
        hiddenInfo = g.hiddenInfo
        hiddenStatus = g.hiddenStatus
        onlineGameStorage = g.onlineGameStorage
        if (!storedTimers)
            return
        for (let i = 0; i < g.timers.length; ++i) {
            if (g.timers[i] === null)
                localStorage.removeItem(gameStorageSlot() + 'timer' + i)
            else
                localStorage.setItem(gameStorageSlot() + 'timer' + i, g.timers[i])
        }
    },
    // TASK-1496: fn() runs on the computed board (the live globals) while a playback shows its own board: a save (manual,
    // the turn-end save, a flush on input or pagehide) stores the computed final state, never an intermediate board.
    // The stored timers keep the computed board's values afterwards (no step reads them).
    withLiveBoard(fn) {
        const p = this.active
        if (!p)
            return fn()
        const shown = this.captureGlobals()
        this.restoreGlobals(p.live)
        try {
            return fn()
        } finally {
            this.restoreGlobals(shown, false)
        }
    },
    // The menu's 'Animations' and 'replay others' rows (and enabled) still allow a playback.
    settingsAllow() {
        if (this.enabled === false)
            return false
        return !(typeof otherSettings !== 'undefined' && (otherSettings.replayOthers === false ||
            otherSettings.animateMoves === false || otherSettings.animateAttacks === false))
    },
    // A settings change (the menu, menu.js; also checked every frame): turned off, a running playback jumps to the
    // computed board at once and the turn goes on.
    settingsChanged() {
        const p = this.active
        if (p && !this.settingsAllow())
            this.end(p, 'off')
    },
    // TASK-1496: a result found on the computed board right after recorded AI turns (a tutorial's result, a game end:
    // advanceOfflineTurn): over() true -> the playback runs first and show() runs on the computed board when it ends
    // (at once when it is cut: a click, a key, a settings change, a drift). False (nothing begun) when there is nothing
    // to play or over() is false: the caller checks as before.
    finishAfter(viewer, over, show) {
        if (this.active || typeof turnPlayback === 'undefined' || !this.isOn())
            return false
        if (!turnPlayback.fresh.some(recording => recording.endHash !== null) || !over())
            return false
        return this.begin(viewer, show)
    },
    // TASK-1496: the game is left (menu.stopGame: back to the menu, a tutorial's Retry / Next, then maybe a load): the
    // computed board is put back for the exit's own save and timer pause; no step, glide, slide, effect or turn start is
    // left.
    cancel() {
        const p = this.active
        if (!p)
            return false
        this.end(p, 'exit')
        return true
    },
    // A new game's reset (turnPlayback.reset): a playback still running is dropped without putting its globals back (the
    // new game's own are set); the effects and clocks are cleared.
    discard() {
        const p = this.active
        if (!p)
            return false
        this.end(p, 'discarded')
        return true
    },
    // Called by advanceOfflineTurn with the next human's view (viewer) and the rest of its turn start (start): true when a
    // playback began (start runs when it ends), false to go on at once.
    begin(viewer, start) {
        if (this.active || typeof turnPlayback === 'undefined')
            return false
        const recordings = turnPlayback.takeFresh()
        if (!recordings.length || !this.isOn())
            return false
        if (typeof players !== 'undefined' && players[viewer] && players[viewer].constructor !== Player &&
                turnPlayback.lastHuman !== null)
            viewer = turnPlayback.lastHuman
        // The computed board is saved now: the save after the next frame would read the playback's board.
        if (typeof saveManager !== 'undefined' && saveManager)
            saveManager.save()
        const screen = gameEvent.screen
        const steps = recordings.reduce((n, recording) => n + recording.actions.length, 0)
        const p = this.active = {
            recordings, viewer, start, steps, live: this.captureGlobals(), finalHash: stateHash(),
            liveClasses: players.map(player => Object.getPrototypeOf(player)),
            recordingIndex: 0, stepIndex: -1, phase: 'load', rulesFog: null,
            startReal: this.now(), recordingStart: this.now(), stepReal: 0, stepScaled: 0, frames: 0, dwell: 0,
            home: screen.centre(), moved: false, screen,
            clock: {real0: this.now(), scaled0: 0, speed: 1}, wrapped: [],
            stash: {later: attackFx.later, attackView: attackFx.view, sequential: attackFx.sequential,
                heals: healFx.effects, healView: healFx.view},
            log: {player: recordings.map(recording => recording.player), round: recordings[0].round, viewer, steps,
                timerBefore: timer.timeLeft, startReal: this.now(), entries: [], speeds: [], recordings: [], result: null}
        }
        // The AI turn's own effects (its attacks and heals, read while it played) are made again by the steps; the next
        // human's own heals (its turn start) wait for the end.
        attackFx.later = []
        attackFx.effects.length = 0
        attackFx.hidden.clear()
        attackFx.endReplay(null)
        attackFx.sequential = false
        attackFx.view = null
        healFx.effects = []
        healFx.hidden.clear()
        healFx.view = null
        moveTween.clear()
        gameEvent.removeSelection()
        gameEvent.hideAll()
        // The turn cannot be ended during the playback: the button is inactive until the human's turn starts (the
        // pass-device screen's hide, or a tutorial's start, deactivates it for its usual second, nextTurn.js).
        if (typeof nextTurnButton !== 'undefined' && nextTurnButton) {
            clearTimeout(nextTurnButton.activateTimer)
            nextTurnButton.unactive = true
        }
        for (const object of [moveTween, attackFx, healFx])
            this.wrapClock(object)
        return true
    },
    // object.now() runs on the playback's speed (rebased at every change: no jump).
    wrapClock(object) {
        const p = this.active
        const hadOwn = Object.prototype.hasOwnProperty.call(object, 'now'), previous = object.now
        const entry = {object, hadOwn, previous, read: () => previous.call(object)}
        entry.real0 = entry.read()
        entry.scaled0 = entry.real0
        object.now = () => entry.scaled0 + (entry.read() - entry.real0) * p.clock.speed
        p.wrapped.push(entry)
    },
    unwrapClocks(p) {
        for (const entry of p.wrapped) {
            if (entry.hadOwn)
                entry.object.now = entry.previous
            else
                delete entry.object.now
        }
        p.wrapped = []
    },
    scaledNow(p = this.active) {
        return p.clock.scaled0 + (this.now() - p.clock.real0) * p.clock.speed
    },
    setSpeed(p, speed) {
        if (speed === p.clock.speed)
            return
        const scaled = this.scaledNow(p)
        for (const entry of p.wrapped) {
            const now = entry.object.now()
            entry.real0 = entry.read()
            entry.scaled0 = now
        }
        p.clock = {real0: this.now(), scaled0: scaled, speed}
    },
    // The playback's speed for the steps left of the AI turn shown: they end within targetMs of that turn's start (one
    // frame each not scaled). Several AI turns in a row play one after another, each paced on its own (TASK-1496).
    pace(p) {
        let estimate = 0, left = 0
        const actions = p.recordings[p.recordingIndex].actions
        for (let i = Math.max(0, p.stepIndex); i < actions.length; ++i) {
            estimate += this.estimates[actions[i].action.t] ?? 600
            ++left
        }
        estimate += 300
        const available = this.targetMs - (this.now() - p.recordingStart) - left * 20
        const speed = Math.min(64, Math.max(1, estimate / Math.max(available, 500)))
        this.setSpeed(p, speed)
        p.log.speeds.push(Math.round(speed * 100) / 100)
    },
    cell(coord) {
        return coord && grid.arr[coord.x] && grid.arr[coord.x][coord.y] ? grid.arr[coord.x][coord.y] : null
    },
    // Whether the viewer sees coord (its fog on the playback's board).
    seen(coord) {
        const cell = this.cell(coord)
        if (!cell || cell.hexagon.unknown)
            return false
        return !isFogOfWar || !grid.fogOfWar || Boolean(grid.fogOfWar[coord.x][coord.y])
    },
    centreOf(coord) {
        const p = this.cell(coord).hexagon.calcPos()
        return {x: p.x, y: p.y}
    },
    // The cells a step shows (seen ones) and where the camera centres for it; null when the viewer sees none.
    focus(action) {
        let coords = []
        if (action.t === 'unit')
            coords = [action.from, action.to]
        else if (action.t === 'train')
            coords = [action.producer]
        else if (action.t === 'build' || action.t === 'destroy')
            coords = [action.at]
        else if (action.t === 'wave')
            coords = this.waveCells(action)
        coords = coords.filter(coord => this.seen(coord))
        if (!coords.length)
            return null
        // (a wave's portals can be far apart: the camera goes to the seen spawn nearest to where it is)
        if (action.t === 'wave' && coords.length > 1) {
            const here = gameEvent.screen.centre()
            const distance = coord => { const q = this.centreOf(coord); return Math.hypot(q.x - here.x, q.y - here.y) }
            coords = [coords.reduce((best, coord) => distance(coord) < distance(best) ? coord : best)]
        }
        const points = coords.map(coord => this.centreOf(coord))
        return {x: points.reduce((s, q) => s + q.x, 0) / points.length, y: points.reduce((s, q) => s + q.y, 0) / points.length}
    },
    // TASK-1497: the cells a wave step spawns demons on (the wave generateCoopWave composes for the playback's board; its
    // typedWaves bookkeeping is put back, so the step itself composes the same wave).
    waveCells(action) {
        const coop = gameSettings.coop
        if (!coop || typeof generateCoopWave !== 'function')
            return []
        const had = Object.prototype.hasOwnProperty.call(coop, 'typedWaves'), typedWaves = coop.typedWaves
        try {
            const wave = generateCoopWave(action.round)
            return (wave && wave.selections || []).filter(entry => {
                const cell = this.cell(entry)
                return cell && cell.unit.isEmpty() && cell.building.isDemonPortal
            }).map(entry => ({x: entry.x, y: entry.y}))
        } catch (error) {
            return []
        } finally {
            if (had)
                coop.typedWaves = typedWaves
            else
                delete coop.typedWaves
        }
    },
    // The unit's cells from action.from to action.to along the way its selection computes (for its slide), or null.
    unitPath(action) {
        const cell = this.cell(action.from)
        const unit = cell && cell.unit
        if (!unit || unit.isEmpty() || unit.killed || !unit.interaction)
            return null
        let path = null
        try {
            unit.select()
            const way = unit.interaction.way
            if (way && typeof way.getParent === 'function') {
                path = [{x: action.to.x, y: action.to.y}]
                for (let guard = 0; guard < 64 && !coordsEqually(path[0], action.from); ++guard) {
                    const parent = way.getParent(path[0])
                    if (!parent || coordsEqually(parent, path[0]))
                        break
                    path.unshift({x: parent.x, y: parent.y})
                }
                if (!coordsEqually(path[0], action.from))
                    path = null
            }
        } finally {
            unit.removeSelect()
        }
        return path
    },
    // The viewer's fog on the playback's board (the rules' fog is kept aside for the next step).
    showViewerFog(p) {
        if (!isFogOfWar || !grid.visionWay)
            return
        p.rulesFog = grid.fogOfWar
        if (players[p.viewer])
            players[p.viewer].changeFogOfWarByVision()
    },
    useRulesFog(p) {
        if (isFogOfWar && p.rulesFog)
            grid.fogOfWar = p.rulesFog
    },
    load(p) {
        const recording = p.recordings[p.recordingIndex]
        moveTween.clear()
        // TASK-1511: the snapshot is this client's own board (a co-op tutorial's has no generation metadata).
        unpacker.ownSnapshot = true
        try {
            loadFromJson(recording.snapshot)
        } finally {
            unpacker.ownSnapshot = false
        }
        // The AI slots keep their classes (loadFromJson makes plain Players): others' effects, not own ones.
        for (let i = 0; i < players.length && i < p.liveClasses.length; ++i)
            if (Object.getPrototypeOf(players[i]) !== p.liveClasses[i] && players[i].constructor === Player)
                Object.setPrototypeOf(players[i], p.liveClasses[i])
        // TASK-1496: the map's player settings a board JSON does not carry (Player.toJSON: gold, towns, units, colour) come
        // from the computed board's players: a tutorial's economyEnabled false (else the 'start' step's salary disbands the
        // units: a drift) and ignoresFog.
        for (let i = 0; i < players.length && i < p.live.players.length; ++i)
            for (const key of this.playerSettings)
                if (Object.prototype.hasOwnProperty.call(p.live.players[i], key))
                    players[i][key] = p.live.players[i][key]
        actionManager.clear()
        if (isFogOfWar && recording.fog)
            grid.fogOfWar = recording.fog.map(column => Array.from(column))
        p.rulesFog = isFogOfWar ? grid.fogOfWar : null
        this.showViewerFog(p)
        p.stepIndex = -1
        p.recordingStart = this.now()
        p.log.recordings.push({player: recording.player, round: recording.round, start: Math.round(p.recordingStart - p.startReal),
            steps: recording.actions.length})
    },
    // Applies the step at p.stepIndex; false on a drift (ended already).
    apply(p) {
        const recording = p.recordings[p.recordingIndex]
        const step = recording.actions[p.stepIndex]
        const action = step.action
        this.useRulesFog(p)
        const unit = action.t === 'unit' ? this.cell(action.from)?.unit : null
        const path = unit && unit.notEmpty() ? this.unitPath(action) : null
        const heals = action.t === 'start' ? healFx.before(whooseTurn) : null
        let result
        try {
            result = turnPlayback.applyStep(action)
        } finally {
            if (heals)
                healFx.after(heals)
        }
        const entry = {i: p.stepIndex, t: action.t, ok: !!(result && result.ok)}
        p.log.entries.push(entry)
        if (!result || !result.ok)
            return this.drift(p, `step ${p.stepIndex} rejected: ${result && result.reason}`)
        if (stateHash() !== step.hash)
            return this.drift(p, `step ${p.stepIndex} hash`)
        if (path && unit && !unit.killed && !coordsEqually(unit.coord, action.from)) {
            const end = path.findIndex(cell => coordsEqually(cell, unit.coord))
            if (end > 0)
                entry.slide = moveTween.start(unit, path.slice(0, end + 1))
        }
        this.showViewerFog(p)
        entry.at = Math.round(this.now() - p.startReal)
        if (this.onStep)
            this.onStep(p, p.stepIndex)
        return true
    },
    // Whether the step's slide or effects still play (on the scaled clocks).
    busy() {
        for (const unit of [...moveTween.tweens.keys()])
            if (moveTween.state(unit))
                return true
        if (attackFx.later.length)
            return true
        const attackNow = attackFx.now()
        if (attackFx.effects.some(e => e.startTime === null || attackNow - e.startTime < e.duration))
            return true
        const healNow = healFx.now()
        return healFx.effects.some(e => e.startTime === null || healNow - e.startTime < e.duration)
    },
    // Every frame (drawMain, before the effects' prune): drives the running playback.
    tick() {
        const p = this.active
        if (!p)
            return
        try {
            this.advance(p)
        } catch (error) {
            console.log('turn playback error', error)
            if (this.active === p)
                this.drift(p, `step ${p.stepIndex} exception: ${error && error.message || error}`)
        }
    },
    advance(p) {
        if (typeof gameExit !== 'undefined' && gameExit)
            return this.end(p, 'exit')
        if (!this.settingsAllow())
            return this.end(p, 'off')
        ++p.frames
        // (each AI turn of the playback has its own cap, from its load)
        if (p.phase !== 'load' && this.now() - p.recordingStart > this.capMs)
            return this.rush(p)
        for (let guard = 0; guard < 4; ++guard) {
            if (p.phase === 'load') {
                this.load(p)
                p.phase = 'next'
                return
            }
            if (p.phase === 'next') {
                const recording = p.recordings[p.recordingIndex]
                ++p.stepIndex
                if (p.stepIndex >= recording.actions.length) {
                    if (stateHash() !== recording.endHash)
                        return this.drift(p, `step ${p.stepIndex} end hash`)
                    this.recordingDone(p)
                    if (++p.recordingIndex < p.recordings.length) {
                        p.phase = 'load'
                        continue
                    }
                    return this.goHome(p)
                }
                this.pace(p)
                const action = recording.actions[p.stepIndex].action
                const target = action.t === 'start' || action.t === 'skip' ? null : this.focus(action)
                p.seen = !!target || action.t === 'start'
                if (target) {
                    p.screen.glideTo(target, Screen.GLIDE_DURATION, () => this.scaledNow(p))
                    p.moved = true
                    p.phase = 'glide'
                    return
                }
                p.phase = 'apply'
                continue
            }
            if (p.phase === 'glide') {
                if (p.screen.glide)
                    return
                p.phase = 'apply'
                return
            }
            if (p.phase === 'apply') {
                if (!this.apply(p))
                    return
                const action = p.recordings[p.recordingIndex].actions[p.stepIndex].action
                p.dwell = !p.seen || action.t === 'unit' || action.t === 'start' ? 0 :
                    action.t === 'wave' ? this.waveDwellMs : this.dwellMs
                p.stepReal = this.now()
                p.stepScaled = this.scaledNow(p)
                p.stepFrames = 0
                p.phase = 'wait'
                return
            }
            if (p.phase === 'wait') {
                ++p.stepFrames
                const timeout = this.now() - p.stepReal > this.stepTimeoutMs
                if (!timeout && (this.scaledNow(p) - p.stepScaled < p.dwell || this.busy()))
                    return
                const entry = p.log.entries[p.log.entries.length - 1]
                entry.frames = p.stepFrames
                entry.ms = Math.round(this.now() - p.stepReal)
                if (timeout)
                    entry.timeout = true
                p.phase = 'next'
                continue
            }
            if (p.phase === 'home') {
                if (p.screen.glide)
                    return
                return this.end(p, 'ok')
            }
            return
        }
    },
    // An AI turn's last step is shown: its time (from its load) in the log.
    recordingDone(p) {
        const entry = p.log.recordings[p.recordingIndex]
        if (entry)
            entry.ms = Math.round(this.now() - p.recordingStart)
    },
        goHome(p) {
        if (!p.moved)
            return this.end(p, 'ok')
        p.screen.glideTo(p.home, Screen.GLIDE_DURATION, () => this.scaledNow(p))
        p.phase = 'home'
    },
    // Past capMs of the AI turn shown: its steps left at once (their hashes still checked), then the next AI turn (its own
    // cap) or the end.
    rush(p) {
        p.log.rushed = true
        p.log.recordings[p.log.recordings.length - 1].rushed = true
        if (p.screen.glide)
            p.screen.stopGlide()
        if (p.phase === 'home')
            return this.end(p, 'ok')
        if (p.phase === 'load') {
            this.load(p)
            p.phase = 'next'
        }
        // (glide, apply: the step at stepIndex is not applied yet; wait, next: it is)
        if ((p.phase === 'glide' || p.phase === 'apply') && !this.apply(p))
            return
        p.phase = 'next'
        for (;;) {
            const recording = p.recordings[p.recordingIndex]
            ++p.stepIndex
            if (p.stepIndex >= recording.actions.length) {
                if (stateHash() !== recording.endHash)
                    return this.drift(p, `step ${p.stepIndex} end hash`)
                this.recordingDone(p)
                if (++p.recordingIndex >= p.recordings.length)
                    return this.end(p, 'ok')
                p.phase = 'load'
                return
            }
            if (!this.apply(p))
                return
        }
    },
    // A mismatch: the computed board at once, one log line.
    drift(p, reason) {
        const recording = p.recordings[p.recordingIndex]
        const record = {player: recording ? recording.player : null, round: recording ? recording.round : null,
            recording: p.recordingIndex, step: p.stepIndex, reason}
        this.drifts.push(record)
        if (this.drifts.length > 32)
            this.drifts.shift()
        console.log(`turn playback drift: player ${record.player} round ${record.round} step ${record.step} (${reason})`)
        p.log.drift = record
        this.end(p, 'drift')
        return false
    },
    // A click or a key while a playback runs: the computed board at once (the input is spent on it).
    skip() {
        const p = this.active
        if (!p)
            return false
        this.end(p, 'skipped')
        return true
    },
    // A turn ends while a playback runs (nextTurn): the computed board at once; the turn start it waited for is not run
    // (the turn that ends now had started without it).
    supersede() {
        const p = this.active
        if (!p)
            return false
        this.end(p, 'superseded')
        return true
    },
    // Ends the playback: the computed board (the objects advanceOfflineTurn left) is back, then the human's turn begins.
    end(p, result) {
        if (this.active !== p)
            return
        this.active = null
        if (p.screen.glide)
            p.screen.stopGlide()
        this.unwrapClocks(p)
        moveTween.clear()
        attackFx.effects.length = 0
        attackFx.hidden.clear()
        attackFx.endReplay(null)
        attackFx.sequential = p.stash.sequential
        attackFx.view = p.stash.attackView
        healFx.view = p.stash.healView
        healFx.effects.length = 0
        healFx.hidden.clear()
        // (discarded: a new game's globals are set already; nothing of the old game stays)
        const left = result === 'exit' || result === 'discarded'
        if (result !== 'discarded')
            this.restoreGlobals(p.live)
        // Shown: the AI turns' effects played (or cut: a skip, the settings turned off); else (a drift) they play as without
        // a playback. The next human's own heals (its turn start) always stay. A left game keeps none.
        const shown = result === 'ok' || result === 'skipped' || result === 'superseded' || result === 'off'
        attackFx.later = shown || left ? [] : p.stash.later
        healFx.effects = left ? [] : shown ? p.stash.heals.filter(e => !e.other) : p.stash.heals
        if (!left)
            healFx.hideUnits()
        actionManager.clear()
        actionLog.clear()
        gameEvent.removeSelection()
        const log = p.log
        log.result = result
        log.ms = Math.round(this.now() - p.startReal)
        log.frames = p.frames
        log.finalHash = result === 'discarded' ? null : stateHash() === p.finalHash
        log.timerAfter = result === 'discarded' ? null : timer.timeLeft
        this.logs.push(log)
        if (this.logs.length > 8)
            this.logs.shift()
        if (this.onEnd)
            this.onEnd(log)
        if (!left && result !== 'superseded' && p.start)
            p.start()
    }
}
