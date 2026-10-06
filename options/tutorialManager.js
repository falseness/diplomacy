// Runs the tutorials of options/tutorials.js: an offline game with fog of war in which
// the human plays red (slot 1) and blue (slot 2) moves automatically. gameSettings.tutorial
// = {id} marks the game; such a game is never saved and shows no pass-device screen.
const TUTORIAL_HUMAN_SLOT = 1
const TUTORIAL_AI_SLOT = 2

class TutorialManager {
    static start(id) {
        const tutorial = tutorials.find(tutorial => tutorial.id === id)
        if (!tutorial)
            throw new Error('Unknown tutorial ' + id)
        tutorialResultInterface.hide()
        const map = tutorial.map
        map.tutorial = {id: id}
        GameManager.start(map, true)
    }
    // Called after every human move and every turn; true once the tutorial is over.
    static checkResult() {
        if (!gameSettings.tutorial)
            return false
        if (tutorialResultInterface.visible)
            return true
        let outcome = null
        if (players[TUTORIAL_AI_SLOT].isLost) {
            markTutorialPassed(gameSettings.tutorial.id)
            outcome = 'victory'
        }
        else if (players[TUTORIAL_HUMAN_SLOT].isLost) {
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
    // The old game loop stops on the next frame (gameExit); the new game starts after it.
    static retry() {
        const id = gameSettings.tutorial.id
        tutorialResultInterface.hide()
        menuBack()
        requestAnimationFrame(() => TutorialManager.start(id))
    }
    // The tutorial menu comes later; until then the main menu.
    static backToTutorials() {
        tutorialResultInterface.hide()
        menuBack()
    }
}
