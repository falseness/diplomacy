'use strict';
// Passed as source to the browser. No listeners, timers, gameplay properties or
// raw credentials are added. Object relationships live exclusively in WeakMaps.
function lifecycleRecorder(secret, domain, hashFactory, limit = 200000) {
    const digestor = hashFactory(secret, domain), objects = new WeakMap(), bindings = new WeakMap(), sessions = new WeakMap();
    const rows = [], open = new Map(), pending = new Map(), counts = {}, stack = [], order = new Map();
    const requests = new WeakMap();
    let serial = 0, seq = 0, call = 0, errors = 0, overflow = false, active = true;
    const id = o => {
        if (!o || !['object', 'function'].includes(typeof o)) return null;
        if (!objects.has(o)) objects.set(o, ++serial);
        return objects.get(o);
    };
    const digest = (type, value) => value == null ? null : digestor.label(type + '\0' + String(value));
    function reason(value) {
        const absent = value === undefined || value === null;
        const known = ['ping timeout', 'transport close', 'transport error', 'forced close', 'io server disconnect', 'io client disconnect', 'upgrade', 'ping', 'pong', 'open', 'message'];
        const recognized = typeof value === 'string' && known.includes(value);
        return {value: recognized ? value : null, absent, redacted: !absent && !recognized, unknown: !recognized};
    }
    function put(row) {
        if (!active) { errors++; return; }
        if (rows.length >= limit) { overflow = true; return; }
        rows.push({seq: ++seq, domain, processClock: domain, monotonicClock: domain + ':performance', monoMs: performance.now(), ...row});
    }
    function context(c = {}) {
        const engine = c.engine || c.socket?.io?.engine || c.socket?.conn || c.manager?.engine;
        const transport = c.transport || engine?.transport;
        const raw = c.sid || engine?.id;
        if (engine && raw) sessions.set(engine, digest('session', raw));
        return {manager: id(c.manager || c.socket?.io), socket: id(c.socket), namespace: c.socket ? digest('namespace', c.socket.nsp?.name || c.socket.nsp) : null,
            engine: id(engine), session: raw ? digest('session', raw) : sessions.get(engine) || null,
            transport: id(transport), epoch: id(engine), connected: c.socket ? !!c.socket.connected : null,
            buffered: c.socket ? !c.socket.connected : null};
    }
    function enter(hook, c = {}, packet = null, parent = null, async = false, why) {
        try {
            const token = {call: ++call, hook, ...context(c), parent: parent?.call || bindings.get(packet)?.call || stack.at(-1)?.call || null, async, reason: reason(why)};
            if (c.request) {
                if (hook === 'request-create') {
                    // Request.create runs inside the actual polling write. No
                    // payload matching, current-Manager lookup or close inference.
                    const write = c.request.method === 'POST' ? stack.findLast(t => t.hook === 'polling-write') : null;
                    requests.set(c.request, {operation: write?.call || null});
                }
                const request = requests.get(c.request);
                token.request = id(c.request);
                token.operation = request?.operation || null;
                token.terminal = hook !== 'request-create' && !!c.request.xhr;
                if (token.terminal && ['request-error', 'request-abort'].includes(hook) && token.operation) {
                    if (!pending.delete(token.operation + ':write')) errors++;
                }
            }
            if (hook === 'polling-write') { pending.set(token.call + ':encode', true); pending.set(token.call + ':write', true); }
            if (hook === 'polling-encode-complete' && !pending.delete(token.parent + ':encode')) errors++;
            if (hook === 'polling-write-complete' && !pending.delete(token.parent + ':write')) errors++;
            open.set(token.call, token); counts[hook] = (counts[hook] || 0) + 1;
            put({...token, kind: 'entry'}); if (!async) stack.push(token);
            if (packet && typeof packet === 'object') bindings.set(packet, token);
            return token;
        } catch { errors++; return null; }
    }
    function leave(token) {
        if (!token) return;
        if (!open.delete(token.call)) { errors++; return; }
        if (!token.async && stack.pop() !== token) errors++;
        put({...token, kind: token.async ? 'async-complete' : 'exit'});
    }
    function bind(packet, token) { if (packet && typeof packet === 'object' && token) bindings.set(packet, token); }
    function parent(packet) { return bindings.get(packet) || null; }
    function event(hook, c, packet, token, extra = {}) {
        try {
            const t = enter(hook, c, null, token || parent(packet));
            const args = Array.isArray(packet?.data) ? packet.data : null;
            const eventName = args && ['startGameOrConnect','gameStarted','playYourTurn','waitYouTurn'].includes(args[0]) ? args[0] : null;
            put({kind: 'occurrence', hook, call: t.call, ...context(c), event: eventName,
                payload: eventName === 'startGameOrConnect' ? digest('payload', args[1]) : null,
                packet: id(packet), ...extra});
            leave(t); return t;
        } catch { errors++; return null; }
    }
    function wire(hook, c, object, direction, text, packetIndex = 0, token = null) {
        try {
            let packet = null;
            if (typeof text === 'string' && /^42/.test(text)) { try { const at = text.indexOf('['); if (at >= 0) packet = {data: JSON.parse(text.slice(at))}; } catch { errors++; } }
            const ctx = context(c), key = hook + ':' + ctx.session + ':' + direction;
            const join = packet?.data?.[0] === 'startGameOrConnect';
            const ordinal = join ? (order.get(key) || 0) + 1 : null;
            if (join) order.set(key, ordinal);
            return event(hook, c, packet, token, {object: id(object), direction, packetIndex,
                joinOrdinal: ordinal, wireDigest: typeof text === 'string' ? digest('wire', text) : null,
                binding: ctx.session ? 'session-bound' : 'unknown'});
        } catch { errors++; return null; }
    }
    return {enter, leave, bind, parent, event, wire, digest, reason,
        flush(installed = [], pendingReads = 0) {
            active = false;
            return {schema: 'lifecycle-v2', domain, processClock: domain, installed, pendingReads, flushed: true,
                finalSequence: seq, finalCount: rows.length, entered: call, exited: call - open.size,
                pendingAsync: [...pending.keys()], open: [...open.values()].map(t => ({call: t.call, hook: t.hook})), counts, errors, overflow, rows};
        }};
}
function validate(trace, expected) {
    const gaps = [];
    if (!trace || trace.schema !== 'lifecycle-v2') return ['missing lifecycle-v2 flush'];
    for (const hook of expected) if (!trace.installed.includes(hook)) gaps.push('missing hook ' + hook);
    if (!trace.flushed) gaps.push('missing flush');
    if (trace.errors || trace.overflow || trace.pendingReads) gaps.push('observer error/overflow/pending-read');
    if (trace.finalCount !== trace.rows.length || trace.finalSequence !== trace.rows.length) gaps.push('count/sequence mismatch');
    const open = new Map(); let entries = 0, exits = 0;
    for (const [i, row] of trace.rows.entries()) {
        if (row.seq !== i + 1 || row.domain !== trace.domain || row.processClock !== trace.domain || row.monotonicClock !== trace.domain + ':performance') gaps.push('sequence/clock domain');
        if (row.kind === 'entry') { if (open.has(row.call)) gaps.push('duplicate entry'); open.set(row.call, row); entries++; }
        if (['exit','async-complete'].includes(row.kind)) {
            const entry = open.get(row.call);
            if (!entry || entry.hook !== row.hook || entry.async !== (row.kind === 'async-complete')) gaps.push('unbound completion');
            open.delete(row.call); exits++;
        }
    }
    if ((trace.pendingAsync || []).length) gaps.push('pending asynchronous completion');
    if (open.size || trace.open.length || trace.entered !== entries || trace.exited !== exits || entries !== exits) gaps.push('incomplete entry/exit/async accounting');
    const counts = {};
    for (const row of trace.rows.filter(r => r.kind === 'entry')) counts[row.hook] = (counts[row.hook] || 0) + 1;
    if (JSON.stringify(counts) !== JSON.stringify(trace.counts)) gaps.push('hook count mismatch');
    const entriesByCall = new Map(trace.rows.filter(r => r.kind === 'entry').map(r => [r.call, r]));
    const sameBinding = (a, b) => a && b && a.engine === b.engine && (!a.transport || a.transport === b.transport) && (!a.session || a.session === b.session);
    const requests = new Map(), terminals = new Map(), completions = new Map();
    for (const row of trace.rows.filter(r => r.kind === 'entry')) {
        if (row.hook === 'polling-write-complete') {
            const write = entriesByCall.get(row.parent);
            if (write?.hook !== 'polling-write' || !sameBinding(write, row)) gaps.push('misbound polling completion');
            completions.set(row.parent, (completions.get(row.parent) || 0) + 1);
        }
        if (row.hook === 'request-create') {
            if (!row.request || requests.has(row.request)) gaps.push('duplicate/missing request identity');
            requests.set(row.request, row);
            if (row.operation) {
                const write = entriesByCall.get(row.operation);
                if (write?.hook !== 'polling-write' || !sameBinding(write, row)) gaps.push('misbound request operation');
            }
        }
        if (['request-success', 'request-error', 'request-abort'].includes(row.hook) && row.terminal) {
            const request = requests.get(row.request);
            if (!sameBinding(request, row) || request.operation !== row.operation || terminals.has(row.request)) gaps.push('misbound/duplicate request terminal');
            terminals.set(row.request, row);
        }
    }
    // Only enforce Request coverage when these opt-in hooks were installed;
    // legacy captures retain their original accounting contract.
    if (trace.installed.includes('request-create')) {
        for (const request of requests.values()) {
            const terminal = terminals.get(request.request);
            if (!terminal && (!request.operation || !(trace.pendingAsync || []).includes(request.operation + ':write'))) gaps.push('missing request terminal');
            if (terminal && request.operation) {
                const completed = completions.get(request.operation) || 0;
                if (completed !== (terminal.hook === 'request-success' ? 1 : 0)) gaps.push('request terminal/completion mismatch');
            }
        }
        for (const write of entriesByCall.values()) {
            if (write.hook === 'polling-write' && [...requests.values()].filter(r => r.operation === write.call).length !== 1) gaps.push('missing/duplicate write request');
        }
    }
    return [...new Set(gaps)];
}
module.exports = {lifecycleRecorder, validate};
