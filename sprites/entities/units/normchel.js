class Normchel extends Unit {
    constructor(x, y, town) {
        const hp = 4
        const healSpeed = 2
        const dmg = 2
        const speed = 2
        const salary = 4
        super(x, y, 'normchel', hp, healSpeed, dmg, speed, salary, town)
    }
}