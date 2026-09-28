'use strict';
// Opt-in instrumentation of one hash-pinned test helper, never served gameplay.
// Original inputs/assertions remain in place. Callback calls retain bare fn(body)
// semantics through the reviewed passive adapter and are source-tier only.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const FILE='/root/diplomacy_server/tests/reliability/helpers/terminal-flow-next-game.js';
const PIN='31eff97d53f66a02be409405456c70e65397fdd029327f3d357ca861769d79e8';
function instrument(source) {
 assert.equal(hash(source),PIN,'unreviewed AC3 helper');
 const replace=(from,to)=>{assert.equal(source.split(from).length,2,'unique AC3 boundary '+from);source=source.replace(from,to);};
 replace(' const terminal=await find();',` const terminal=await find();
 const capture=require('/root/diplomacy/ops/terminal_ac3_provider').recorder({ps,service,trace},mode,terminal);`);
 replace("  await p.tapControl('backToMenuButton'", "  await capture.retain(p);\n  await p.tapControl('backToMenuButton'");
 replace("  await p.tapControl('menu.main.buttons[1]'", "  await capture.page(p,'menu-after');\n  await p.tapControl('menu.main.buttons[1]'");
 // Preserve the two AC2 stable observations; replace only the four later
 // localGameplay reads with the passive page projection.
 assert.equal(source.split('obs.localGameplay(await p.observe(OBSERVE))').length,5);
 source=source.replaceAll('obs.localGameplay(await p.observe(OBSERVE))',
  'obs.localGameplay(await p.observe(() => globalThis.__terminalPassive.gameplay()))');
 replace(' const before=obs.localGameplay'," await capture.pair('first-move-before');\n const before=obs.localGameplay");
 replace(" check('new-first-move'", " await capture.pair('first-move-after');\n check('new-first-move'");
 replace(' await p.page.evaluate(body=>globalThis.__oldCallbacks.forEach(fn=>fn(body)),oldBoard);',
  " await capture.pair('callbacks-before');\n for(const participant of ps)await capture.invoke(participant,oldBoard);\n await capture.pair('callbacks-after');");
 return source;
}
function recorder({ps,service,trace},mode,terminal) {
 const sessions=new Map(ps.map(p=>[p.name,crypto.randomUUID()]));let sequence=0;
 trace('ac3-install',{mode,helperSha256:PIN,instrumentedSha256:hash(instrument(fs.readFileSync(FILE,'utf8'))),
  providerSha256:hash(fs.readFileSync(__filename)),tier:'browser-menu-and-movement;source-executed-callbacks'});
 const emit=r=>trace('ac3-passive',{sequence:++sequence,mode,...r});
 async function page(p,boundary) {
  const raw=await p.page.evaluate(()=>globalThis.__terminalPassive.read());
  const connection=await p.page.evaluate(()=>({mode:gameSettings.coop?'coop':'competitive',lobby:onlineLobby}));
  emit({kind:'page',boundary,participant:p.name,session:sessions.get(p.name),raw,connection});
 }
 async function pair(boundary) {
  for(const p of ps)await page(p,boundary);
  const docs=await service.mongo.db(service.databaseName).collection('games').find({}).toArray();
  emit({kind:'persistence',boundary,documents:docs});
 }
 async function retain(p) {
  const retained=await p.page.evaluate(()=>globalThis.__terminalPassive.retain());
  emit({kind:'retained',participant:p.name,session:sessions.get(p.name),retained,oldGameId:terminal.gameID});
  await page(p,'menu-before');
 }
 async function invoke(p,body) {
  const invoked=await p.page.evaluate(body=>globalThis.__terminalPassive.invoke(body),body);
  emit({kind:'invoked',participant:p.name,session:sessions.get(p.name),invoked,body,
   tier:'source-executed-callbacks'});
 }
 return {page,pair,retain,invoke};
}
function install() {
 const Module=require('node:module'),load=Module._extensions['.js'];
 assert(!require.cache[FILE],'AC3 must precede helper load');
 Module._extensions['.js']=function(module,filename) {
  if(filename!==FILE)return load(module,filename);
  Module._extensions['.js']=load;
  return module._compile(instrument(fs.readFileSync(filename,'utf8')),filename);
 };
 require('./terminal_ac2_provider').install();
}
if(process.env.TERMINAL_AC3_CAPTURE==='1'&&path.basename(process.argv[1]||'')==='terminal-flow.test.js')install();
module.exports={instrument,recorder,install,FILE,PIN};
