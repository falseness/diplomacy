class Settings {
    constructor() {
        this.alwaysDisplayHPBar = false
        this.alwaysDisplayMovesBar = false
        this.moveCameraToUndoTarget = true
        this.usePolishedSprites = true
        this.animateMoves = true
        // The 'replays' menu entry, hidden until the server serves game:replay.
        this.showReplays = false
        // Autoscouting prefetch (artifacts/actions_feature_prd.txt sec. 7.2): online hidden-information games get the
        // contents of every cell one action can reveal at turn start; off -> every reveal waits for its ack. Sent
        // with game:open (OnlineSession.openGame).
        this.autoscout = true
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
        this.autoscout = dict.autoscout !== false
    }
    toJSON() {
        let res =  {
            alwaysDisplayHPBar: this.alwaysDisplayHPBar,
            alwaysDisplayMovesBar: this.alwaysDisplayMovesBar,
            moveCameraToUndoTarget: this.moveCameraToUndoTarget,
            usePolishedSprites: this.usePolishedSprites,
            animateMoves: this.animateMoves,
            showReplays: this.showReplays,
            autoscout: this.autoscout
        }
        res = {
            alwaysDisplayHPBar: this.alwaysDisplayHPBar,
            alwaysDisplayMovesBar: this.alwaysDisplayMovesBar,
            moveCameraToUndoTarget: this.moveCameraToUndoTarget,
            usePolishedSprites: this.usePolishedSprites,
            animateMoves: this.animateMoves,
            showReplays: this.showReplays,
            autoscout: this.autoscout
        }
        return res
    }
}
let otherSettings = new Settings()
