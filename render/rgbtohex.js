function decimalToHex(num)
{
    let hex = num.toString(16)
    return (hex.length < 2)?('0' + hex):hex
}
function rgbToHex(r, g, b)
{
    return '#' + decimalToHex(r) + decimalToHex(g) + decimalToHex(b)
}