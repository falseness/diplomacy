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
    // The old game loop stops on the next frame (gameExit); the new game starts after it.
    static retry() {
        const id = gameSettings.tutorial.id
        tutorialResultInterface.hide()
        menuBack()
        requestAnimationFrame(() => TutorialManager.start(id))
    }
    // The tutorial list; its enter re-reads the passed ids, so a fresh pass shows its check mark.
    static backToTutorials() {
        tutorialResultInterface.hide()
        menuBack()
        menu.setTree(menu.tutorial)
    }
}
