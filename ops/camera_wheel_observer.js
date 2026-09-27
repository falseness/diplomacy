'use strict';
// The retained online-zoom harness observes the legacy mousewheel event. The
// shipped client now consumes standard wheel. Replace only that test counter's
// listener before the harness installs it; keep real input and all assertions.
const controls=require('/root/diplomacy_server/tests/reliability/helpers/online-zoom-controls');
async function install(player){
 await player.page.evaluate(()=>{
  if(window.__zoomWheels===undefined){
   window.__zoomWheels=0;window.__task225WheelEvents=[];
   document.addEventListener('wheel',event=>{
    window.__zoomWheels++;
    window.__task225WheelEvents.push({time:performance.now(),deltaY:event.deltaY,trusted:event.isTrusted});
   },{passive:true});
  }
 });
}
const original=controls.phase;
controls.phase=async function(players,label,...args){
 for(const player of players)await install(player);
 try{return await original(players,label,...args);}
 catch(error){for(const player of players)await captureFailure(player,'phase/'+label);throw error;}
 finally{for(const player of players){const events=await player.page.evaluate(()=>window.__task225WheelEvents||[]).catch(()=>[]);player.trace({action:'observed-standard-wheel',phase:label,events});}}
};
module.exports={install};

// Cold menu pages are independent. Prepare exactly the same four contexts
// together before the first menu rejoin starts its finite gameplay clock.
// Subsequent reconnect inputs and actions remain in the original suite order.
function pooledOpen(open){
 const pools=new WeakMap();
 return async function(browser,options){
  if(!options.screenshotDir.endsWith('/coop-zoom/screenshots'))return open(browser,options);
  let pool=pools.get(browser);
  if(!pool){
   if(options.name!=='p1')throw Error('camera opening must begin with p1');
   const startedAt=Date.now();
   pool={next:0,endpoint:options.endpoint,clientUrl:options.clientUrl,errors:options.errors,
    ready:Promise.allSettled([1,2,3,4].map(n=>open(browser,{...options,name:'p'+n,input:n===2?'touch':'mouse'}))).then(results=>{
     const failed=results.find(r=>r.status==='rejected');if(failed)throw failed.reason;
     const players=results.map(r=>r.value);for(const p of players)p.trace({action:'parallel-menu-pages-ready',startedAt,finishedAt:Date.now(),participants:4});return players;
    })};pools.set(browser,pool);
  }
  if(options.name!=='p'+(pool.next+1)||options.endpoint!==pool.endpoint||options.clientUrl!==pool.clientUrl||options.errors!==pool.errors)throw Error('changed camera opening contract');
  const index=pool.next++;return (await pool.ready)[index];
 };
}
const {BrowserPlayer}=require('/root/diplomacy_server/tests/reliability/helpers/browser-driver');
BrowserPlayer.open=pooledOpen(BrowserPlayer.open.bind(BrowserPlayer));
module.exports.pooledOpen=pooledOpen;

// BrowserPlayer.open has already loaded and verified the initial menu. Use the
// shared helper's supported mode for that initial join only. A later recovery
// still performs its real reload and all original menu inputs.
function reuseInitialMenu(reconnect){
 const joined=new WeakSet();
 return async function(player,options){
  if(!player.screenshotDir.endsWith('/coop-zoom/screenshots'))return reconnect(player,options);
  const initial=!joined.has(player);joined.add(player);
  const reuse=initial&&player.input!=='touch';
  if(initial)player.trace({action:reuse?'initial-menu-already-loaded':'initial-menu-reload-retained'});
  return reconnect(player,reuse?{...options,alreadyAtMenu:true}:options);
 };
}
const recovery=require('/root/diplomacy_server/tests/reliability/helpers/movement-identity-reconnect');
recovery.reconnect=reuseInitialMenu(recovery.reconnect);
module.exports.reuseInitialMenu=reuseInitialMenu;

async function captureFailure(player,operation){
 const state=await player.page.evaluate(()=>({time:performance.now(),menuVisible:menu.visible,atStart:menu.selectedTree===menu.startGame,connected:!!onlineSocket?.connected,slot:whooseTurn,round:gameRound,scale:canvas.scale,offset:{...canvas.offset},selected:gameEvent.selected?.name??null,clock:{ticking:timer.isTick,left:timer.timeLeft},commit:{canClick:nextTurnButton.canClick,unactive:nextTurnButton.unactive,waiting:gameEvent.waitingMode},viewport:{width:innerWidth,height:innerHeight,pageScale:visualViewport.scale}})).catch(error=>({captureError:error.message}));
 player.trace({action:'pre-teardown-failure',operation,state});
 // Do not capture credential-entry menus. Read-only state above contains no credentials.
 if(state.menuVisible===false)await player.screenshot('pre-teardown-failure').catch(()=>{});
}
const settle=BrowserPlayer.prototype.settle;
BrowserPlayer.prototype.settle=async function(...args){try{return await settle.apply(this,args);}catch(error){await captureFailure(this,'input-settle');throw error;}};

// Overlay dismissal deliberately disables Commit for one second. The original
// camera helper waits for p2 readiness but omits that condition for p3/p4.
function readyParticipantCommit(tapControl){
 return async function(expression,label,...args){
  if(this.screenshotDir.endsWith('/coop-zoom/screenshots')&&expression==='nextTurnButton'&&label==='commit participant'){
   try{await this.page.waitForFunction(()=>nextTurnButton.canClick&&!nextTurnButton.unactive,null,{timeout:10000});}
   catch(error){await captureFailure(this,'participant-commit-readiness').catch(()=>{});throw error;}
   this.trace({action:'participant-commit-ready',state:await this.observe(()=>({canClick:nextTurnButton.canClick,unactive:nextTurnButton.unactive,waiting:gameEvent.waitingMode}))});
  }
  return tapControl.call(this,expression,label,...args);
 };
}
BrowserPlayer.prototype.tapControl=readyParticipantCommit(BrowserPlayer.prototype.tapControl);
module.exports.readyParticipantCommit=readyParticipantCommit;

// Preserve safe structured HTTP error facts before service teardown. Never log
// response bodies, URLs, credentials or successful gameplay payloads.
function observeHttpFailures(player){
 player.page.on('response',async response=>{
  if(response.status()<400)return;
  let body;try{body=await response.json();}catch{}
  const code=typeof body?.code==='number'?body.code:null;
  const message=['Session ID unknown','Bad request','Forbidden','Transport unknown'].includes(body?.message)?body.message:null;
  player.trace({action:'http-error-response',status:response.status(),code,message});
 });
 return player;
}
const opened=BrowserPlayer.open;
BrowserPlayer.open=async(...args)=>observeHttpFailures(await opened(...args));
module.exports.observeHttpFailures=observeHttpFailures;

// Only p1 needs active stale-receipt replay. Peer traffic can travel directly to
// the same real HTTPS server while retaining complete request/response packets.
function passivePeerTransport(player,trace){
 const packets=[],turns=[],failures=[],pending=new Set();let closed=false,delivered=0;
 const request=req=>{
  if(!req.url().includes('/socket.io/'))return;
  for(const packet of (req.postData()||'').split('\x1e'))if(packet.startsWith('42["nextTurn"')){
   turns.push(JSON.parse(packet.slice(2))[1]);trace('outgoing-turn',{packet});
  }
 };
 const response=res=>{
  if(!res.url().includes('/socket.io/'))return;
  const work=(async()=>{try{
   const body=await res.text();
   if(res.status()>=400){failures.push('HTTP '+res.status());trace('peer-http-failure',{player:player.name,status:res.status()});}
   for(const packet of body.split('\x1e'))if(/^42\["(?:gameStarted|playYourTurn|waitYouTurn)"/.test(packet)){packets.push(packet);trace('upstream-receipt',{packet,suppressed:false});}
  }catch(error){if(!closed){failures.push(error.message);trace('peer-response-failure',{player:player.name,error:error.message});}}})();
  pending.add(work);work.finally(()=>pending.delete(work));
 };
 const failed=req=>{if(!closed&&req.url().includes('/socket.io/')){const error=req.failure()?.errorText||'request failed';failures.push(error);trace('peer-request-failure',{player:player.name,error});}};
 const consoleMessage=m=>{if(['gameStarted','playYourTurn','waitYouTurn'].includes(m.text()))delivered++;};
 for(const [event,fn] of [['request',request],['response',response],['requestfailed',failed],['console',consoleMessage]])player.page.on(event,fn);
 player.trace({action:'native-peer-transport',mode:'passive HTTPS polling observation'});
 return {packets,turns,failures,delivered:()=>delivered,async close(){closed=true;for(const [event,fn] of [['request',request],['response',response],['requestfailed',failed],['console',consoleMessage]])player.page.off(event,fn);await Promise.allSettled([...pending]);trace('proxy-cleanup',{closed:true,mode:'native-peer-observation'});}};
}
const inflight=require('/root/diplomacy_server/tests/reliability/helpers/inflight-transport'),intercepted=inflight.create;
inflight.create=async(player,ca,trace)=>player.screenshotDir.endsWith('/coop-zoom/screenshots')&&['p2','p3','p4'].includes(player.name)?passivePeerTransport(player,trace):intercepted(player,ca,trace);
module.exports.passivePeerTransport=passivePeerTransport;
