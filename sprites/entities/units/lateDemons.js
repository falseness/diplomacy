// Late variants inherit configured statistics, ownership and combat rules.
class Hexcaster extends EarlyRangedDemon {
    static type = 'hexcaster'
    constructor(x, y) { super(x, y, 'hexcaster') }
}
class Ravager extends KOHb {}
registerMeleeDemon(Ravager, 'ravager', 'KOHb')
class DemonLord extends Normchel {}
registerMeleeDemon(DemonLord, 'demonLord', 'normchel')
