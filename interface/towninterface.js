function toggleTownTrainInterfaceTab() {
    townInterface.toggleTrainInterfaceTab()
}
class TownInterface extends BarrackInterface {
    constructor() {
        super()
        /*text: 'train',
                        color: '#747474',
                        fontSize: 0.04 * WIDTH * 1.15 * 
                            heightWidthBestRatio
                    },
                    rect: {
                        color: '#f7f7f7',
                        cornerRadius: 0.03 * HEIGHT,
                        borderColor: 'black',
                        stroke: 0.003 * HEIGHT,
                        width: 0.18 * WIDTH * 1.15 * heightWidthBestRatio,
                        height: 0.07 * HEIGHT
                        */
        /*constructor(x, y, w, h, cornerRadius, strokeWidth, color, 
                 textOne, textTwo, clickFunc, parameters, canClick = true)*/
    }
    getTrainInterfaceY(index) {
        let y = super.getTrainInterfaceY(index)
        return y + this.switch.getHeight()
    }
    toggleTrainInterfaceTab() {
        this.switch.toggleSelect()
        this.trainInterfacesTab = this.switch.getSelectedText()
        
        let selected = gameEvent.getSelected()
        selected.removeSelect()
        selected.select()
    }
    isTypeValid(type) {
        return true
    }
    click(point) {
        let isClicked = super.click(point)
        
        if (isClicked) {
            this.switch.click(point)
        }
        
        return isClicked
    }
    makeTrainInterfaces() {
        this.switch = new Switch(this.gold.getX(), this.gold.getY() + HEIGHT * 0.05,
            WIDTH * 0.115 * 2, WIDTH * 0.05, 0.04 * HEIGHT, 0.003 * HEIGHT, '#f7f7f7',
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
            this.trainInterfaces[type][i].setButtonText('train (' + townProduction[i].turns + ')')
        }
        if (!canTrainNew) {
            this.trainInterfaces[type][town.activeProduction].setCanTrain(true)
            this.trainInterfaces[type][town.activeProduction].setButtonText('choose')
        }
        
        this.clearTab('unit')
    }
    change(town, color) {
        this.background.setColor(color.hex)
        
        if (this.trainInterfacesTab == 'unit') {
            this.changeUnitTab(town)
        }
        else {
            this.changeBuildingTab(town)
        }
        this.switch.setSelectedColor(color.hex)
        
        this.goldText.setText(town.info.gold)
        this.setVisible(true)
    }
    draw(ctx) {
        super.draw(ctx)
        if (this.visible)
            this.switch.draw(ctx)
    }
}