// Heavy variants share the configured stats, ownership and melee rules.
class Brute extends EarlyMeleeDemon {
    static type = 'brute'
    constructor(x, y) { super(x, y, 'brute') }
}
class Bulwark extends EarlyMeleeDemon {
    static type = 'bulwark'
    constructor(x, y) { super(x, y, 'bulwark') }
}
