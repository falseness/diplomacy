'use strict';
// TASK-368: fogged landmarks render only when gameSettings.drawFogLandmarks is true.
// TASK-450-4: neutral towns are landmarks too, and the flag defaults to true in co-op.
// Usage: node ai/test-fog-landmark-setting.js --output-dir DIR [--fault ignore-flag]
const fs=require('fs'),path=require('path'),vm=require('vm'),util=require('util');
const arg=name=>{const i=process.argv.indexOf(name);return i<0?undefined:process.argv[i+1];};
const out=arg('--output-dir'),fault=arg('--fault');
if(!out||(fault!==undefined&&fault!=='ignore-flag')){console.error('usage: --output-dir DIR [--fault ignore-flag]');process.exit(2);}
fs.mkdirSync(out,{recursive:true});

const gridSource=fs.readFileSync(path.join(__dirname,'../groups/grid.js'),'utf8');
const varsSource=fs.readFileSync(path.join(__dirname,'../options/gameObjectVariables.js'),'utf8');
const gate=`        if (gameSettings.drawFogLandmarks !== true)
            return
`;
if(!gridSource.includes(gate))throw Error('drawFogLandmark gate not found in groups/grid.js');
const neutralTown={name:'town',bodyImageName:'town',player:{isNeutral:true}};
const landmarks=[{name:'goldmine',bodyImageName:'goldmine'},{name:'demonPortal',isDemonPortal:true,imageName:'portal'},neutralTown];
const ignored=[{name:'town',player:{isNeutral:false}},{name:'town',player:{isNeutral:true},killed:true},{name:'demonPortal',isDemonPortal:true,imageName:'portal',killed:true}];

function render(gameSettings,buildings){
    const calls=[];
    // Negative control: drop the gate, restoring the pre-TASK-368 renderer.
    const source=fault==='ignore-flag'?gridSource.replace(gate,''):gridSource;
    const Grid=vm.runInNewContext(source+';Grid',{SpritesGroup:class {},gameSettings,cachedImages:{goldmine:'gold',portal:'portal',town:'town'},drawCachedImage:(_ctx,img)=>calls.push(img)});
    const grid=new Grid();
    for(const props of buildings)
        grid.drawFogLandmark({},{...props,pos:{x:0,y:0},get unit(){throw Error('occupant accessed');},draw(){throw Error('indirect draw');}});
    return calls;
}
function normalize(settings){
    const normalizeFogLandmarkSettings=vm.runInNewContext(varsSource+';normalizeFogLandmarkSettings',{module:undefined});
    return normalizeFogLandmarkSettings(settings).drawFogLandmarks;
}

const coop={humanSlots:[1],demonSlot:2};
const cases=[
    ['render-competitive',()=>render({drawFogLandmarks:true},landmarks),['gold','portal','town']],
    ['render-coop',()=>render({drawFogLandmarks:true,coop},landmarks),['gold','portal','town']],
    ['render-explicit-false',()=>render({drawFogLandmarks:false,coop},landmarks),[]],
    ['render-owned-killed-towns-and-killed-portal',()=>render({drawFogLandmarks:true},ignored),[]],
    ['render-missing-flag',()=>render({isOnline:false},landmarks),[]],
    ['normalize-coop-missing',()=>normalize({coop}),true],
    ['normalize-competitive-missing',()=>normalize({isOnline:true}),true],
    ['normalize-explicit-true-in-coop',()=>normalize({coop,drawFogLandmarks:true}),true],
    ['normalize-explicit-false-in-competitive',()=>normalize({drawFogLandmarks:false}),false],
    ['normalize-non-boolean',()=>normalize({coop,drawFogLandmarks:'yes'}),true],
];
const checkpoints=[];
for(const [id,run,expected] of cases){
    let observed;
    try{observed=run();}catch(e){observed='ERROR '+e.message;}
    const pass=util.isDeepStrictEqual(observed,expected);
    checkpoints.push({id,expected,observed,pass});
    console.log(`${pass?'PASS':'FAIL'} ${id}${pass?'':' expected='+JSON.stringify(expected)+' observed='+JSON.stringify(observed)}`);
}
const failed=checkpoints.filter(c=>!c.pass).length;
fs.writeFileSync(path.join(out,'checkpoints.json'),JSON.stringify(checkpoints,null,2)+'\n');
console.log(`SUMMARY pass=${checkpoints.length-failed} fail=${failed}${fault?' fault='+fault:''}`);
process.exit(failed?1:0);
