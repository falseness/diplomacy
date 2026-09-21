'use strict';
const assert = require('node:assert/strict');
const esprima = require('/usr/share/nodejs/esprima');
// Token ranges avoid guessing braces inside strings/comments/templates. No
// callback, emitter or timer is replaced: only the existing body is bracketed.
function bracket(source, specs) {
    const tokens=esprima.tokenize(source,{range:true,tolerant:true});
    const edits=[], manifest=[];
    for(const [hook,anchor,engine,transport,sid='null',detail='null'] of specs) {
        const start=source.indexOf(anchor); assert(start>=0 && source.indexOf(anchor,start+1)<0,'unique hook '+hook);
        const at=start+anchor.length-1;assert.equal(source[at],'{');
        const begin=tokens.findIndex(t=>t.range[0]===at);assert(begin>=0,hook);
        let depth=1,end=begin;
        while(depth && ++end<tokens.length){if(tokens[end].value==='{')depth++;if(tokens[end].value==='}')depth--;}
        assert.equal(depth,0,hook);
        const close=tokens[end].range[0];
        edits.push([at+1,`\nconst __t175=globalThis.__task175.enter(${JSON.stringify(hook)},${engine},${transport},${sid},${detail});try {\n`]);
        edits.push([close,'\n} finally {globalThis.__task175.leave(__t175);}\n']);
        manifest.push({hook,anchor,bodyStart:at,bodyEnd:close});
    }
    let text=source;for(const [at,insert] of edits.sort((a,b)=>b[0]-a[0]))text=text.slice(0,at)+insert+text.slice(at);
    return {text,manifest};
}
const clientSpecs=[
 ['pollComplete','this.once("pollComplete", function () {','self.socket','self'],
 ['pause-drain','debug("we are currently writing - waiting to pause");\n          total++;\n          this.once("drain", function () {','self.socket','self'],
 ['engine-drain','transport.on("drain", function () {','self','transport'],
 ['probe-close','function onTransportClose() {','self','transport'],
 ['probe-packet','transport.once("packet", function (msg) {','self','transport','null','msg.type'],
 ['pause-complete','self.transport.pause(function () {','self','self.transport'],
 ['heartbeat','this.pingTimeoutTimer = setTimeout(function () {','_this2','_this2.transport'],
 ['engine-close','value: function onClose(reason, desc) {','this','this.transport','null','reason'],
 ['handshake','value: function onHandshake(data) {','this','this.transport','data.sid'],
 ['manager-close','value: function onclose(reason) {\n      debug("close");','this.engine','this.engine && this.engine.transport'],
 ['manager-reconnect','value: function reconnect() {','this.engine','this.engine && this.engine.transport'],
 ['reconnect-timer','this._reconnecting = true;\n        var timer = setTimeout(function () {','self.engine','self.engine && self.engine.transport'],
 ['reconnect-result','self.open(function (err) {','self.engine','self.engine && self.engine.transport'],
];
// The onclose signature is duplicated (Manager/Socket), use a distinctive anchor
// ending at the brace, located in Manager's module only.
clientSpecs[9][1]='value: function onclose(reason) {';
function client(source) {
    const split=source.indexOf('/***/ "./build/on.js":');assert(split>0);
    const manager=bracket(source.slice(0,split),clientSpecs.filter(x=>x[0].startsWith('manager-')||x[0].startsWith('reconnect-')));
    const engine=bracket(source.slice(split),clientSpecs.filter(x=>!x[0].startsWith('manager-')&&!x[0].startsWith('reconnect-')));
    return {text:manager.text+engine.text,manifest:[...manager.manifest,...engine.manifest]};
}
const serverSpecs=[
 ['server-upgrade-packet','const onPacket = (packet) => {','this','transport','null','packet.type'],
 ['server-probe-close','const onTransportClose = () => {','this','transport'],
 ['server-upgrade-timeout','const upgradeTimeoutTimer = (0, timers_1.setTimeout)(() => {','this','transport'],
 ['server-close','onClose(reason, description) {','this','this.transport','null','reason'],
];
function server(source){const result=bracket(source,serverSpecs);const anchor='this.emit("upgrade", transport);';assert.equal(result.text.split(anchor).length,2);
    result.text=result.text.replace(anchor,'const __accepted=globalThis.__task175.enter("server-upgrade-accepted",this,transport);try {'+anchor+'} finally {globalThis.__task175.leave(__accepted);}');return result;}
function app(source){return bracket(source,[
 ['join-receipt','socket.on("startGameOrConnect", async (json_string) => {','socket.conn','socket.conn.transport'],
 ['join-queued','socket.on("startGameOrConnect", async (json_string) => {\n        try {\n            await enqueueMatchmakingOperation(async () => {','socket.conn','socket.conn.transport'],
 ['join-game-queued','trackSocketAssignment(socket, gameID, userId)\n                await enqueueGameOperation(gameID, async () => {','socket.conn','socket.conn.transport'],
 ]);}
module.exports={bracket,client,server,app};
