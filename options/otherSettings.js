class Settings {
    constructor() {
        this.alwaysDisplayHPBar = false
        this.alwaysDisplayMovesBar = false
        this.moveCameraToUndoTarget = true
        this.usePolishedSprites = true
        this.animateMoves = true
    }
    fromJSON(dict) {
        if (!dict) // no settings in local storage
            return
        this.alwaysDisplayHPBar = dict.alwaysDisplayHPBar
        this.alwaysDisplayMovesBar = dict.alwaysDisplayMovesBar
        this.moveCameraToUndoTarget = dict.moveCameraToUndoTarget
        this.usePolishedSprites = dict.usePolishedSprites !== false
        this.animateMoves = dict.animateMoves !== false
    }
    toJSON() {
        let res =  {
            alwaysDisplayHPBar: this.alwaysDisplayHPBar,
            alwaysDisplayMovesBar: this.alwaysDisplayMovesBar,
            moveCameraToUndoTarget: this.moveCameraToUndoTarget,
            usePolishedSprites: this.usePolishedSprites,
            animateMoves: this.animateMoves
        }
        res = {
            alwaysDisplayHPBar: this.alwaysDisplayHPBar,
            alwaysDisplayMovesBar: this.alwaysDisplayMovesBar,
            moveCameraToUndoTarget: this.moveCameraToUndoTarget,
            usePolishedSprites: this.usePolishedSprites,
            animateMoves: this.animateMoves
        }
        return res
    }
}
let otherSettings = new Settings()
