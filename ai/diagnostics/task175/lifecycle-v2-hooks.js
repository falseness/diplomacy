'use strict';
const assert = require('node:assert/strict');
const esprima = require('/usr/share/nodejs/esprima');
const R = 'globalThis.__task175v2';
// Every anchor must be unique in its explicitly selected module. Instrumentation
// is opt-in source-body insertion; no replacement emitters, timers or handlers.
function transform(source, specs, points = []) {
    const tokens = esprima.tokenize(source, {range:true, tolerant:true}), edits = [], manifest = [];
    for (const [hook, anchor, context, packet = 'null', parent = 'null', async = false, reason = 'undefined'] of specs) {
        const start = source.indexOf(anchor);
        assert(start >= 0 && source.indexOf(anchor, start + 1) < 0, 'CAPTURE_CONTRACT missing/nonunique hook ' + hook);
        const at = start + anchor.length - 1;
        assert.equal(source[at], '{', hook);
        let end = tokens.findIndex(t => t.range[0] === at), depth = 1;
        while (depth && ++end < tokens.length) { if (tokens[end].value === '{') depth++; if (tokens[end].value === '}') depth--; }
        assert.equal(depth, 0, hook);
        const name = '__v2_' + hook.replaceAll('-', '_');
        edits.push([at + 1, `\nconst ${name}=${R}.enter(${JSON.stringify(hook)},${context},${packet},${parent},${async},${reason});try {\n`]);
        edits.push([tokens[end].range[0], `\n}finally{${R}.leave(${name});}\n`]);
        manifest.push({hook, anchor, bodyStart:at, bodyEnd:tokens[end].range[0], async});
    }
    for (const [hook, anchor, insertion, before = false] of points) {
        const start = source.indexOf(anchor);
        assert(start >= 0 && source.indexOf(anchor, start + 1) < 0, 'CAPTURE_CONTRACT missing/nonunique hook ' + hook);
        edits.push([start + (before ? 0 : anchor.length), '\n' + insertion + '\n']);
        manifest.push({hook, anchor, at:start, point:true});
    }
    let text = source;
    for (const [at, insert] of edits.sort((a,b) => b[0]-a[0])) text = text.slice(0,at)+insert+text.slice(at);
    return {text, manifest};
}
const E = '{engine:this,transport:this.transport}', S = '{socket:this}', M = '{manager:this}', T = '{engine:this.socket,transport:this}';
const expectedClient = ['manager-close','manager-reconnect','manager-reconnect-result','manager-error','encoding','application-emit','socket-packet','buffer-drain','application-packet','engine-open','engine-close','engine-error','heartbeat','engine-packet','engine-packet-create','upgrade','transport-send','transport-close','transport-error','polling-wire','polling-write','polling-encode-complete','polling-write-complete','request-create','request-success','request-error','request-abort','websocket-write','websocket-encode-complete','websocket-send','websocket-send-error','websocket-close'];
const expectedServer = ['server-wire','dispatch-binding','handler-invocation-end','opening-wait-emission','server-engine-decode','server-engine-error','server-engine-close','server-upgrade','server-decoder','server-socket-event','server-dispatch','handler-invocation','handler-receipt','queue-entry','queue-execution','game-queue-entry','game-queue-execution','assignment','opening-emission'];
function client(source) {
    // Select module spans in the pinned development bundle so duplicate method
    // signatures are never resolved by a first-match guess.
    const modules = [
        ['./build/manager.js', [
            ['manager-close','value: function onclose(reason) {',M,'null','null',false,'reason'],
            ['manager-reconnect','value: function reconnect() {',M],
            ['manager-reconnect-result','self.open(function (err) {','{manager:self}','null','null',false,'err'],
            ['manager-error','value: function onerror(err) {',M,'null','null',false,'err'],
            ['encoding','value: function _packet(packet) {',M,'packet'],
        ], []],
        ['./build/socket.js', [
            ['application-emit','value: function emit(ev) {',S],
            ['socket-packet','value: function packet(_packet) {',S,'_packet'],
            ['buffer-drain','value: function emitBuffered() {',S],
        ], [['application-packet','packet.options = {};',`${R}.bind(packet,__v2_application_emit);${R}.event('application-packet',{socket:this},packet,__v2_application_emit);`]]],
        ['./node_modules/engine.io-client/lib/socket.js', [
            ['engine-open','value: function onOpen() {',E],
            ['engine-close','value: function onClose(reason, desc) {',E,'null','null',false,'reason'],
            ['engine-error','value: function onError(err) {',E,'null','null',false,'err'],
            ['heartbeat','this.pingTimeoutTimer = setTimeout(function () {','{engine:_this2}','null','null',false,'"ping timeout"'],
            ['engine-packet','value: function onPacket(packet) {',E,'packet'],
        ], [
            ['engine-packet-create','this.emit("packetCreate", packet);',`${R}.bind(packet,${R}.event('engine-packet-create',${E},packet,null));`,true],
            ['upgrade','self.emit("upgrade", transport);',`${R}.event('upgrade',{engine:self,transport},null,null);`,true],
        ]],
        ['./node_modules/engine.io-client/lib/transport.js', [
            ['transport-send','value: function send(packets) {',T],
            ['transport-close','value: function onClose() {',T],
            ['transport-error','value: function onError(msg, desc) {',T,'null','null',false,'msg'],
        ], []],
        ['./node_modules/engine.io-client/lib/transports/polling.js', [
            ['polling-write','value: function write(packets) {',T],
            ['polling-encode-complete','parser.encodePayload(packets, function (data) {','{engine:_this.socket,transport:_this}','null','__v2_polling_write'],
            ['polling-write-complete','_this.doWrite(data, function () {','{engine:_this.socket,transport:_this}','null','__v2_polling_write'],
        ], [['polling-wire','_this.doWrite(data, function () {',`String(data).split('\\x1e').forEach((part,index)=>${R}.wire('polling-wire',{engine:_this.socket,transport:_this},_this,'sent',part,index,${R}.parent(packets[index])));`,true]]],
        ['./node_modules/engine.io-client/lib/transports/polling-xhr.js', [
            ['request-create','value: function create() {','{request:this,engine:this.opts.socket}'],
            ['request-success','value: function onSuccess() {','{request:this,engine:this.opts.socket}'],
            ['request-error','value: function onError(err) {','{request:this,engine:this.opts.socket}'],
            ['request-abort','value: function abort() {','{request:this,engine:this.opts.socket}'],
        ], []],
        ['./node_modules/engine.io-client/lib/transports/websocket.js', [
            ['websocket-write','value: function write(packets) {',T],
            ['websocket-encode-complete','parser.encodePacket(packet, self.supportsBinary, function (data) {','{engine:self.socket,transport:self}','packet'],
            ['websocket-close','value: function onClose() {',T],
        ], [
            ['websocket-send','self.ws.send(data);',`${R}.wire('websocket-send',{engine:self.socket,transport:self},self.ws,'sent',data,i,${R}.parent(packet));`,true],
            ['websocket-send-error','debug("websocket closed before onclose event");',`${R}.event('websocket-send-error',{engine:self.socket,transport:self},null,null);`,true],
        ]],
    ];
    let text = source; const manifest = [];
    for (const [name, specs, points] of modules) {
        const header = '/***/ "' + name + '":'; const start = text.indexOf(header);
        assert(start >= 0, 'CAPTURE_CONTRACT module ' + name);
        const endAt = text.indexOf('\n/***/ "', start + header.length), end = endAt < 0 ? text.length : endAt;
        const result = transform(text.slice(start,end), specs, points);
        text = text.slice(0,start)+result.text+text.slice(end);
        manifest.push(...result.manifest.map(m => ({module:name,...m})));
    }
    return {text, manifest};
}
function server(file, source) {
    if (file.endsWith('/engine.io/build/socket.js')) return transform(source,[
        ['server-engine-decode','onPacket(packet) {',E,'packet'],
        ['server-engine-error','onError(err) {',E,'null','null',false,'err'],
        ['server-engine-close','onClose(reason, description) {',E,'null','null',false,'reason'],
    ], [['server-wire','switch (packet.type) {',`${R}.wire('server-wire',${E},packet,'received',packet.type==='message'?'4'+packet.data:String(packet.type),0,__v2_server_engine_decode);`,true], ['server-upgrade','this.emit("upgrade", transport);',`${R}.event('server-upgrade',{engine:this,transport},null,null);`,true]]);
    if (file.endsWith('/socket.io/dist/client.js')) return transform(source,[
        ['server-decoder','ondecoded(packet) {','{engine:this.conn}','packet'],
    ]);
    if (file.endsWith('/socket.io/dist/socket.js')) return transform(source,[
        ['server-socket-event','onevent(packet) {',S,'packet'],
        ['server-dispatch','dispatch(event) {',S,'event'],
    ], [
        ['dispatch-binding','this.dispatch(args);',`${R}.bind(args,__v2_server_socket_event);`,true],
        ['handler-invocation','super.emitUntyped.apply(this, event);',`{const __v2_invoke=${R}.enter('handler-invocation',{socket:this},null,__v2_server_dispatch);try{`,true],
        ['handler-invocation-end','super.emitUntyped.apply(this, event);',`}finally{${R}.leave(__v2_invoke);}}`],
    ]);
    if (file.endsWith('/server/index.js')) return transform(source,[
        ['handler-receipt','socket.on("startGameOrConnect", async (json_string) => {','{socket}','null','null',true],
        ['queue-execution','socket.on("startGameOrConnect", async (json_string) => {\n        try {\n            await enqueueMatchmakingOperation(async () => {','{socket}','null','__v2_handler_receipt',true],
        ['game-queue-execution','trackSocketAssignment(socket, gameID, userId)\n                await enqueueGameOperation(gameID, async () => {','{socket}','null','__v2_handler_receipt',true],
    ], [
        ['queue-entry','socket.on("startGameOrConnect", async (json_string) => {\n        try {',`${R}.event('queue-entry',{socket},{data:['startGameOrConnect',json_string]},__v2_handler_receipt);`],
        ['assignment','trackSocketAssignment(socket, gameID, userId)\n                await',`${R}.event('assignment',{socket},null,__v2_handler_receipt);`,true],
        ['game-queue-entry','                await enqueueGameOperation(gameID, async () => {',`${R}.event('game-queue-entry',{socket},null,__v2_handler_receipt);`,true],
        ['opening-emission','socket.emit(socketCommand, JSON.stringify(emittedGameObject))',`${R}.event('opening-emission',{socket},null,__v2_handler_receipt);`,true],
        ['opening-wait-emission','socket.emit("waitYouTurn", JSON.stringify(stampCoopRevision(game, waitingGameObject)))',`${R}.event('opening-emission',{socket},null,__v2_handler_receipt);`,true],
    ]);
    return null;
}
module.exports = {client,server,transform,expectedClient,expectedServer};
