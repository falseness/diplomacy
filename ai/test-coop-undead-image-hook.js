const fs = require('fs');
const path = require('path');
const {createFixture, defaultFixture} = require('./test-coop-harness');

// Demon-owned ordinary units use the undead art key (undead/<name>, mirrored
// KOHb/catapult add 'Left'); human-owned units and the demon variants keep
// their own key, and owner never changes stats. No browser. Usage:
//   node ai/test-coop-undead-image-hook.js [--output-dir <dir>]
const arg = name => { const i = process.argv.indexOf(name); return i < 0 ? null : process.argv[i + 1]; };
const output = arg('--output-dir');
const root = path.resolve(__dirname, '..');

const CLASSES = [['Noob', 'noob'], ['Archer', 'archer'], ['KOHb', 'KOHb'],
  ['Normchel', 'normchel'], ['Catapult', 'catapult']];
const VARIANTS = [['Imp', 'imp'], ['Hound', 'hound'], ['Ravager', 'ravager'], ['Bombard', 'bombard']];
const HUMAN = 1, DEMON = 3;

const config = defaultFixture(); config.coop = true; config.actors[3].units = [];
const f = createFixture(config, () => {});
f.evaluate(`globalThis.freeCells=[]; for(let x=0;x<grid.arr.length;x++) for(let y=0;y<grid.arr[x].length;y++) {
    const c={x,y}; if(grid.getUnit(c).notEmpty() || grid.getBuilding(c).notEmpty()) continue; freeCells.push(c) }
  globalThis.spawn=(cls, owner, mirrorX)=>{ const c=freeCells.shift(); grid.getHexagon(c).firstpaint(owner);
    const u=new (eval(cls))(c.x,c.y); if(mirrorX) u.mirrorX=true; return u };
  globalThis.describe=u=>({cls:u.constructor.name, owner:u.playerColor, role:u.player.role, at:{...u.coord},
    mirrorX:!!u.mirrorX, key:u.bodyImageName, gridKey:grid.getEntityBodyImageName(u),
    portrait:u.info.bodyImageName,
    stats:{maxHP:u.maxHP, healSpeed:u.healSpeed, dmg:u.dmg, speed:u.speed,
      range:u.range === undefined ? null : u.range, salary:u.salary}}); undefined`);
const spawn = (cls, owner, mirror = false) =>
  f.evaluate(`describe(spawn(${JSON.stringify(cls)}, ${owner}, ${mirror}))`);

const units = [];
let failed = 0;
function check(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(detail)}`);
  if (!ok) failed++;
}
const keysMatch = (u, key) => u.key === key && u.gridKey === key && u.portrait === key;

if (f.evaluate(`players[${DEMON}].role`) !== 'DEMONS' || f.evaluate(`players[${HUMAN}].role`) !== 'HUMAN')
  throw new Error('fixture roles: expected slot 1 HUMAN and slot 3 DEMONS');

for (const [cls, name] of CLASSES) {
  const human = spawn(cls, HUMAN), demon = spawn(cls, DEMON);
  units.push(human, demon);
  check(`class ${cls} human key=${name} demon key=undead/${name}, stats equal`,
    keysMatch(human, name) && keysMatch(demon, 'undead/' + name) &&
    JSON.stringify(human.stats) === JSON.stringify(demon.stats), {human, demon});
}
for (const [cls, name] of [['KOHb', 'KOHb'], ['Catapult', 'catapult']]) {
  const human = spawn(cls, HUMAN, true), demon = spawn(cls, DEMON, true);
  units.push(human, demon);
  check(`mirrored ${cls} human key=${name}Left demon key=undead/${name}Left`,
    keysMatch(human, name + 'Left') && keysMatch(demon, `undead/${name}Left`) &&
    JSON.stringify(human.stats) === JSON.stringify(demon.stats), {human, demon});
}
for (const [cls, name] of VARIANTS) {
  const plain = spawn(cls, DEMON);
  units.push(plain);
  let ok = keysMatch(plain, name), detail = {plain};
  if (cls !== 'Imp') {
    const mirrored = spawn(cls, DEMON, true);
    units.push(mirrored);
    ok = ok && keysMatch(mirrored, name + 'Left');
    detail.mirrored = mirrored;
  }
  check(`demon variant ${cls} keeps key ${name}`, ok, detail);
}

// Every undead key is a real file, is loaded from assets/undead/ for both
// sprite themes and is counted by the image loader and cache.
const assetsInfo = f.evaluate(`(()=>{ const res={keys:undeadSpriteImages.slice(), inImages:undeadSpriteImages.every(k=>images.includes(k)),
    themes:{} };
  for(const polished of [true,false]) { otherSettings.usePolishedSprites=polished; loadSprites();
    res.themes[polished?'sprites':'spritesOld']=Object.fromEntries(undeadSpriteImages.map(k=>[k,assets[k].src])) }
  return res })()`);
const files = assetsInfo.keys.map(k => ({key: k, file: `assets/${k}.svg`,
  exists: fs.existsSync(path.join(root, 'assets', k + '.svg'))}));
const expectedKeys = ['undead/noob', 'undead/archer', 'undead/KOHb', 'undead/KOHbLeft',
  'undead/normchel', 'undead/catapult', 'undead/catapultLeft'];
check('asset files: every undeadSpriteImages key maps to an existing file loaded for both themes',
  JSON.stringify(assetsInfo.keys) === JSON.stringify(expectedKeys) && assetsInfo.inImages &&
  files.every(x => x.exists) && Object.values(assetsInfo.themes).every(t =>
    Object.entries(t).every(([k, src]) => src === `assets/${k}.svg`)), {files, ...assetsInfo});

if (output) {
  fs.mkdirSync(output, {recursive: true});
  fs.writeFileSync(path.join(output, 'hook.json'), JSON.stringify({pass: failed === 0,
    units: units.map(u => ({class: u.cls, owner: u.owner, role: u.role, mirrorX: u.mirrorX,
      imageKey: u.key, gridKey: u.gridKey, portraitKey: u.portrait, stats: u.stats})),
    assets: files}, null, 2));
}
console.log(failed ? `FAIL ${failed} case(s)` : 'PASS all undead image hook cases');
process.exit(failed ? 1 : 0);
