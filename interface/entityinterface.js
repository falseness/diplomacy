class EntityInterface {
    constructor() {

        this.visible = false

        let stroke = 0.002 * width
        let cornerRadius = 0.03 * width
        let indent = this.stroke + this.cornerRadius

        this.pos = {
            x: -canvasOffset.x,
            y: 0.65 * height - canvasOffset.y
        }
        this.height = height - this.pos.y - canvasOffset.y
        this.width = this.height * 1.5

        this.background = new Rect(this.pos.x, this.pos.y, this.width, this.height, [0, cornerRadius, 0, 0], stroke)

        this.img = new JustImage('', { x: this.pos.x + this.height * 0.33, y: this.pos.y + this.height * 0.5 },
            this.height * 0.775, this.height * 0.775)


        this.entity = {}

        this.entity.name = new Text(
            this.img.getX() + this.img.getWidth() / 2,
            this.pos.y + this.height * 0.075,
            this.height * 0.2
        )

        this.entity.name.setTextBaseline('top')
        this.entity.name.setTextAlign('left')

        this.entity.info = new Text(
            this.entity.name.getX(),
            this.entity.name.getY() + this.entity.name.getHeight(),
            this.height * 0.1
        )

        this.entity.info.setTextBaseline('top')
        this.entity.info.setTextAlign('left')

        this.updateSizes()
    }
    updateSizes() {
        this.width = Math.max(this.entity.info.getX() + this.entity.info.getWidth(),
                this.entity.name.getX() + this.entity.name.getWidth()) +
            canvasOffset.x + 0.04 * this.height

        this.background.setWidth(this.width)
    }
    updatePos() {
        this.pos = {
            x: -canvasOffset.x,
            y: 0.65 * height - canvasOffset.y
        }
        this.background.setPos(this.pos)
        this.img.setPos({ x: this.pos.x + this.height * 0.33, y: this.pos.y + this.height * 0.5 })

        this.entity.name.setPos({
            x: this.img.getX() + this.img.getWidth() / 2,
            y: this.pos.y + this.height * 0.075
        })

        this.entity.info.setPos({
            x: this.entity.name.getX(),
            y: this.entity.name.getY() + this.entity.name.getHeight()
        })
    }
    change(entity, color) {
        this.background.setColor(color.hex)

        this.img.setImage(entity.name)
        this.entity.name.setText(entity.name)
        this.entity.info.setText(join(entity.info, ': ', '\n'))

        this.updateSizes()

        this.setVisible(true)
    }
    setVisible(boolean) {
        this.visible = boolean
    }
    isInside(pos) {
        return this.background.isInside(pos)
    }
    click(pos) {
        return this.visible && this.isInside(pos)
    }
    draw() {
        if (!this.visible)
            return
        this.background.draw()
        this.img.draw()

        this.entity.name.draw()
        this.entity.info.draw()
    }
}