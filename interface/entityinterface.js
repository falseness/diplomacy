function destroySelected() {
    let type = 'destroyBuilding'
    if (gameEvent.selected.isTown()) 
        type = 'destroyTown'
    if (gameEvent.selected.isExternalProduction()) 
        type = 'destroyExternalProduction'
    else if (gameEvent.selected.isBuildingProduction())
        type = 'destroyBuildingProduction'
    
    undoManager.startUndo(type)
    undoManager.lastUndo.building = gameEvent.selected.toUndoJSON() 



    gameEvent.selected.destroy()
    gameEvent.removeSelection()
}
class EntityInterface {
    #visible = false
    constructor() {

        let stroke = 0.001 * WIDTH
        let cornerRadius = 0.03 * WIDTH
        let indent = this.stroke + this.cornerRadius

        this.pos = {
            x: 0,
            y: 0.5 * HEIGHT//0.55 * HEIGHT
        }
        this.height = HEIGHT - this.pos.y
        this.width = this.height * 1.7

        this.background = new Rect(this.pos.x, this.pos.y, this.width, this.height, 
            [0, cornerRadius, 0, 0], stroke)

        this.img = new JustImage('', { x: this.pos.x + this.height * 0.38, y: this.pos.y + this.height * 0.5 },
            this.height * 0.775, this.height * 0.775)
        this.suburbImage = new SuburbImage(
            { x: this.pos.x + this.height * 0.38, y: this.pos.y + this.height * 0.5 },
            this.height * 0.275, this.height * 0.02)


        this.entity = {}

        this.entity.name = new Text(
            this.img.x + this.img.width / 2,
            this.pos.y + this.height * 0.02,
            this.height * 0.2
        )

        this.entity.name.textBaseline = 'top'
        this.entity.name.textAlign = 'left'

        this.entity.info = new Text(
            this.entity.name.x,
            this.entity.name.y + this.entity.name.height,
            this.height * 0.1
        )

        this.entity.info.textBaseline = 'top'
        this.entity.info.textAlign = 'left'
        let button = {
            text: {
                text: 'destroy',
                color: '#747474',
                fontSize: this.height * 0.1
            },
            rect: {
                color: '#f7f7f7',
                cornerRadius: 0.02 * HEIGHT,
                borderColor: 'black',
                stroke: 0.0015 * HEIGHT,
                width: 0.11 * WIDTH,
                height: 0.05 * HEIGHT
            }
        }
        this.destroyButton = new Button(
            new Rect(this.entity.name.x, HEIGHT - this.height * 0.075 - button.rect.height, 
                button.rect.width, button.rect.height, 
                [button.rect.cornerRadius, button.rect.cornerRadius, 
                button.rect.cornerRadius, button.rect.cornerRadius],
                button.rect.stroke, button.rect.color),
            new Text(0, 0, button.text.fontSize, button.text.text, button.text.color),
            destroySelected
        )
        this.destroyButton.trimText()
        this.updateSizes()
    }
    get top() {
        return this.pos.y
    }
    updateSizes() {
        this.width = Math.max(
            this.entity.info.x + this.entity.info.width,
            this.entity.name.x + this.entity.name.width,
            this.destroyButton.rect.right) + 0.04 * this.height

        this.background.width = this.width
        
    }
    change(entity, color) {
        this.background.color = color.hex

        this.img.image = entity.name
        this.entity.name.text = entity.name
        if (entity.isDescriptionInfo) 
            this.entity.info.text = entity.info
        else
            this.entity.info.text = join(entity.info, ': ', '\n')
        
        this.destroyButton.canClick = entity.isDestroyable
        this.updateSizes()

        this.visible = true
    }
    set visible(boolean) {
        this.#visible = boolean
        undoButton.selected = boolean
    }
    get visible() {
        return this.#visible
    }
    isInside(pos) {
        return this.background.isInside(pos)
    }
    click(pos) {
        if (!this.visible)
            return false
        
        this.destroyButton.click(pos)
        return this.isInside(pos)
    }
    draw(ctx) {
        if (!this.visible)
            return
        this.background.draw(ctx)
        if (this.img.image == 'suburb') {
            this.suburbImage.draw(ctx)
        }
        else {
            this.img.draw(ctx)
        }
        this.entity.name.draw(ctx)
        this.entity.info.draw(ctx)

        this.destroyButton.draw(ctx)
    }
}