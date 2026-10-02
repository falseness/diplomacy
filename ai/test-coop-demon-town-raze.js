const {createFixture, defaultFixture} = require('./test-coop-harness');

// Since TASK-409 demons capture (never raze) a human town: a melee demon that
// brings the town to hp 0 with no defender left enters it, the town joins the
// demon registry and its suburbs turn to the demon slot, as for a human capture.
// Literal outcomes deliberately specify combat and movement independently of
// production policy. All submissions use the ordinary inherited interactions.
// The full capture contract is in ai/test-coop-demon-town-capture.js.
let count = 0;
for (const [label, hp, defenderHP, ranged, expectedHP, expectedDefender, captured] of [
  ['healthy', 10, null, false, 9, null, false],
  ['last-hit', 1, null, false, 0, null, true],
  ['already-zero', 0, null, false, 0, null, true],
  ['last-hit-defended', 1, 1, false, 0, 1, false],
  ['surviving-defender', 0, 2, false, 0, 1, false],
  ['defender-cleared', 0, 1, false, 0, 0, true],
  ['ranged-last-hit', 2, null, true, 0, null, false],
  ['ranged-zero', 0, null, true, 0, null, false],
]) {
  const config = defaultFixture(); config.coop = true;
  const f = createFixture(config);
  f.evaluate(`grid.getHexagon({x:5,y:3}).playerColor=3;
    globalThis.attacker=new ${ranged?'Archer':'Noob'}(5,3);
    grid.getHexagon({x:6,y:3}).playerColor=1;
    globalThis.target=new Town(6,3,true); target.hp=${hp};
    globalThis.defender=${defenderHP===null?'null':'new Noob(6,3)'};
    ${defenderHP===null?'':`defender.hp=${defenderHP};`}
    globalThis.farm=new Farm(6,4,target); target.buildings.push(farm);
    globalThis.construction=new ManufactureProduction(2,32,Farm,'farm');
    construction.sendInstructions({x:7,y:4},target);
    target.buildingProduction.push(construction); grid.setBuilding(construction,construction.coord);
    for(const coord of [{x:6,y:3},{x:6,y:4},{x:7,y:4}]) {
      const hex=grid.getHexagon(coord); hex.playerColor=1; hex.isSuburb=true; target.suburbs.push(hex);
    }
    globalThis.bystander=new Noob(6,4);
    globalThis.unrelated=new Farm(8,5,players[2].towns[0]);
    globalThis.registrations=0; globalThis.destroyCalls=0;
    const update=target.updatePlayer; target.updatePlayer=function(){ registrations++; return update.call(this); };
    const destroy=target.destroy; target.destroy=function(){ destroyCalls++; return destroy.call(this); };
    whooseTurn=3; attacker.select(); undefined`);
  const unrelatedBefore = f.evaluate(`({unit:bystander.toJSON(),farm:unrelated.toJSON(),
    towns:players.slice(0,3).map(p=>p.towns.filter(t=>t!==target).map(t=>t.toJSON()))})`);
  f.compare(label+'-legal-target', f.evaluate(`attacker.getAvailableCommands().some(c=>
    c.destinationCoord.x===6&&c.destinationCoord.y===3)`), true);
  f.evaluate('attacker.sendInstructions(grid.getCell({x:6,y:3})); undefined');
  f.compare(label+'-combat', f.evaluate(`({hp:target.hp,defender: defender?defender.hp:null,
    defenderKilled:defender?defender.killed:null,position:attacker.coord,moves:attacker.moves,
    attackerHP:attacker.hp,attackerKilled:attacker.killed,owner:attacker.playerColor})`),
    {hp:expectedHP,defender:expectedDefender,defenderKilled:expectedDefender===null?null:expectedDefender===0,
      position:{x:captured?6:5,y:3},moves:0,attackerHP:ranged?1:2,attackerKilled:false,owner:3});
  f.compare(label+'-cleanup', f.evaluate(`({destroyCalls,registrations,killed:target.killed,
    empty:grid.getBuilding({x:6,y:3}).isEmpty(),registered:players.some(p=>p.towns.includes(target)),
    registeredTo:players.findIndex(p=>p.towns.includes(target)),townOwner:target.playerColor,
    tile:grid.getHexagon({x:6,y:3}).playerColor,
    suburbs:[{x:6,y:3},{x:6,y:4},{x:7,y:4}].map(c=>grid.getHexagon(c).isSuburb),
    suburbOwners:[{x:6,y:3},{x:6,y:4},{x:7,y:4}].map(c=>grid.getHexagon(c).playerColor),
    farmKilled:farm.killed,constructionKilled:construction.killed,
    farmEmpty:grid.getBuilding({x:6,y:4}).isEmpty(),constructionEmpty:grid.getBuilding({x:7,y:4}).isEmpty(),
    occupant:grid.getUnit({x:6,y:3})===attacker})`),
    // A capture keeps the town, hands it to the demons and repaints its free
    // suburbs; the bystander's suburb (6,4) is dropped and the town's
    // buildings are killed, exactly as in an ordinary human capture.
    {destroyCalls:0,registrations:captured?1:0,killed:false,empty:false,registered:true,
      registeredTo:captured?3:1,townOwner:captured?3:1,tile:captured?3:1,
      suburbs:[true,!captured,true],suburbOwners:[captured?3:1,1,captured?3:1],
      farmKilled:captured,constructionKilled:captured,
      farmEmpty:captured,constructionEmpty:captured,occupant:captured});
  f.compare(label+'-unrelated-preserved',f.evaluate(`({unit:bystander.toJSON(),farm:unrelated.toJSON(),
    towns:players.slice(0,3).map(p=>p.towns.filter(t=>t!==target).map(t=>t.toJSON()))})`),unrelatedBefore);
  f.compare(label+'-no-immediate-reward',f.evaluate('players.map(p=>p.gold)'),[0,68,75,0]);
  f.evaluate('players[3].nextTurn(); undefined');
  f.compare(label+'-zero-economy-after-tick',f.evaluate(`({gold:players.map(p=>p.gold),
    income:players[3].income,salary:players[3].armySalary,mines:players[3].goldminesIncome,
    towns:players[3].towns.length})`),{gold:[0,68,75,0],income:0,salary:0,mines:0,towns:captured?1:0});
  count++;
}
// The same shared move boundary still accepts a demon's own portal.
{
  const config=defaultFixture(); config.coop=true;
  const f=createFixture(config);
  f.evaluate(`grid.getHexagon({x:5,y:3}).playerColor=3; globalThis.attacker=new Noob(5,3);
    globalThis.portal=new DemonPortal(6,3,"melee"); whooseTurn=3;
    attacker.select(); attacker.sendInstructions(grid.getCell({x:6,y:3})); undefined`);
  f.compare('own-portal-entry-preserved',f.evaluate(`({position:attacker.coord,moves:attacker.moves,
    hp:portal.hp,killed:portal.killed,owner:portal.playerColor})`),
    {position:{x:6,y:3},moves:1,hp:12,killed:false,owner:3});
}
console.log(`PASS demon-town-raze scenarios=${count} portal_controls=1 same_action_capture=3 ranged_no_enter=2 razed=0`);
