// Independent browser geometry checks for the controls introduced by TASK-083.
async function checkSizeLayout(page, tree, compare) {
  const result = await page.evaluate(tree => {
    const settings = menu[tree], slider = settings.sizeSlider;
    const box = r => ({left:r.x,right:r.x+r.width,top:r.y,bottom:r.y+r.height});
    const textBox = t => ({left:t.left,right:t.right,top:t.y-t.height/2,bottom:t.y+t.height/2});
    settings.draw(interfaceCtx);
    const boxes = [textBox(settings.dimensionsText),box(slider.leftButton.rect),textBox(slider.text),box(slider.rightButton.rect)];
    const overlaps=(a,b)=>a.left<b.right && a.right>b.left && a.top<b.bottom && a.bottom>b.top;
    const others = settings.buttons.filter(b=>b!==slider).flatMap(b=>b.rect?[box(b.rect)]:
      b.leftButton?[box(b.leftButton.rect),box(b.rightButton.rect),textBox(b.text)]:[]);
    return {viewport:[WIDTH,HEIGHT],label:slider.realValue,inside:boxes.every(b=>b.left>=0 && b.right<=WIDTH && b.top>=0 && b.bottom<=HEIGHT),
      clear:boxes.every((b,i)=>boxes.slice(i+1).every(c=>!overlaps(b,c)) && others.every(c=>!overlaps(b,c))),
      readable:slider.text.fontSize>=15 && slider.text.color==='black',seedLabelClear:settings.mapText.right<settings.mapSlider.leftButton.x,
      humansLabelClear:settings.playersText.right<settings.playersSlider.leftButton.x,
      passwordLabelClear:tree!=='online' || settings.passwordText.right<settings.passwordButtons[0].x,boxes};
  }, tree);
  const dimensions = await page.evaluate(tree=>{menu[tree].draw(interfaceCtx);return {humans:menu[tree].playersSlider.value,size:menu[tree].sizeSlider.realValue.toLowerCase(),text:menu[tree].dimensionsText.text}},tree);
  const side=Math.max({tiny:11,normal:15,big:21}[dimensions.size],Math.ceil({tiny:15,normal:25,big:39}[dimensions.size]*Math.sqrt(dimensions.humans/4)));
  compare(tree+'-displayed-dimensions-'+dimensions.humans,dimensions.text,`${side}×${side}`);
  console.log(JSON.stringify({scenario:tree+'-size-layout-measurements',...result}));
  compare(tree+'-size-layout-'+result.viewport.join('x')+'-'+result.label,
    {inside:result.inside,clear:result.clear,readable:result.readable,seedLabelClear:result.seedLabelClear,humansLabelClear:result.humansLabelClear,passwordLabelClear:result.passwordLabelClear},
    {inside:true,clear:true,readable:true,seedLabelClear:true,humansLabelClear:true,passwordLabelClear:true});
}
module.exports={checkSizeLayout};
