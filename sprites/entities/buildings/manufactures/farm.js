class Farm extends Manufacture {
    constructor(x, y) {
        const hp = 3
        const healSpeed = 1
        const income = 2 
        super(x, y, 'farm', hp, healSpeed, income)
    }
}