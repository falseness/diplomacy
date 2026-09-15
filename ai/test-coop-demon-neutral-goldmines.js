// Demons must not pick any goldmine (non-hittable, non-capturable, whatever its owner) as objective.
// --fault-old-objectives restores the original predicate and must fail.
// --fault-neutral-only-objectives restores the neutral-only predicate and must fail on owned mines.
const {createFixture, defaultFixture} = require('./test-coop-harness');
const fault = process.argv.includes('--fault-old-objectives');
const neutralOnlyFault = process.argv.includes('--fault-neutral-only-objectives');
function fixture(coop=true) {
  const config=defaultFixture(); config.coop=coop;
  const f=createFixture(config);
  if(fault) f.evaluate('Player.prototype.ignoresObjective=Player.prototype.ignoresCell; undefined');
  if(neutralOnlyFault) f.evaluate(`Player.prototype.ignoresObjective=function(cell) {
    return this.ignoresCell(cell) || (this.role === 'DEMONS' && cell.building.notEmpty() &&
      cell.building.name === 'goldmine' && cell.building.player.role === 'NEUTRAL')}; undefined`);
  return f;
}
const target = (coord,color) => `new BestEnemyTargetForAI().calculateBestEnemyTarget(${JSON.stringify(coord)},grid.arr,${color})`;
{
  const f=fixture();
  // Neutral mine one step from the demon, human towns farther away.
  f.evaluate(`grid.getHexagon({x:7,y:4}).playerColor=0; globalThis.mine=new Goldmine(7,4,50); undefined`);
  f.compare('mine-is-neutral-and-not-hitable',f.evaluate('({role:mine.player.role,hitable:mine.isHitable})'),{role:'NEUTRAL',hitable:false});
  f.compare('demon-targets-human-town-over-nearer-neutral-goldmine',f.evaluate(target({x:7,y:5},3)),{x:7,y:1});
  f.compare('pathing-unchanged-mine-not-ignored-cell',f.evaluate('players[3].ignoresCell(grid.getCell({x:7,y:4}))'),false);
  f.compare('human-still-targets-neutral-goldmine',f.evaluate(target({x:7,y:5},1)),{x:7,y:4});
  // A demon standing on the mine route still reaches the human town through it.
  f.evaluate(`for(let x=0;x<9;x++) for(let y=0;y<7;y++)
    if(x!==7 && !(x===1&&y===1) && !(x===4&&y===5)) grid.setBuilding(new Sea(x,y),{x,y}); undefined`);
  f.compare('corridor-through-mine-targets-human-town',f.evaluate(target({x:7,y:5},3)),{x:7,y:1});
}
{
  const f=fixture();
  // Only neutral objectives remain: the mine must not replace them as objective.
  f.evaluate(`for(const p of players.slice(1,3)) {for(const t of [...p.towns]) t.destroy(); for(const u of [...p.units]) u.kill();}
    grid.getHexagon({x:7,y:4}).playerColor=0; new Goldmine(7,4,50); undefined`);
  f.compare('neutral-goldmine-only-objective',f.evaluate(target({x:7,y:5},3)),null);
}
{
  const f=fixture();
  // Mine owned by the human whose town lies behind it: still never an objective.
  f.evaluate(`grid.getHexagon({x:7,y:4}).playerColor=2; globalThis.mine=new Goldmine(7,4,50); undefined`);
  f.compare('mine-is-human-owned',f.evaluate('mine.player.role'),'HUMAN');
  f.compare('demon-targets-human-town-over-nearer-human-goldmine',f.evaluate(target({x:7,y:5},3)),{x:7,y:1});
  f.compare('pathing-unchanged-human-mine-not-ignored-cell',f.evaluate('players[3].ignoresCell(grid.getCell({x:7,y:4}))'),false);
  f.compare('human-objectives-unchanged-for-human-mine',
    f.evaluate('players[1].ignoresObjective(grid.getCell({x:7,y:4}))===players[1].ignoresCell(grid.getCell({x:7,y:4}))'),true);
}
{
  const f=fixture();
  // Mine of an eliminated human: the demon goes for the surviving human town instead.
  f.evaluate(`grid.getHexagon({x:7,y:4}).playerColor=2; new Goldmine(7,4,50);
    for(const t of [...players[2].towns]) t.destroy(); for(const u of [...players[2].units]) u.kill(); undefined`);
  f.compare('demon-targets-surviving-town-over-eliminated-owner-goldmine',f.evaluate(target({x:7,y:5},3)),{x:1,y:1});
}
{
  const f=fixture(false);
  // Without co-op no player is DEMONS; the mine stays the nearest objective.
  f.evaluate(`grid.getHexagon({x:7,y:4}).playerColor=0; new Goldmine(7,4,50); undefined`);
  f.compare('non-coop-ai-targets-neutral-goldmine',f.evaluate(target({x:7,y:5},3)),{x:7,y:4});
}
console.log('PASS demon-neutral-goldmines human_town_over_mine=1 corridor=1 neutral_only=1 human_control=1 non_coop_control=1 human_owned_mine=1 eliminated_owner_mine=1');
