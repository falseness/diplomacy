const {createFixture, defaultFixture} = require('./test-coop-harness');
function fixture() {
  const config=defaultFixture(); config.coop=true;
  return createFixture(config);
}
const snapshot = `JSON.parse(JSON.stringify(({town:target.toJSON(),undo:target.toUndoJSON(),
  defender:defender?defender.toJSON():null,attacker:attacker.toJSON(),
  gold:players.map(p=>p.gold),towns:players.map(p=>p.towns.map(t=>t.toJSON())),
  tiles:grid.arr.map(c=>c.map(cell=>({color:cell.hexagon.playerColor,suburb:cell.hexagon.isSuburb}))) }), (key,value)=>typeof value==='function'?value.name:value))`;
let cases=0;
for (const ranged of [false,true]) for (const hp of [10,0]) for (const defended of [false,true]) {
  const f=fixture(), label=`${ranged?'ranged':'melee'}-hp${hp}-defended${defended}`;
  f.evaluate(`grid.getHexagon({x:5,y:3}).playerColor=3;
    globalThis.attacker=new ${ranged?'Archer':'Noob'}(5,3);
    grid.getHexagon({x:6,y:3}).playerColor=0;
    globalThis.target=new Town(6,3,true); target.hp=${hp};
    globalThis.construction=new ManufactureProduction(2,32,Farm,'farm');
    construction.sendInstructions({x:7,y:4},target);
    target.buildingProduction.push(construction);
    globalThis.defender=null;
    ${defended?`grid.getHexagon({x:6,y:3}).playerColor=1; defender=new Noob(6,3);
    grid.getHexagon({x:6,y:3}).playerColor=0;
    Object.defineProperty(defender, "playerColor", {get:()=>1});`:''}
     whooseTurn=3; attacker.select(); undefined`);
  // Represent a human garrison independently of the neutral town tile owner.
  if(defended) f.compare(label+'-human-defender',f.evaluate('defender.playerColor'),1);
  const before=f.evaluate(snapshot);
  f.compare(label+'-commands-exclude',f.evaluate(`attacker.getAvailableCommands().some(c=>coordsEqually(c.destinationCoord,target.coord))`),false);
  f.compare(label+'-attack-predicate',f.evaluate('attacker.canHitSomethingOnCell(grid.getCell(target.coord))'),false);
  f.compare(label+'-interaction-predicate',f.evaluate('attacker.interaction.canHitSomethingOnCell(grid.getCell(target.coord),attacker)'),false);
  f.evaluate('attacker.sendInstructions(grid.getCell(target.coord)); attacker.interaction.sendInstructions(grid.getCell(target.coord),attacker); undefined');
  f.compare(label+'-unchanged-state',f.evaluate(snapshot),before);
  f.compare(label+'-human-target-selected',f.evaluate('new BestEnemyTargetForAI().calculateBestEnemyTarget(attacker.coord,grid.arr,3)'),{x:7,y:1});
  cases++;
}
for(const ranged of [false,true]) {
  const f=fixture(),label=`corridor-${ranged?'ranged':'melee'}`;
  f.evaluate(`for(let x=0;x<9;x++) for(let y=0;y<7;y++)
    if(y!==3 || x<3 || x>5) grid.setBuilding(new Sea(x,y),{x,y});
    grid.getHexagon({x:3,y:3}).playerColor=3;
    globalThis.attacker=new ${ranged?'Archer':'Noob'}(3,3);
      whooseTurn=3; attacker.select();
    grid.getHexagon({x:4,y:3}).playerColor=0;
    globalThis.target=new Town(4,3,true); target.hp=0; globalThis.defender=null; undefined`);
  const before=f.evaluate(snapshot);
  // Path was cached while the corridor was empty; execution must revalidate it.
  f.evaluate('attacker.sendInstructions(grid.getCell({x:5,y:3})); undefined');
  f.compare(label+'-stale-transit-unchanged',f.evaluate(snapshot),before);
  f.compare(label+'-fresh-path-blocked',f.evaluate(`attacker.getAvailableMoveCommands().some(c=>c.destinationCoord.x>=4)`),false);
  f.compare(label+'-unreachable-objectives',f.evaluate('new BestEnemyTargetForAI().calculateBestEnemyTarget(attacker.coord,grid.arr,3)'),null);
}
{
  const f=fixture();
  f.evaluate(`for(const p of players.slice(1,3)) {for(const t of [...p.towns]) t.destroy(); for(const u of [...p.units]) u.kill();}
    globalThis.target=players[0].towns[0]; globalThis.attacker=players[3].units[0];
    globalThis.defender=null; whooseTurn=3; undefined`);
  const before=f.evaluate(snapshot);
  f.compare('neutral-only-objective',f.evaluate('new BestEnemyTargetForAI().calculateBestEnemyTarget(attacker.coord,grid.arr,3)'),null);
  f.evaluate('players[3].play(); undefined');
  f.compare('neutral-only-phase-unchanged',f.evaluate(snapshot),before);
  f.compare('neutral-only-no-immediate-terminal',f.evaluate('gameExit'),false);
}
{
  const f=fixture();
  f.evaluate(`grid.getHexagon({x:3,y:5}).playerColor=1; globalThis.attacker=new Noob(3,5);
    globalThis.target=players[0].towns[0]; target.hp=0; whooseTurn=1;
    attacker.select(); attacker.sendInstructions(grid.getCell(target.coord)); undefined`);
  f.compare('human-control-capture',f.evaluate('({owner:target.playerColor,coord:attacker.coord,hp:target.hp})'),{owner:1,coord:{x:4,y:5},hp:0});
}
console.log(`PASS neutral-towns combat_cases=${cases} stale_corridors=2 neutral_only_phase=1 human_capture=1`);
