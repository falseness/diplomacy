// Runs the tutorials of options/tutorials.js: an offline game with fog of war in which
// the human plays red (slot 1) and blue (slot 2) moves automatically. gameSettings.tutorial
// = {id} marks the game; such a game is never saved and shows no pass-device screen.
const TUTORIAL_HUMAN_SLOT = 1
const TUTORIAL_AI_SLOT = 2
// The normal sudden death round; a tutorials entry may set its own suddenDeathRound.
const TUTORIAL_SUDDEN_DEATH_ROUND = 40

class TutorialManager {
    static start(id) {
        const tutorial = tutorials.find(tutorial => tutorial.id === id)
        if (!tutorial)
            throw new Error('Unknown tutorial ' + id)
        tutorialResultInterface.hide()
        const map = tutorial.map
        map.tutorial = {id: id}
        // 'surviveRounds' counts red's units only when the map gives red no town.
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
        return true
    }
    // The pass rule of the running tutorial (tutorials entry `pass`), see options/tutorials.js.
    static isPassed() {
        const tutorial = tutorials.find(tutorial => tutorial.id === gameSettings.tutorial.id)
        const human = players[TUTORIAL_HUMAN_SLOT], enemy = players[TUTORIAL_AI_SLOT]
        switch (tutorial ? tutorial.pass : 'enemyUnitsDead') {
            case 'enemyUnitsDead':
                enemy.updateUnits()
                return enemy.units.length === 0
            case 'enemyLost':
                return enemy.isLost
            case 'coopVictory':
                human.updateTowns()
                return players[0].coopResult === 'victory' && human.towns.length > 0
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
    // only one game loop runs.
    static switchTo(id) {
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
