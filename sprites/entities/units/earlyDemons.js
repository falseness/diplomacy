// Demons move with the standard path finder, but attack only adjacent cells.
class DemonMeleeInteraction extends InterationWithUnit {
    outsideMeleeReach(cell, unit) {
        return (this.cellHasEnemyUnit(cell, unit) || this.cellHasEnemyBuilding(cell, unit)) &&
            !unit.neighbours.some(coord => coordsEqually(coord, cell.coord))
    }
    getAvailableMoveCommandDestinations(unit) {
        return super.getAvailableMoveCommandDestinations(unit)
            .filter(coord => !this.outsideMeleeReach(grid.getCell(coord), unit))
    }
    getAvailableCommandDestinations(unit) {
        return this.getAvailableMoveCommandDestinations(unit)
    }
    canHitSomethingOnCell(cell, unit) {
        this.getAvailableCommandDestinations(unit)
        return !this.outsideMeleeReach(cell, unit) && super.canHitSomethingOnCell(cell, unit)
    }
    sendInstructions(cell, unit) {
        // Recompute legality so direct commands cannot use a stale selection.
        const legal = this.getAvailableCommandDestinations(unit)
            .some(coord => coordsEqually(coord, cell.coord))
        if (!legal) return true
        return super.sendInstructions(cell, unit)
    }
}

class EarlyMeleeDemon extends Unit {
    static get maxHP() { return DEMON_TYPES[this.type].health }
    static get dmg() { return DEMON_TYPES[this.type].damage }
    static get speed() { return DEMON_TYPES[this.type].movement }
    static healSpeed = 0
    static salary = 0
    constructor(x, y, name) {
        const slot = gameSettings.coop && gameSettings.coop.demonSlot
        if (!Number.isInteger(slot) || !players[slot] || players[slot].role !== 'DEMONS')
            throw new Error('demon unit requires demon ownership')
        super(x, y, name)
        Object.defineProperty(this, 'ownerSlot', {value: slot})
        this.interaction = new DemonMeleeInteraction(this.speed)
    }
    // Unit registers ownership during super(), before ownerSlot is assigned.
    get playerColor() { return this.ownerSlot === undefined ? gameSettings.coop.demonSlot : this.ownerSlot }
    get info() {
        const result = super.info
        if (EarlyMeleeDemon.visualTypes.includes(this.name)) {
            result.displayName = DEMON_TYPES[this.name].name
            result.info.owner = 'DEMONS'
        }
        return result
    }
    static visualTypes = ['imp', 'clawling', 'hound', 'brute', 'bulwark']
    // Normalized silhouettes are shared by map units and selection portraits.
    static drawSymbol(ctx, type, x, y, size) {
        ctx.save()
        ctx.translate(x, y)
        ctx.scale(size, size)
        ctx.fillStyle = '#40134f'
        ctx.strokeStyle = '#f4d8ff'
        ctx.lineWidth = 0.025
        const polygon = points => {
            ctx.beginPath()
            points.forEach(([px, py], i) => i ? ctx.lineTo(px, py) : ctx.moveTo(px, py))
            ctx.closePath()
            ctx.fill()
            ctx.stroke()
        }
        if (type === 'imp') { // Small horned head, triangular body and pointed tail.
            polygon([[-.23,-.33],[-.06,-.23],[.06,-.23],[.23,-.33],[.17,-.04],
                [.09,.03],[.21,.28],[-.21,.28],[-.09,.03],[-.17,-.04]])
            polygon([[.17,.21],[.33,.1],[.28,.02],[.4,.08],[.33,.27],[.2,.29]])
        } else if (type === 'clawling') { // Six splayed limbs and paired oversized claws.
            polygon([[-.12,-.19],[-.31,-.37],[-.39,-.18],[-.25,-.08],[-.1,.01],
                [-.37,.08],[-.39,.17],[-.12,.11],[-.31,.29],[-.24,.34],[0,.18],
                [.24,.34],[.31,.29],[.12,.11],[.39,.17],[.37,.08],[.1,.01],
                [.25,-.08],[.39,-.18],[.31,-.37],[.12,-.19]])
        } else if (type === 'hound') { // Long quadruped profile, muzzle, ears and four legs.
            polygon([[-.35,-.06],[-.43,-.24],[-.27,-.15],[.13,-.15],[.18,-.34],
                [.27,-.23],[.35,-.32],[.36,-.13],[.44,-.06],[.4,.04],[.25,.05],
                [.3,.27],[.19,.27],[.13,.08],[-.12,.08],[-.1,.27],[-.21,.27],
                [-.26,.1],[-.31,.27],[-.4,.27]])
        } else if (type === 'brute') { // Broad shoulders, square fists and compact head.
            polygon([[-.12,-.34],[.12,-.34],[.15,-.19],[.32,-.16],[.4,.18],
                [.23,.21],[.19,.01],[.16,.33],[.02,.33],[0,.17],[-.02,.33],
                [-.16,.33],[-.19,.01],[-.23,.21],[-.4,.18],[-.32,-.16],[-.15,-.19]])
        } else if (type === 'bulwark') { // Tower shield, peaked helmet and central metal brace.
            polygon([[-.14,-.24],[0,-.4],[.14,-.24]])
            polygon([[-.33,-.2],[.33,-.2],[.3,.19],[0,.39],[-.3,.19]])
            ctx.strokeStyle = '#ffcb68'
            ctx.lineWidth = .055
            ctx.beginPath()
            ctx.moveTo(0,-.17); ctx.lineTo(0,.27)
            ctx.moveTo(-.24,-.02); ctx.lineTo(.24,-.02)
            ctx.stroke()
        }
        ctx.restore()
    }
    drawBody(ctx) {
        const x = this.pos.x + assets.size / 2
        const y = this.pos.y + assets.size / 2
        if (EarlyMeleeDemon.visualTypes.includes(this.name)) {
            EarlyMeleeDemon.drawSymbol(ctx, this.name, x, y - assets.size * .06, assets.size * .85)
            ctx.save()
            ctx.font = `bold ${assets.size * .14}px sans-serif`
            ctx.textAlign = 'center'
            ctx.textBaseline = 'middle'
            const label = DEMON_TYPES[this.name].name
            const width = ctx.measureText(label).width + assets.size * .06
            ctx.fillStyle = '#210d31'
            ctx.fillRect(x - width / 2, y + assets.size * .29, width, assets.size * .18)
            ctx.fillStyle = '#ffffff'
            ctx.fillText(label, x, y + assets.size * .38)
            ctx.restore()
        } else {
            ctx.save()
            ctx.fillStyle = this.player.fullColor.hex
            ctx.beginPath()
            ctx.arc(x, y, assets.size * .25, 0, Math.PI * 2)
            ctx.fill()
            ctx.fillStyle = '#ffffff'
            ctx.textAlign = 'center'
            ctx.fillText(DEMON_TYPES[this.name].name[0], x, y)
            ctx.restore()
        }
    }
    draw(ctx) {
        this.drawBody(ctx)
        this.drawBars(ctx)
    }
}
class Imp extends EarlyMeleeDemon {
    static type = 'imp'
    constructor(x, y) { super(x, y, 'imp') }
}
class Clawling extends EarlyMeleeDemon {
    static type = 'clawling'
    constructor(x, y) { super(x, y, 'clawling') }
}
class Hound extends EarlyMeleeDemon {
    static type = 'hound'
    constructor(x, y) { super(x, y, 'hound') }
}
