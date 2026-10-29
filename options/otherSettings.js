class Settings {
    constructor() {
        this.alwaysDisplayHPBar = true
        this.alwaysDisplayMovesBar = true
        this.moveCameraToUndoTarget = true
        this.usePolishedSprites = true
        this.atmosphericVisuals = true
        this.animateMoves = true
        // Attack animations (render/attackFx.js).
        this.animateAttacks = true
        // The camera replay of others' attacks (render/attackFx.js, TASK-1428); off -> they play in place, the camera
        // stays. Ignored while the animations are off.
        this.replayOthers = true
        // The 'replays' menu entry, hidden until the server serves game:replay.
        this.showReplays = false
        // Autoscouting prefetch (artifacts/actions_feature_prd.txt sec. 7.2): online hidden-information games get the
        // contents of every cell one action can reveal at turn start; off -> every reveal waits for its ack. Sent
        // with game:open (OnlineSession.openGame).
        this.autoscout = true
    }
    // Returns true when the stored dict was migrated (and should be saved once).
    fromJSON(dict) {
        if (!dict) // no settings in local storage
            return false
        // Version 1 turned both bars on for everyone once; a later uncheck is kept.
        const migrate = !(dict.settingsVersion >= Settings.VERSION)
        this.alwaysDisplayHPBar = migrate || dict.alwaysDisplayHPBar !== false
        this.alwaysDisplayMovesBar = migrate || dict.alwaysDisplayMovesBar !== false
        this.moveCameraToUndoTarget = dict.moveCameraToUndoTarget
        this.usePolishedSprites = dict.usePolishedSprites !== false
        this.atmosphericVisuals = dict.atmosphericVisuals !== false
        this.animateMoves = dict.animateMoves !== false
        this.animateAttacks = dict.animateAttacks !== false
        this.replayOthers = dict.replayOthers !== false
        this.showReplays = dict.showReplays === true
        this.autoscout = dict.autoscout !== false
        return migrate
    }
    toJSON() {
        return {
            alwaysDisplayHPBar: this.alwaysDisplayHPBar,
            alwaysDisplayMovesBar: this.alwaysDisplayMovesBar,
            moveCameraToUndoTarget: this.moveCameraToUndoTarget,
            usePolishedSprites: this.usePolishedSprites,
            atmosphericVisuals: this.atmosphericVisuals,
            animateMoves: this.animateMoves,
            animateAttacks: this.animateAttacks,
            replayOthers: this.replayOthers,
            showReplays: this.showReplays,
            autoscout: this.autoscout,
            settingsVersion: Settings.VERSION
        }
    }
}
Settings.VERSION = 1
let otherSettings = new Settings()
