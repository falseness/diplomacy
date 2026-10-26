function toggleTownTrainInterfaceTab() {
    townInterface.toggleTrainInterfaceTab()
}
class TownInterface extends BarrackInterface {
    constructor() {
        super()
    }
    getTrainInterfaceY(index) {
        let y = super.getTrainInterfaceY(index)
        return y + this.switch.height
    }
    toggleTrainInterfaceTab() {
        this.switch.toggleSelect()
        this.trainInterfacesTab = this.switch.getSelectedText()
        this.invalidateRenderCache()
        
        let selected = gameEvent.selected
        selected.removeSelect()
        selected.select()
    }
    isTypeValid(type) {
        return true
    }
    wasClickOnButton(point) {
        if (this.switch.click(point)) {
            return true
        }
        if (super.wasClickOnButton(point)) {
            return true
        }
        gameEvent.selected.removeSelect()
        gameEvent.selected.select()
        return false
    }
    makeTrainInterfaces() {
        this.switch = new Switch(this.gold.x, this.gold.y + HEIGHT * 0.05,
            WIDTH * 0.115 * 2 / 1.075, WIDTH * 0.05, 0.04 * HEIGHT, 0.0015 * HEIGHT, '#f7f7f7',
                new Text(0, 0, WIDTH * 0.025, 'unit', '#747474'),
                new Text(0, 0, WIDTH * 0.025, 'building', '#747474'),
            toggleTownTrainInterfaceTab)
        
        let trainInterfaces = this.getTrainInterfaceInfo()
        
        this.trainInterfacesTab = 'unit'
        
        this.trainInterfaces = {
            building: {},
            unit: {}
        }
        
        let index = {
            unit: 0,
            building: 0
        }
        
        this.trainInterfacesCreationLoop(trainInterfaces, index)
    }
    clearTab(clearType) {
        for (let i in this.trainInterfaces[clearType]) {
            this.trainInterfaces[clearType][i].setCanTrain(false)
        }
    }
    changeUnitTab(town) {
        super.changeUnitTab(town)
        
        this.clearTab('building')
    }
    changeBuildingTab(town) {
        const type = 'building'
        
        let canTrainNew = !town.activeProduction
    
        for (let i in this.trainInterfaces[type]) {
            this.trainInterfaces[type][i].setCanTrain(canTrainNew)
            this.trainInterfaces[type][i].setButtonText('train (' + production[i].turns + ')')
        }
        if (!canTrainNew) {
            this.trainInterfaces[type][town.activeProduction].setCanTrain(true)
            this.trainInterfaces[type][town.activeProduction].setButtonText('choose')
        }
        
        this.clearTab('unit')
    }
    change(town, color) {
        this.background.color = color.hex
        this.setPanelColors(color.hex)
        
        if (this.trainInterfacesTab == 'unit') {
            if (town.isBadlyDamaged) {
                this.clearTab('unit')
                this.changeTrainingUnitButton(town)
            }
            else {
                this.changeUnitTab(town)
            }
        }
        else {
            if (town.isBadlyDamaged) {
                this.clearTab('building')
            }
            else {
                this.changeBuildingTab(town)
            }
        }
        this.switch.setSelectedColor(color.hex)
        
        this.goldText.text = town.info.gold
        this.invalidateRenderCache()
        this.visible = true
    }
    // The Switch: the active half washed with a gold edge, both original texts in ink (the other one faded).
    drawContents(ctx) {
        super.drawContents(ctx)
        const halves = [[this.switch.buttonOne, this.switch.selected == 1], [this.switch.buttonTwo, this.switch.selected == 2]]
        for (const [half, active] of halves) {
            const rect = half.rect
            if (active) {
                roundedRectPath(ctx, rect.x, rect.y, rect.width, rect.height, rect.height * 0.2)
                ctx.fillStyle = this.panelColors.wash
                ctx.fill()
                ctx.strokeStyle = TRAIN_PANEL_GOLD
                ctx.lineWidth = Math.max(1, 0.0025 * HEIGHT)
                ctx.stroke()
            }
            drawTrainPanelText(ctx, half.textString, rect.x + rect.width / 2, rect.y + rect.height / 2,
                half.text.fontSize * 0.85, rect.width * 0.88, active ? ENTITY_PANEL_INK : 'rgba(74,46,20,0.55)', 'center')
        }
    }
}
