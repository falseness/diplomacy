class Noob extends Unit {
    constructor(x, y, town) {
        const hp = 2
        const healSpeed = 1
        const dmg = 1
        const speed = 2
        const salary = 1
        super(x, y, 'noob', hp, healSpeed, dmg, speed, salary, town)
    }
}