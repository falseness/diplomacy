const width = window.innerWidth
const height = window.innerHeight

const radius = 80
let basis = 
{
    r: radius,
    offset:
    {
        x: radius * 1.5,
        y: radius * Math.sqrt(3) / 2,
        assets:
        {
            x: 2,
            y: 2
        }
    },
}
delete radius

/*function toCube(x, by)
{
    
    //by = 2 * y + x
    //y = (by - x) / 2
    //x + y + z = 0
    //z = -x - y
    
    return ({x: x, y: (by - x) / 2, z: -this.y - this.x})
}*/
function biasToTransition(x, y)
{
    /*
        even basis
        y = y - (x - (x & 1)) / 2 (to axial)
        by = 2 * y + x
    */
    return {x: x, y: 2 * y + (x & 1)}
}
function transitionToBias(x, y)
{
    return {x: x, y: (y - (x & 1)) / 2}
}
function getCoord(x, y)
{
    return transitionToBias(Math.round(x / basis.offset.x), Math.round(y / basis.offset.y))
}