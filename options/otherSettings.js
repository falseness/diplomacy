class Settings {
    constructor() {
        this.alwaysDisplayHPBar = false
        this.alwaysDisplayMovesBar = false
        this.moveCameraToUndoTarget = true
        this.usePolishedSprites = true
    }
    fromJSON(dict) {
        if (!dict) // no settings in local storage
            return
        this.alwaysDisplayHPBar = dict.alwaysDisplayHPBar
        this.alwaysDisplayMovesBar = dict.alwaysDisplayMovesBar
        this.moveCameraToUndoTarget = dict.moveCameraToUndoTarget
        this.usePolishedSprites = dict.usePolishedSprites !== false
    }
    toJSON() {
        let res =  {
            alwaysDisplayHPBar: this.alwaysDisplayHPBar,
            alwaysDisplayMovesBar: this.alwaysDisplayMovesBar,
            moveCameraToUndoTarget: this.moveCameraToUndoTarget,
            usePolishedSprites: this.usePolishedSprites
        }
        res = {
            alwaysDisplayHPBar: this.alwaysDisplayHPBar,
            alwaysDisplayMovesBar: this.alwaysDisplayMovesBar,
            moveCameraToUndoTarget: this.moveCameraToUndoTarget,
            usePolishedSprites: this.usePolishedSprites
        }
        return res
    }
}
let otherSettings = new Settings()
