const {createFixture, defaultFixture} = require('./test-coop-harness');

// Literal outcomes deliberately specify combat and movement independently of
// production policy. All submissions use the ordinary inherited interactions.
let count = 0;
for (const [label, hp, defenderHP, ranged, expectedHP, expectedDefender, razed] of [
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
    players[3].towns.push=function(...args){
      throw new Error('temporary demon economic registration');
    };
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
      position:{x:razed?6:5,y:3},moves:0,attackerHP:ranged?1:2,attackerKilled:false,owner:3});
  f.compare(label+'-cleanup', f.evaluate(`({destroyCalls,registrations,killed:target.killed,
    empty:grid.getBuilding({x:6,y:3}).isEmpty(),registered:players.some(p=>p.towns.includes(target)),
    tile:grid.getHexagon({x:6,y:3}).playerColor,suburbs:target.suburbs.map(h=>h.isSuburb),
    farmKilled:farm.killed,constructionKilled:construction.killed,
    farmEmpty:grid.getBuilding({x:6,y:4}).isEmpty(),constructionEmpty:grid.getBuilding({x:7,y:4}).isEmpty(),
    occupant:grid.getUnit({x:6,y:3})===attacker})`),
    {destroyCalls:razed?1:0,registrations:0,killed:razed,empty:razed,registered:!razed,
      tile:razed?3:1,suburbs:[!razed,!razed,!razed],farmKilled:razed,constructionKilled:razed,
      farmEmpty:razed,constructionEmpty:razed,occupant:razed});
  f.compare(label+'-unrelated-preserved',f.evaluate(`({unit:bystander.toJSON(),farm:unrelated.toJSON(),
    towns:players.slice(0,3).map(p=>p.towns.filter(t=>t!==target).map(t=>t.toJSON()))})`),unrelatedBefore);
  f.compare(label+'-no-immediate-reward',f.evaluate('players.map(p=>p.gold)'),[0,68,75,0]);
  f.evaluate('players[3].nextTurn(); undefined');
  f.compare(label+'-zero-economy-after-tick',f.evaluate(`({gold:players.map(p=>p.gold),
    income:players[3].income,salary:players[3].armySalary,mines:players[3].goldminesIncome,
    towns:players[3].towns.length})`),{gold:[0,68,75,0],income:0,salary:0,mines:0,towns:0});
  count++;
}
// The same shared move boundary still accepts a demon's own portal.
{
  const config=defaultFixture(); config.coop=true;
  const f=createFixture(config);
  f.evaluate(`grid.getHexagon({x:5,y:3}).playerColor=3; globalThis.attacker=new Noob(5,3);
    globalThis.portal=new DemonPortal(6,3); whooseTurn=3;
    attacker.select(); attacker.sendInstructions(grid.getCell({x:6,y:3})); undefined`);
  f.compare('own-portal-entry-preserved',f.evaluate(`({position:attacker.coord,moves:attacker.moves,
    hp:portal.hp,killed:portal.killed,owner:portal.playerColor})`),
    {position:{x:6,y:3},moves:1,hp:30,killed:false,owner:3});
}
console.log(`PASS demon-town-raze scenarios=${count} portal_controls=1 same_action_raze=3 ranged_no_raze=2 temporary_registration=0`);
