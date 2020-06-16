class Settings {
    constructor() {
        this.alwaysDisplayHPBar = false
        this.alwaysDisplayMovesBar = false
        this.moveCameraToUndoTarget = true
    }
    fromJSON(dict) {
        if (!dict) // no settings in local storage
            return
        this.alwaysDisplayHPBar = dict.alwaysDisplayHPBar
        this.alwaysDisplayMovesBar = dict.alwaysDisplayMovesBar
        this.moveCameraToUndoTarget = dict.moveCameraToUndoTarget
    }
    toJSON() {
        let res =  {
            alwaysDisplayHPBar: this.alwaysDisplayHPBar,
            alwaysDisplayMovesBar: this.alwaysDisplayMovesBar,
            moveCameraToUndoTarget: this.moveCameraToUndoTarget
        }
        res = {
            alwaysDisplayHPBar: this.alwaysDisplayHPBar,
            alwaysDisplayMovesBar: this.alwaysDisplayMovesBar,
            moveCameraToUndoTarget: this.moveCameraToUndoTarget
        }
        return res
    }
}
let otherSettings = new Settings()