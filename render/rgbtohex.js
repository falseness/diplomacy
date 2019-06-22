function decimalToHex(num)
{
    let hex = num.toString(16)
    return (hex.length < 2)?('0' + hex):hex
}
function rgbToHex(r, g, b)
{
    return '#' + decimalToHex(r) + decimalToHex(g) + decimalToHex(b)
}
/*function correctLightness(color, ratio = 1.2)
{
    for (i in color)
    {
        if (!color[i])
            color[i] = 1
    }
    let result = 
    {
        r: Math.min(Math.max(Math.floor(color.r * ratio), 0), 255),
        g: Math.min(Math.max(Math.floor(color.g * ratio), 0), 255),
        b: Math.min(Math.max(Math.floor(color.b * ratio), 0), 255)
    }
    return result;
}*/
/*
using colors:
    unit:
        green: #78a85d
        yellow: #F1D791
        brown: #8D7755

    background: #D0D0D0

    house:
        brown: #957357
        light-brown: #AC8665
        grey: #CDCABB
*/