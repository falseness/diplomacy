class MenuSlider extends Slider {
    constructor(minimumValue, maximumValue, getKeyMap, parameters, startValue, marginX, text, size) {
        let nonePos = {x: NaN, y: NaN}
        super(minimumValue, maximumValue, getKeyMap, parameters, startValue, marginX, text,
            new ImageButton(new JustImage('leftButton', nonePos, size.width, size.height), 
                new Rect(nonePos.x, nonePos.y, size.width, size.height)),
            new ImageButton(new JustImage('rightButton', nonePos, size.width, size.height), 
                new Rect(nonePos.x, nonePos.y, size.width, size.height)))
    }
}