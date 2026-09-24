'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
process.env.PLAYWRIGHT_BROWSERS_PATH ??= '0';
const {chromium}=require('playwright');
const {startClientServer}=require('../../diplomacy_server/tests/reliability/helpers/browser-driver');
const out=process.argv[2],write=(n,x)=>fs.writeFileSync(path.join(out,n),JSON.stringify(x,null,2)+'\n');
(async()=>{
 let client,browser;const deadline=setTimeout(()=>{console.error('FAIL browser cumulative deadline');process.exitCode=1;void browser?.close();void client?.close();},Math.min(180000,Number(process.env.TASK233_STOP_AT || Date.now()+180000)-Date.now()-1000));deadline.unref();const errors=[],requests=[];const cleanup={browserClosed:false,serverClosed:false};
 try{
 client=await startClientServer(undefined,{emptyFavicon:true});browser=await chromium.launch({headless:true});
 console.log('CHROMIUM_VERSION='+browser.version());
 const page=await browser.newPage({viewport:{width:1280,height:900}});page.setDefaultTimeout(30000);
 page.on('pageerror',e=>errors.push(e.stack));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 page.on('requestfailed',r=>errors.push(r.url()+': '+r.failure()?.errorText));
 page.on('response',r=>{requests.push({url:r.url(),status:r.status()});if(r.status()>=400)errors.push(r.url()+': '+r.status());});
 await page.goto(client.url,{waitUntil:'load'});
 await page.waitForFunction(()=>menu.visible&&imagesCountLoaded===images.length);
 const saved=JSON.parse(fs.readFileSync(path.join(out,'roundtrip.json'))).rows[0].saved;
 write('render-fixture.json',{saved,second:{owner:3,x:5,y:6,mirrorX:true},purpose:'Initial local render fixture: damaged partially spent bombard and opposite facing companion'});
 await page.evaluate(saved=>{
  loadFromJson(JSON.stringify(saved));gameSettings.isOnline=false;GameManager.load();
  grid.getHexagon({x:5,y:6}).firstpaint(3);const second=new Bombard(5,6);second.mirrorX=true;
  nextTurnPauseInterface.hideButDontUpdateTimer();gameEvent.screen.moveTo(grid.getUnit({x:4,y:6}).pos);
 },saved);
 const observed=await page.evaluate(()=>({units:[grid.getUnit({x:4,y:6}),grid.getUnit({x:5,y:6})].map(u=>({name:u.name,owner:u.playerColor,mirrorX:u.mirrorX})),
  assets:['catapult','catapultLeft'].map(n=>({name:n,loaded:assets[n].complete&&assets[n].naturalWidth>0,cached:!!cachedImages[n]})),factory:getClass('bombard')===Bombard,bodyImages:[grid.getEntityBodyImageName(grid.getUnit({x:4,y:6})),grid.getEntityBodyImageName(grid.getUnit({x:5,y:6}))]}));
 const expected={units:[{name:'bombard',owner:3,mirrorX:false},{name:'bombard',owner:3,mirrorX:true}],assets:[{name:'catapult',loaded:true,cached:true},{name:'catapultLeft',loaded:true,cached:true}],factory:true,bodyImages:['bombard','bombardLeft']};
 assert.deepEqual(observed,expected);
 const point=await page.evaluate(()=>{const p=grid.getUnit({x:4,y:6}).pos;return {x:(p.x+assets.size/2-canvas.offset.x)*canvas.scale,y:(p.y+assets.size/2-canvas.offset.y)*canvas.scale};});
 await page.mouse.click(point.x,point.y);
 await page.waitForFunction(()=>gameEvent.selected.name==='bombard');
 await page.screenshot({path:path.join(out,'bombard-render.png')});
 assert.deepEqual(errors,[]);
 write('browser-render.json',{expected,observed,selection:'bombard',input:{type:'mouse.click',...point},requests,errors,servedSources:Object.fromEntries(client.served),pass:true});
 console.log('PASS browser-render both-facing-images-loaded bombard-selected no-missing-assets-or-scripts');
 }finally{clearTimeout(deadline);if(browser){await browser.close();cleanup.browserClosed=true;}if(client){await client.close();cleanup.serverClosed=true;}write('browser-cleanup.json',cleanup);write('browser-errors.json',errors);}
})().catch(e=>{console.error(e);process.exitCode=1;});
