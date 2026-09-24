const {createFixture, defaultFixture} = require('./test-coop-harness');

const parents = {Imp:['Noob','noob'], Clawling:['Noob','noob'], Hound:['KOHb','KOHb'],
  Brute:['Normchel','normchel'], Bulwark:['Normchel','normchel'],
  Ravager:['KOHb','KOHb'], DemonLord:['Normchel','normchel']};

function run(cases) {
  for (const [klass, name, hp, speed, damage] of cases) {
    const [parent, asset] = parents[klass];
    function setup(normal = false) {
      const config = defaultFixture(); config.coop = true; config.size = {x:15,y:15};
      const f = createFixture(config);
      f.evaluate(`new DemonPortal(5,3,"melee");
        ${normal ? `Object.assign(${parent}, {maxHP:${hp},speed:${speed},dmg:${damage},healSpeed:0,salary:0});` : ''}
        globalThis.subject = new ${normal ? parent : klass}(5,3); whooseTurn=3; undefined`);
      return f;
    }
    const f = setup();
    f.compare(name+'-normal-inheritance', f.evaluate(`({parent:Object.getPrototypeOf(${klass}.prototype)===${parent}.prototype,
      interaction:subject.interaction.constructor.name,
      draw:subject.draw===${parent}.prototype.draw, instructions:subject.sendInstructions===${parent}.prototype.sendInstructions,
      prototypeKeys:Object.getOwnPropertyNames(${klass}.prototype), name:subject.name,
      owner:subject.playerColor, registry:players[3].units.includes(subject), registered:getClass(subject.name)===${klass}})`),
    {parent:true,interaction:parent==='KOHb'?'MirroringInteraction':'InterationWithUnit',draw:true,
      instructions:true,prototypeKeys:['constructor'],name,owner:3,registry:true,registered:true});
    f.compare(name+'-existing-assets', f.evaluate(`(() => {
      cacheAllImages(); const calls=[]; const ctx=new Proxy({drawImage(image){calls.push(image)}},
        {get(t,k){return k in t?t[k]:()=>{}}});
      subject.draw(ctx); const right=calls.includes(cachedImages['${asset}']);
      const before=cachedImages[subject.name]; cacheAllImages();
      const refreshed=cachedImages[subject.name]===cachedImages['${asset}'] && before!==cachedImages[subject.name];
      calls.length=0; subject.mirrorX=true; subject.draw(ctx);
      const left=calls.includes(cachedImages['${parent==='KOHb'?'KOHbLeft':asset}']);
      return {right,left,refreshed,portrait:assets[subject.name]===assets['${asset}']};
    })()`), {right:true,left:true,refreshed:true,portrait:true});
    for (const scenario of ['portal-exit-left','nonlethal-move-attack','lethal-move-attack']) {
      const observations=[];
      for (const normal of [true,false]) {
        const trial=setup(normal);
        // Two cells away exercises move-and-attack; speed-one units cannot reach it.
        trial.evaluate(`grid.getHexagon({x:5,y:5}).playerColor=1;
          class Target extends Normchel {static maxHP=30}; globalThis.victim=new Target(5,5); victim.hp=${scenario==='lethal-move-attack'?1:30}; undefined`);
        const destination=scenario==='portal-exit-left'?{x:4,y:3}:{x:5,y:5};
        const observed=trial.evaluate(`(() => {
          const commands=subject.getAvailableCommands().map(c=>c.destinationCoord);
          const destination=${JSON.stringify(destination)};
          const legal=commands.some(c=>coordsEqually(c,destination));
          subject.sendInstructions(grid.getCell(destination));
          return {legal,coord:subject.coord,moves:subject.moves,hp:victim.hp,killed:victim.killed,
            mirror:!!subject.mirrorX,owner:subject.playerColor,registry:players[3].units.includes(subject),
            portal:grid.getBuilding({x:5,y:3}).isDemonPortal};
        })()`);
        observations.push(observed);
        const move=scenario==='portal-exit-left', reachable=speed>=2, lethal=scenario==='lethal-move-attack';
        trial.compare(`${name}-${scenario}-${normal?'parent':'variant'}-literal`, observed,
          {legal:move||reachable,coord:move?{x:4,y:3}:reachable?{x:5,y:lethal?5:4}:{x:5,y:3},
            moves:move?speed-1:reachable?0:speed,hp:(lethal?1:30)-(move||!reachable?0:damage),
            killed:!move&&reachable&&lethal,mirror:move&&parent==='KOHb',owner:3,registry:true,portal:true});
      }
      f.compare(name+'-'+scenario+'-parent-parity',observations[1],observations[0]);
    }
    f.compare(name+'-save-load-and-no-economy',f.evaluate(`(() => {
      subject.hit(1); subject.moves=0; const packed=subject.toJSON(); subject.kill();
      unpacker.fullUnpackUnit(packed); const restored=grid.getUnit(packed.coord);
      restored.wasHitted=false; players[3].gold=900; players[3].nextTurn();
      return {name:restored.name,className:restored.constructor.name,hp:restored.hp,moves:restored.moves,
        owner:restored.playerColor,registry:players[3].units.includes(restored),gold:players[3].gold,
        income:players[3].income,salary:players[3].armySalary,towns:players[3].towns.length,
        economicEntry:!!players[3].canEnterBuilding(players[1].towns[0]),healSpeed:restored.healSpeed};
    })()`),{name,className:klass,hp:hp-1,moves:speed,owner:3,registry:true,gold:0,income:0,salary:0,towns:0,economicEntry:false,healSpeed:0});
    console.log(`PASS normal-parent ${name} parent=${parent} inheritance interaction rendering registry portal-exit save-load no-economy`);
  }
}
module.exports = {run};
