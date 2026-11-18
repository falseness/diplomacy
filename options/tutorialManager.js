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
    // board whose first frames made its map-edge rock sprites and its surface cache's cell mask (the click freeze of
    // artifacts/TASK-1614/causes.md, problem 2). While a won tutorial's result screen shows, the next tutorial's rock sprites
    // are asked of the rock workers (MapDepth.rockKeysOf its stand-in board, Grid.prebuildBoardOf: off the main thread) and
    // its cell mask is built a step a frame (Grid.prebuildCellMaskSteps, PREBUILD_STEP_MS each, in an animation frame
    // callback: timers starved behind the busy result screen's frames, 7 steps in 3.3 s on the tutorial replay; the same
    // builders and keys as the board's own, so the board finds them kept or, its mask not finished, goes on with the same
    // build: cellMaskJob). Stops when the result screen hides but for Next tutorial's switch (TutorialManager.switching,
    // until the new board starts: then its own steps take over the build).
    static PREBUILD_STEP_MS = 24
    static prebuilds = 0
    // The last prebuild: {id, rocks: sprites asked, steps, ms: its mask steps' time, done: the mask finished by it}.
    static prebuildLog = null
    static prebuildNext(id) {
        const tutorial = id && tutorials.find(tutorial => tutorial.id === id)
        if (!tutorial || typeof otherSettings === 'undefined' || !otherSettings.atmosphericVisuals ||
                typeof Grid === 'undefined' || typeof MapDepth === 'undefined')
            return
        const map = tutorial.map
        ++TutorialManager.prebuilds
        const rocks = MapDepth.rockKeysOf(Grid.prebuildBoardOf(map))
        MapDepth.requestRockSprites(rocks)
        const log = TutorialManager.prebuildLog = {id, rocks: rocks.length, calls: 0, steps: 0, ms: 0, done: false, at: performance.now(), doneAt: null}
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
    // (requested later); the 'Loading…' frame is shown, and the new game starts one frame after it, so
    // only one game loop runs. switching is set until start, so the old loop's last frame draws no
    // tutorial 0 hints (drawTutorialHints), whose arrow would otherwise flash once the result screen hides.
    static switchTo(id) {
        TutorialManager.switching = true
        tutorialResultInterface.hide()
        menu.stopGame()
        requestAnimationFrame(() => {
            TutorialManager.drawLoading()
            requestAnimationFrame(() => TutorialManager.start(id))
        })
    }
    // A small centred 'Loading…' label over the last game frame.
    static drawLoading() {
        const ctx = interfaceCtx
        const fontSize = Math.max(16 * window.devicePixelRatio, Math.min(WIDTH, HEIGHT) / 30)
        ctx.save()
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        ctx.font = fontSize + 'px Arial'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        const text = 'Loading…'
        const w = ctx.measureText(text).width + fontSize * 1.5, h = fontSize * 2
        ctx.fillStyle = 'rgba(0, 0, 0, 0.65)'
        ctx.fillRect(WIDTH / 2 - w / 2, HEIGHT / 2 - h / 2, w, h)
        ctx.fillStyle = 'white'
        ctx.fillText(text, WIDTH / 2, HEIGHT / 2)
        ctx.restore()
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
