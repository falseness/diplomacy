class EntityInterface {
    #visible = false
    constructor() {

        let stroke = 0.002 * WIDTH
        let cornerRadius = 0.03 * WIDTH
        let indent = this.stroke + this.cornerRadius

        this.pos = {
            x: 0,
            y: 0.55 * HEIGHT//0.55 * HEIGHT
        }
        this.height = HEIGHT - this.pos.y
        this.width = this.height * 1.7

        this.background = new Rect(this.pos.x, this.pos.y, this.width, this.height, 
            [0, cornerRadius, 0, 0], stroke)

        this.img = new JustImage('', { x: this.pos.x + this.height * 0.38, y: this.pos.y + this.height * 0.5 },
            this.height * 0.775, this.height * 0.775)


        this.entity = {}

        this.entity.name = new Text(
            this.img.x + this.img.width / 2,
            this.pos.y + this.height * 0.075,
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

        this.updateSizes()
    }
    get top() {
        return this.pos.y
    }
    updateSizes() {
        this.width = Math.max(this.entity.info.x + this.entity.info.width,
            this.entity.name.x + this.entity.name.width) + 0.04 * this.height

        this.background.width = this.width
    }
    change(entity, color) {
        this.background.color = color.hex

        this.img.image = entity.name
        this.entity.name.text = entity.name
        this.entity.info.text = join(entity.info, ': ', '\n')

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
        return this.visible && this.isInside(pos)
    }
    draw(ctx) {
        if (!this.visible)
            return
        this.background.draw(ctx)
        this.img.draw(ctx)

        this.entity.name.draw(ctx)
        this.entity.info.draw(ctx)
    }
}