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
        // Heal animations (render/healFx.js).
        this.animateHeals = true
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
        this.animateHeals = dict.animateHeals !== false
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
            animateHeals: this.animateHeals,
            replayOthers: this.replayOthers,
            showReplays: this.showReplays,
            autoscout: this.autoscout,
            settingsVersion: Settings.VERSION
        }
    }
}
Settings.VERSION = 1
let otherSettings = new Settings()

// TASK-1523: the Settings menu's 'Animations' and "Replay others' moves" rows (menu.js OtherSettingsTree) and the
// tutorial-20 background panel's rows (render/draw.js backgroundHintClick) share this rule.
// 'Animations' is the move slide, the attack effects and the heal effects, all three on (an old save with one of them off
// shows unchecked).
function animationsSettingOn() {
    return !!(otherSettings.animateMoves && otherSettings.animateAttacks && otherSettings.animateHeals)
}
// Applies the two rows' marks: Animations sets all three flags (off ends running animations at once); Replay is ignored
// (greyed, not clickable) while Animations is off. A running playback of AI turns that the rows no longer allow jumps to
// the computed board; the settings are saved. Returns whether a setting changed.
function applyAnimationSettings(animations, replay) {
    animations = !!animations
    replay = !!replay
    let changed = false
    if (animations !== animationsSettingOn()) {
        otherSettings.animateMoves = otherSettings.animateAttacks = otherSettings.animateHeals = animations
        changed = true
        if (!animations) {
            if (typeof moveTween !== 'undefined')
                moveTween.clear()
            if (typeof attackFx !== 'undefined')
                attackFx.clear()
            if (typeof healFx !== 'undefined')
                healFx.clear()
        }
    }
    if (animations && replay !== otherSettings.replayOthers) {
        otherSettings.replayOthers = replay
        changed = true
    }
    // TASK-1496: either row off ends a running playback of AI turns at once (the computed board).
    if (typeof turnPlaybackView !== 'undefined')
        turnPlaybackView.settingsChanged()
    if (typeof saveOtherSettings === 'function')
        saveOtherSettings()
    return changed
}
