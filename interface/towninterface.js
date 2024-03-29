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
        this.visible = true
    }
    draw(ctx) {
        super.draw(ctx)
        if (this.visible)
            this.switch.draw(ctx)
    }
}