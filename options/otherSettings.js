class Settings {
    constructor() {
        this.alwaysDisplayHPBar = false
        this.alwaysDisplayMovesBar = false
        this.moveCameraToUndoTarget = true
        this.usePolishedSprites = true
        this.animateMoves = true
        // The 'replays' menu entry, hidden until the server serves game:replay.
        this.showReplays = false
    }
    fromJSON(dict) {
        if (!dict) // no settings in local storage
            return
        this.alwaysDisplayHPBar = dict.alwaysDisplayHPBar
        this.alwaysDisplayMovesBar = dict.alwaysDisplayMovesBar
        this.moveCameraToUndoTarget = dict.moveCameraToUndoTarget
        this.usePolishedSprites = dict.usePolishedSprites !== false
        this.animateMoves = dict.animateMoves !== false
        this.showReplays = dict.showReplays === true
    }
    toJSON() {
        let res =  {
            alwaysDisplayHPBar: this.alwaysDisplayHPBar,
            alwaysDisplayMovesBar: this.alwaysDisplayMovesBar,
            moveCameraToUndoTarget: this.moveCameraToUndoTarget,
            usePolishedSprites: this.usePolishedSprites,
            animateMoves: this.animateMoves,
            showReplays: this.showReplays
        }
        res = {
            alwaysDisplayHPBar: this.alwaysDisplayHPBar,
            alwaysDisplayMovesBar: this.alwaysDisplayMovesBar,
            moveCameraToUndoTarget: this.moveCameraToUndoTarget,
            usePolishedSprites: this.usePolishedSprites,
            animateMoves: this.animateMoves,
            showReplays: this.showReplays
        }
        return res
    }
}
let otherSettings = new Settings()
