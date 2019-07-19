const mobilePhone = (/Android|webOS|iPhone|iPad|iPod|BlackBerry|BB|PlayBook|IEMobile|Windows Phone|Kindle|Silk|Opera Mini/i).test(navigator.userAgent)

const WIDTH = window.innerWidth
const HEIGHT = window.innerHeight
let width = WIDTH
let height = HEIGHT
const radius = 80
let basis = {
    r: radius,
    offset: {
        x: radius * 1.5,
        y: radius * Math.sqrt(3) / 2,
        assets: {
            x: 2,
            y: 2
        }
    },
}
delete radius

const offsetToOrigin = {
    x: basis.r,
    y: basis.r * Math.sin(Math.PI / 3)
}

let canvas = {
    offset: {
        x: 0,
        y: 0
    },
    scale: 1
}
const mapBorderMargin = 0.5 * HEIGHT //0.5 * HEIGHT
    /*function toCube(x, by)
    {
        
        //by = 2 * y + x
        //y = (by - x) / 2
        //x + y + z = 0
        //z = -x - y
        
        return ({x: x, y: (by - x) / 2, z: -this.y - this.x})
    }*/
function getFractionalPartOfNumber(n) {
    return n % 1
}

function pythagoreanSquared(x, y) {
    return x * x + y * y
}

function pythagorean(x, y) {
    return sqrt(pythagoreanSquared(x, y))
}
function pointPythagorean(pOne, pTwo) {
    return pythagorean(pOne.x - pTwo.x, pOne.y - pTwo.y)
}
function numbersHaveEqualParity(a, b) {
    return !((a & 1) ^ (b & 1))
}

function biasToTransition(x, y) {
    /*
        even basis
        y = y - (x - (x & 1)) / 2 (to axial)
        by = 2 * y + x
    */
    return { x: x, y: 2 * y + (x & 1) }
}

function transitionToBias(x, y) {
    return { x: x, y: (y - (x & 1)) / 2 }
}

function getCoord(x, y) {
    let transition = {
            x: Math.round(x / basis.offset.x),
            y: Math.round(y / basis.offset.y)
        }
        //console.log('transition: ' + transition.x + ' ' + transition.y)

    if (numbersHaveEqualParity(transition.x, transition.y))
        return transitionToBias(transition.x, transition.y)

    let hex1 = {
        x: transition.x + 1,
        y: transition.y
    }
    let hex2 = {
        x: transition.x,
        y: transition.y + 1
    }
    let hex3 = {
        x: transition.x - 1,
        y: transition.y
    }
    let hex4 = {
        x: transition.x,
        y: transition.y - 1
    }
    hex1.distanceSquared = pythagoreanSquared(hex1.x * basis.offset.x - x, hex1.y * basis.offset.y - y)
    hex2.distanceSquared = pythagoreanSquared(hex2.x * basis.offset.x - x, hex2.y * basis.offset.y - y)
    hex3.distanceSquared = pythagoreanSquared(hex3.x * basis.offset.x - x, hex3.y * basis.offset.y - y)
    hex4.distanceSquared = pythagoreanSquared(hex4.x * basis.offset.x - x, hex4.y * basis.offset.y - y)

    let selectedHex = hex1
    if (hex2.distanceSquared < selectedHex.distanceSquared)
        selectedHex = hex2
    if (hex3.distanceSquared < selectedHex.distanceSquared)
        selectedHex = hex3
    if (hex4.distanceSquared < selectedHex.distanceSquared)
        selectedHex = hex4
    return transitionToBias(selectedHex.x, selectedHex.y)
}