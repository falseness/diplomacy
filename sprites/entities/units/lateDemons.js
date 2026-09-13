// Late variants inherit configured statistics, ownership and combat rules.
class Hexcaster extends EarlyRangedDemon {
    static type = 'hexcaster'
    constructor(x, y) { super(x, y, 'hexcaster') }
}
class Ravager extends EarlyMeleeDemon {
    static type = 'ravager'
    constructor(x, y) { super(x, y, 'ravager') }
}
class DemonLord extends EarlyMeleeDemon {
    static type = 'demonLord'
    constructor(x, y) { super(x, y, 'demonLord') }
}
