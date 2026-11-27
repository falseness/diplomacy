// Runs the tutorials of options/tutorials.js: an offline game with fog of war in which
// the human plays red (slot 1) and blue (slot 2) moves automatically. gameSettings.tutorial
// = {id} marks the game; such a game is never saved and shows no pass-device screen.
const TUTORIAL_HUMAN_SLOT = 1
const TUTORIAL_AI_SLOT = 2
// The normal sudden death round; a tutorials entry may set its own suddenDeathRound.
const TUTORIAL_SUDDEN_DEATH_ROUND = 40

class TutorialManager {
    // True from Retry/Next tutorial (switchTo) until the new tutorial starts.
    static switching = false
    static start(id) {
        const tutorial = tutorials.find(tutorial => tutorial.id === id)
        if (!tutorial)
            throw new Error('Unknown tutorial ' + id)
        tutorialResultInterface.hide()
        TutorialManager.switching = false
        // TASK-1679: tutorial 0 opens with the 'click to control' arrow (drawTutorialHints) until red's first unit
        // selection; a start (the menu, Retry) brings it back, an undo does not.
        TutorialManager.clickHint = id === 'tutorial-0'
        TutorialManager.clickHintUnit = null
        // TASK-1681: the click hint's clock (fade-in, dust, pulse) starts at its first painted frame.
        TutorialManager.clickHintClock = null
        // TASK-1716: after the click hint, a selected red unit gets its move hint (tutorialMoveHintTarget) until red's
        // first hit on a blue unit (InterationWithUnit.hitUnit); a start (the menu, Retry) brings it back, an undo does not.
        TutorialManager.moveHint = id === 'tutorial-0'
        // TASK-1721: a start (the menu, Retry, Next tutorial) is a new attempt: thinking clock, offer and tip reset.
        TutorialTips.reset(id)
        const map = tutorial.map
        map.tutorial = {id: id}
        // 'surviveRounds' counts red's units only when the map gives red no town; 'coopVictory' and
        // 'demonUnitsDead' need a red town only when the map gives red one.
        const human = map.players[TUTORIAL_HUMAN_SLOT]
        TutorialManager.humanStartsWithTown = !!(human && human.towns && human.towns.length)
        suddenDeathRound = tutorial.suddenDeathRound || TUTORIAL_SUDDEN_DEATH_ROUND
        GameManager.start(map, true)
    }
    // Called after every human move and every turn; true once the tutorial is over.
    static checkResult() {
        if (!gameSettings.tutorial)
            return false
        if (tutorialResultInterface.visible)
            return true
        let outcome = null
        if (TutorialManager.isPassed()) {
            markTutorialPassed(gameSettings.tutorial.id)
            outcome = 'victory'
        }
        else if (TutorialManager.isFailed()) {
            outcome = 'defeat'
        }
        if (!outcome)
            return false
        nextTurnPauseInterface.hideButDontUpdateTimer()
        gameEvent.nextTurn()
        gameEvent.waitingMode = true
        tutorialResultInterface.show(outcome)
        if (outcome === 'victory')
            try {
                TutorialManager.prebuildNext(TutorialManager.nextId())
            } catch (error) {
                // (only work ahead: the next board builds whatever it does not find)
                console.warn('tutorial prebuild', error)
            }
        return true
    }
    // TASK-1616 (TUTORIAL PERF 3/7): THE NEXT TUTORIAL'S BOARD MADE AHEAD ON THE RESULT SCREEN. Next tutorial starts a new
    // board whose first frames made its surface cache's cell mask (the click freeze of artifacts/TASK-1614/causes.md,
    // problem 2; TASK-1708: its map-edge rock sprites, asked of the rock workers here too, are gone). While a won
    // tutorial's result screen shows, the next tutorial's cell mask (of its stand-in board, Grid.prebuildBoardOf) is built
    // a step a frame (Grid.prebuildCellMaskSteps, PREBUILD_STEP_MS each, in an animation frame
    // callback: timers starved behind the busy result screen's frames, 7 steps in 3.3 s on the tutorial replay; the same
    // builders and keys as the board's own, so the board finds them kept or, its mask not finished, goes on with the same
    // build: cellMaskJob). Stops when the result screen hides but for Next tutorial's switch (TutorialManager.switching,
    // until the new board starts: then its own steps take over the build).
    static PREBUILD_STEP_MS = 24
    static prebuilds = 0
    // The last prebuild: {id, steps, ms: its mask steps' time, done: the mask finished by it}.
    static prebuildLog = null
    static prebuildNext(id) {
        const tutorial = id && tutorials.find(tutorial => tutorial.id === id)
        if (!tutorial || typeof otherSettings === 'undefined' || !otherSettings.atmosphericVisuals ||
                typeof Grid === 'undefined')
            return
        const map = tutorial.map
        ++TutorialManager.prebuilds
        const log = TutorialManager.prebuildLog = {id, calls: 0, steps: 0, ms: 0, done: false, at: performance.now(), doneAt: null}
        if (Grid.liveCellLayer !== true)
            return
        const steps = Grid.prebuildCellMaskSteps(map), shown = tutorialResultInterface
        const step = () => {
            // (Next tutorial: on through the switch, until the new board's start hides nothing more: its own steps go on.)
            if (!shown.visible && !TutorialManager.switching)
                return
            const start = performance.now()
            ++log.calls
            try {
                for (;;) {
                    ++log.steps
                    if (steps.next().done) {
                        log.done = true
                        log.doneAt = performance.now()
                        return
                    }
                    if (performance.now() - start >= TutorialManager.PREBUILD_STEP_MS)
                        break
                }
            } finally {
                log.ms += performance.now() - start
            }
            requestAnimationFrame(step)
        }
        requestAnimationFrame(step)
    }
    // The pass rule of the running tutorial (tutorials entry `pass`), see options/tutorials.js.
    static isPassed() {
        const tutorial = tutorials.find(tutorial => tutorial.id === gameSettings.tutorial.id)
        const human = players[TUTORIAL_HUMAN_SLOT], enemy = players[TUTORIAL_AI_SLOT]
        switch (tutorial ? tutorial.pass : 'enemyUnitsDead') {
            case 'enemyUnitsDead':
                enemy.updateUnits()
                return enemy.units.length === 0
            case 'enemyTypesDead':
                // Every blue unit whose class is in tutorial.types dead; blue units of other classes do not matter.
                if (!tutorial.types || !tutorial.types.length)
                    throw new Error('Unknown tutorial pass rule ' + tutorial.pass + ' without types')
                enemy.updateUnits()
                return !enemy.units.some(unit => tutorial.types.includes(unit.constructor.name) && !unit.killed && unit.hp > 0)
            case 'enemyLost':
                return enemy.isLost
            case 'demonUnitsDead':
                // Every demon unit dead (as coopResult counts them); portals and demon buildings do not matter.
                human.updateTowns()
                return (human.towns.length > 0 || !TutorialManager.humanStartsWithTown) && players.every(player => player.role !== 'DEMONS' ||
                    !player.units.some(unit => !unit.killed && unit.hp > 0))
            case 'coopVictory':
                human.updateTowns()
                return players[0].coopResult === 'victory' && (human.towns.length > 0 || !TutorialManager.humanStartsWithTown)
            case 'captureTowns':
                return tutorial.targets.every(target => {
                    const building = grid.getCell(target).building
                    return building instanceof Town && !building.killed && building.player === human
                })
            case 'surviveRounds':
                if (gameRound < tutorial.rounds)
                    return false
                human.updateTowns()
                if (human.towns.length > 0)
                    return true
                human.updateUnits()
                return !TutorialManager.humanStartsWithTown && human.units.length > 0
            default:
                throw new Error('Unknown tutorial pass rule ' + tutorial.pass)
        }
    }
    static isFailed() {
        return players[TUTORIAL_HUMAN_SLOT].isLost || players[0].coopResult === 'defeat'
    }
    // Ends the running tutorial and starts tutorial id without showing the menu (Retry, Next tutorial).
    // Menu.stopGame keeps every step of Menu.back that ends a game: gameExit, closing an online socket
    // and session (none for a tutorial), clearWaitingMode, hiding the pass-device screen, saveManager.save
    // (returns at once for a tutorial, which is never saved), timer.pauseAndSaveTime (the tutorial's own
    // 'tutorial:' timer keys) and removeEvents. It skips Menu.back's menu steps: menu.visible, menu.start
    // (the menu loop), setTree and updateSlotManagers, which would draw the menu until the new board.
    // The old game loop draws its last frame and stops on the next frame, before the callback below
    // (requested later); the 'Loading…' label is drawn over that frame (TASK-1704: the entry's label, gameEntry, kept
    // over the new board's frames till it is settled), and the new game starts one frame after it, so only one game
    // loop runs. switching is set until start, so the old loop's last frame draws no tutorial 0 hints
    // (drawTutorialHints), whose arrow would otherwise flash once the result screen hides.
    static switchTo(id) {
        TutorialManager.switching = true
        tutorialResultInterface.hide()
        menu.stopGame()
        const entry = {control: null, since: performance.now()}
        gameEntryLast = {since: entry.since}
        requestAnimationFrame(() => {
            gameEntry = entry
            TutorialManager.drawLoading()
            requestAnimationFrame(() => {
                if (gameEntry !== entry)
                    return
                entry.startAt = gameEntryLast.startAt = performance.now()
                TutorialManager.start(id)
                gameEntryStarted(entry)
            })
        })
    }
    // The entry's 'Loading…' label (drawGameEntryLabel: the menu's look) over the last game frame.
    static drawLoading() {
        drawGameEntryLabel(interfaceCtx, gameEntry ?? {control: null, since: performance.now()})
    }
    static retry() {
        TutorialManager.switchTo(gameSettings.tutorial.id)
    }
    // The id of the tutorial after the running one in the list, or null after the last.
    static nextId() {
        const index = tutorials.findIndex(tutorial => tutorial.id === gameSettings.tutorial.id)
        return index >= 0 && index + 1 < tutorials.length ? tutorials[index + 1].id : null
    }
    static next() {
        TutorialManager.switchTo(TutorialManager.nextId())
    }
    // The tutorial list; its enter re-reads the passed ids, so a fresh pass shows its check mark.
    static backToTutorials() {
        tutorialResultInterface.hide()
        menuBack()
        menu.setTree(menu.tutorial)
    }
}

// TASK-1721 (TIP 1/4): THE TUTORIAL TIP'S STATE (the offer overlay is TASK-1722's, the drawing TASK-1723's). A tutorials
// entry's tip (options/tutorials.js) is offered once red has thought tip.delayMs (OFFER_AGAIN_MS when this level's offer
// was shown before: readTutorialTipSeen, options/tutorialProgress.js) on its own turn: the thinking clock (clockMs) runs
// per attempt only on red's turn and stops while the AI plays (whooseTurn !== TUTORIAL_HUMAN_SLOT, gameEvent.waitingMode,
// a turn playback), while the result screen, the pause menu or the menu shows, while document.hidden, and while the
// offer or the tip is up. The offer shows only at the tip's start state: red's first turn of the attempt with no red
// action taken (an Undo back to it counts again). keepThinking() hides it, the next offer due OFFER_AGAIN_MS of thinking
// later; getTip() hides it and makes step 1 active. While a tip is active, a red unit's action from the active step's
// 'from' onto its 'to' (ActionManager.startAction during Unit.sendInstructions: commandBegin / commandEnd) advances to
// the next step and the last one ends the tip; any other red action ends it; an Undo of a followed step goes back to it.
// The game loop calls frame(frameTime); tests stop that (hold = true) and drive the clock with advance(ms).
class TutorialTips {
    static OFFER_AGAIN_MS = 5 * 60 * 1000
    // The longest wall time one frame adds (a stalled or throttled tab does not count as thinking).
    static FRAME_CAP_MS = 1000
    static hold = false
    static memorySeen = new Set()
    static reset(id) {
        const tutorial = tutorials.find(tutorial => tutorial.id === id)
        TutorialTips.id = id
        TutorialTips.tip = tutorial && tutorial.tip || null
        TutorialTips.startRound = tutorial && tutorial.startRound || 0
        TutorialTips.clockMs = 0
        TutorialTips.last = null
        TutorialTips.nextDueMs = TutorialTips.tip ? (TutorialTips.wasSeen(id) ? TutorialTips.OFFER_AGAIN_MS : TutorialTips.tip.delayMs) : Infinity
        TutorialTips.offer = false
        TutorialTips.stepIndex = -1
        TutorialTips.followed = []
        TutorialTips.command = null
        TutorialTips.actions = 0
        TutorialTips.ended = null
    }
    static wasSeen(id) {
        return TutorialTips.memorySeen.has(id) || (typeof readTutorialTipSeen === 'function' && readTutorialTipSeen().includes(id))
    }
    static get running() {
        return typeof gameSettings !== 'undefined' && !!gameSettings.tutorial && !!TutorialTips.tip &&
            gameSettings.tutorial.id === TutorialTips.id
    }
    static get active() {
        return TutorialTips.running && TutorialTips.stepIndex >= 0
    }
    // The active step {from, to} or null.
    static get step() {
        return TutorialTips.active ? TutorialTips.tip.steps[TutorialTips.stepIndex] : null
    }
    static get due() {
        return TutorialTips.running && TutorialTips.clockMs >= TutorialTips.nextDueMs
    }
    // The board is at the tip's start: red's first turn, no red action (actionManager is cleared at every turn start).
    static atStart() {
        return TutorialTips.running && whooseTurn === TUTORIAL_HUMAN_SLOT && gameRound === TutorialTips.startRound &&
            !gameEvent.waitingMode && actionManager.arr.length === 0
    }
    static paused() {
        if (!TutorialTips.running || TutorialTips.offer || TutorialTips.active)
            return true
        if (whooseTurn !== TUTORIAL_HUMAN_SLOT || gameEvent.waitingMode)
            return true
        if (typeof turnPlaybackView !== 'undefined' && turnPlaybackView.active)
            return true
        if ((typeof tutorialResultInterface !== 'undefined' && tutorialResultInterface.visible) ||
                (typeof tutorialPauseInterface !== 'undefined' && tutorialPauseInterface.visible) ||
                (typeof menu !== 'undefined' && menu && menu.visible))
            return true
        return typeof document !== 'undefined' && !!document.hidden
    }
    // Each game loop frame: the wall time since the last frame (at most FRAME_CAP_MS) counts unless paused.
    static frame(now) {
        const last = TutorialTips.last
        TutorialTips.last = now
        if (TutorialTips.hold || last === null || !TutorialTips.running)
            return
        TutorialTips.advance(Math.max(0, Math.min(now - last, TutorialTips.FRAME_CAP_MS)))
    }
    // Adds ms of thinking (none while paused), then makes the offer when it is due at the start state.
    static advance(ms) {
        if (!TutorialTips.paused())
            TutorialTips.clockMs += ms
        TutorialTips.check()
    }
    static check() {
        if (TutorialTips.offer || TutorialTips.active || !TutorialTips.due || !TutorialTips.atStart())
            return false
        TutorialTips.offer = true
        TutorialTips.memorySeen.add(TutorialTips.id)
        if (typeof markTutorialTipSeen === 'function')
            markTutorialTipSeen(TutorialTips.id)
        return true
    }
    static keepThinking() {
        if (!TutorialTips.offer)
            return
        TutorialTips.offer = false
        TutorialTips.nextDueMs = TutorialTips.clockMs + TutorialTips.OFFER_AGAIN_MS
    }
    static getTip() {
        if (!TutorialTips.offer)
            return
        TutorialTips.offer = false
        TutorialTips.nextDueMs = TutorialTips.clockMs + TutorialTips.OFFER_AGAIN_MS
        TutorialTips.stepIndex = 0
        TutorialTips.followed = []
        TutorialTips.ended = null
    }
    static end(reason) {
        TutorialTips.stepIndex = -1
        TutorialTips.followed = []
        TutorialTips.ended = reason
    }
    static isRed(unit) {
        return TutorialTips.running && whooseTurn === TUTORIAL_HUMAN_SLOT && (!unit || unit.playerColor === TUTORIAL_HUMAN_SLOT)
    }
    // Unit.sendInstructions around its interaction: the red unit's command from -> to.
    static commandBegin(unit, from, to) {
        TutorialTips.command = TutorialTips.isRed(unit) ? {from: {x: from.x, y: from.y}, to: {x: to.x, y: to.y}, acted: false} : null
    }
    static commandEnd() {
        const command = TutorialTips.command
        TutorialTips.command = null
        if (command && command.acted)
            TutorialTips.redAction(command)
    }
    // ActionManager.startAction: every recorded action (a unit's inside its command, a town's production on its own).
    static actionStarted() {
        if (TutorialTips.command)
            TutorialTips.command.acted = true
        else if (TutorialTips.isRed(null))
            TutorialTips.redAction(null)
    }
    static redAction(command) {
        ++TutorialTips.actions
        if (TutorialTips.offer) {
            // (the overlay takes the clicks; an action anyway answers it like keepThinking)
            TutorialTips.keepThinking()
            return
        }
        const step = TutorialTips.step
        if (!step)
            return
        if (!command || !coordsEqually(command.from, step.from) || !coordsEqually(command.to, step.to)) {
            TutorialTips.end('other action')
            return
        }
        TutorialTips.followed.push(actionManager.arr.length)
        if (++TutorialTips.stepIndex >= TutorialTips.tip.steps.length)
            TutorialTips.end('done')
    }
    // ActionManager.undo after its pop: an undone followed step is the active one again.
    static undone() {
        const followed = TutorialTips.followed
        if (TutorialTips.active && followed.length && actionManager.arr.length < followed[followed.length - 1]) {
            followed.pop()
            --TutorialTips.stepIndex
        }
    }
    // For tests: {due, offer, step, stepIndex, clockMs, seen, nextDueMs, ...}.
    static get state() {
        const step = TutorialTips.step
        return {id: TutorialTips.id || null, due: TutorialTips.due, offer: TutorialTips.offer,
            step: step && {from: {...step.from}, to: {...step.to}}, stepIndex: TutorialTips.active ? TutorialTips.stepIndex : -1,
            clockMs: TutorialTips.clockMs, nextDueMs: TutorialTips.nextDueMs, seen: TutorialTips.id ? TutorialTips.wasSeen(TutorialTips.id) : false,
            atStart: TutorialTips.tip ? TutorialTips.atStart() : false, paused: TutorialTips.paused(), ended: TutorialTips.ended}
    }
}
TutorialTips.reset(null)
// A hidden tab's frames stop; the first frame after it adds nothing (frame: last null).
if (typeof document !== 'undefined' && document && typeof document.addEventListener === 'function')
    document.addEventListener('visibilitychange', () => { TutorialTips.last = null })
