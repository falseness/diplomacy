function decimalToHex(num)
{
    let hex = num.toString(16)
    return (hex.length < 2)?('0' + hex):hex
}
function rgbToHex(r, g, b)
{
    return '#' + decimalToHex(r) + decimalToHex(g) + decimalToHex(b)
}

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