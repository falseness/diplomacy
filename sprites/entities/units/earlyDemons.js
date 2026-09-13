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
    static visualTypes = ['imp', 'clawling', 'hound', 'brute', 'bulwark',
        'spitter', 'emberArcher', 'hexcaster', 'ravager', 'demonLord']
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
        } else if (type === 'spitter') { // Crouched acid beast and a detached projectile.
            ctx.fillStyle = '#285c32'
            polygon([[-.4,.27],[-.3,-.05],[-.17,-.19],[.02,-.2],[.12,-.07],
                [.28,-.05],[.28,.07],[.08,.09],[.17,.28],[-.02,.28],[-.09,.13],[-.22,.28]])
            ctx.fillStyle = '#b8f35d'
            polygon([[.32,-.06],[.45,-.16],[.43,.02],[.36,.06]])
        } else if (type === 'emberArcher') { // Hood, tall bow and flaming arrow.
            ctx.fillStyle = '#783019'
            polygon([[-.31,-.12],[-.2,-.36],[-.06,-.12],[-.12,.02],[.03,.31],[-.36,.31],[-.26,.02]])
            ctx.strokeStyle = '#ffb34f'
            ctx.beginPath()
            ctx.moveTo(.13,-.35); ctx.quadraticCurveTo(.48,0,.13,.35)
            ctx.lineTo(.13,-.35)
            ctx.moveTo(-.14,0); ctx.lineTo(.4,0); ctx.stroke()
            ctx.fillStyle = '#ffb34f'
            polygon([[.3,-.06],[.47,0],[.3,.06]])
        } else if (type === 'hexcaster') { // Floating robe, staff and violet spell diamond.
            ctx.fillStyle = '#652f91'
            polygon([[-.26,-.19],[-.14,-.37],[-.02,-.19],[-.08,-.02],
                [.06,.28],[-.08,.22],[-.18,.32],[-.34,.25],[-.23,-.02]])
            ctx.strokeStyle = '#d6a4ff'
            ctx.lineWidth = .04
            ctx.beginPath(); ctx.moveTo(.22,-.2); ctx.lineTo(.22,.32); ctx.stroke()
            ctx.fillStyle = '#c585ff'
            polygon([[.22,-.4],[.34,-.27],[.22,-.14],[.1,-.27]])
        } else if (type === 'ravager') { // Armored berserker with two long serrated blades.
            ctx.fillStyle = '#802431'
            polygon([[-.16,-.35],[0,-.24],[.16,-.35],[.12,-.1],[.22,.05],
                [.17,.34],[.03,.34],[0,.16],[-.03,.34],[-.17,.34],[-.22,.05],[-.12,-.1]])
            ctx.fillStyle = '#e38886'
            polygon([[-.2,.15],[-.43,-.27],[-.28,-.2],[-.32,-.4],[-.12,-.02]])
            polygon([[.2,.15],[.43,-.27],[.28,-.2],[.32,-.4],[.12,-.02]])
        } else if (type === 'demonLord') { // Winged mantle and gold crown mark the final tier.
            ctx.fillStyle = '#4c1640'
            polygon([[-.1,-.12],[-.44,-.34],[-.38,.17],[-.24,.04],[-.31,.33],
                [0,.23],[.31,.33],[.24,.04],[.38,.17],[.44,-.34],[.1,-.12]])
            ctx.fillStyle = '#b93e51'
            polygon([[-.13,-.17],[.13,-.17],[.1,.06],[.19,.35],[-.19,.35],[-.1,.06]])
            ctx.fillStyle = '#ffd46b'
            polygon([[-.18,-.4],[-.07,-.3],[0,-.45],[.07,-.3],[.18,-.4],[.13,-.19],[-.13,-.19]])
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
