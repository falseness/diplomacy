// Canvas text field of the menu, drawn like MenuButton. A click inside focuses it; while
// focused it owns the keyboard: window capture listeners consume every keydown/keyup
// before the document-level game handlers in events/events.js can see them.
// Phones have no hardware keyboard: a click inside also focuses a transparent DOM <input> laid over
// the field, so the soft keyboard opens; its input events and the canvas keys are mirrored both ways.
const MENU_TEXT_INPUT_CHAR = /^[A-Za-z0-9_-]$/

class MenuTextInput {
    constructor(rect, fontSize, {maxLength = 16, onSubmit = () => {}, onCancel = () => {}} = {}) {
        this.rect = rect
        this.text = new Text(rect.centerX, rect.centerY, fontSize, '', 'black')
        this.maxLength = maxLength
        this.onSubmit = onSubmit
        this.onCancel = onCancel
        this.value = ''
        this.focused = false
        this.onKeyDown = event => this.keydown(event)
        this.onKeyUp = event => this.consume(event)
        this.dom = null
    }
    // The DOM input over the field (CSS px), created on the first click inside, removed on blur.
    domInput() {
        if (this.dom) return this.dom
        const input = this.dom = document.createElement('input')
        input.type = 'text'
        input.autocomplete = 'off'
        input.style.cssText = 'position:fixed;opacity:0;font-size:16px;border:0;padding:0;margin:0;z-index:1'
        input.style.left = this.rect.x / devicePixelRatio + 'px'
        input.style.top = this.rect.y / devicePixelRatio + 'px'
        input.style.width = this.rect.width / devicePixelRatio + 'px'
        input.style.height = this.rect.height / devicePixelRatio + 'px'
        input.addEventListener('input', () => {
            this.setValue(input.value)
            input.value = this.value
        })
        input.value = this.value
        document.body.appendChild(input)
        return input
    }
    // Keeps only allowed characters, up to maxLength.
    setValue(value) {
        this.value = [...String(value)].filter(char => MENU_TEXT_INPUT_CHAR.test(char))
            .join('').slice(0, this.maxLength)
    }
    focus() {
        if (this.focused) return
        this.focused = true
        window.addEventListener('keydown', this.onKeyDown, true)
        window.addEventListener('keyup', this.onKeyUp, true)
    }
    blur() {
        if (!this.focused) return
        this.focused = false
        this.dom?.blur()
        this.dom?.remove()
        this.dom = null
        window.removeEventListener('keydown', this.onKeyDown, true)
        window.removeEventListener('keyup', this.onKeyUp, true)
    }
    isInside(pos) {
        return this.rect.isInside(pos)
    }
    click(pos) {
        if (!this.isInside(pos)) return this.blur()
        this.focus()
        this.domInput().focus()
    }
    consume(event) {
        event.preventDefault()
        event.stopImmediatePropagation()
    }
    keydown(event) {
        this.editByKey(event)
        if (this.dom) this.dom.value = this.value
    }
    editByKey(event) {
        this.consume(event)
        const key = event.key
        if (key === 'Enter') return this.onSubmit(this.value)
        if (key === 'Escape') {
            this.blur()
            return this.onCancel()
        }
        if (key === 'Backspace') {
            this.value = this.value.slice(0, -1)
            return
        }
        if (event.ctrlKey || event.metaKey || event.altKey) return
        if (typeof key === 'string' && MENU_TEXT_INPUT_CHAR.test(key) && this.value.length < this.maxLength)
            this.value += key
    }
    draw(ctx) {
        this.rect.draw(ctx)
        this.text.text = this.value
        this.text.draw(ctx)
        if (!this.focused) return
        const x = this.rect.centerX + ctx.measureText(this.value).width / 2 + 0.1 * this.text.fontSize
        const half = 0.5 * this.text.fontSize
        ctx.strokeStyle = 'black'
        ctx.lineWidth = Math.max(1, 0.08 * this.text.fontSize)
        ctx.beginPath()
        ctx.moveTo(x, this.rect.centerY - half)
        ctx.lineTo(x, this.rect.centerY + half)
        ctx.stroke()
    }
}
