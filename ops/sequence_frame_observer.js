'use strict';
// Diagnostic only: retain the passive input observer and observe the actual
// production callback synchronously. No source substitution or synthetic RAF.
require('./sequence_pan_observer');
const fs = require('node:fs');
const path = require('node:path');
const {BrowserPlayer} = require('/root/diplomacy_server/tests/reliability/helpers/browser-driver');
const open = BrowserPlayer.open;
BrowserPlayer.open = function(browser, options) {
    const beforeNavigate = options.beforeNavigate;
    return open.call(this, browser, {...options, beforeNavigate: async player => {
        if (beforeNavigate) await beforeNavigate(player);
        await player.page.addInitScript(() => {
            let active = false, serial = 0;
            const rows = [];
            function sample(kind, extra = {}) {
                if (!active) return;
                const s = gameEvent.screen;
                rows.push({kind, time:performance.now(), origin:performance.timeOrigin, ...extra,
                    offset:{...canvas.offset}, speed:{x:s.speedX,y:s.speedY},
                    bounds:{left:s.getScreenLeft(),right:s.getScreenRight(),top:s.getScreenTop(),bottom:s.getScreenBottom()},
                    horizontal:[...gameEvent.pressed_horizontal_keys],vertical:[...gameEvent.pressed_vertical_keys],
                    lastGameFrameTime, visibility:document.visibilityState,focus:document.hasFocus()});
            }
            const nativeRAF = window.requestAnimationFrame;
            window.requestAnimationFrame = function(callback) {
                if (callback.name !== 'gameLoop') return nativeRAF.call(this, callback);
                return nativeRAF.call(this, function(timestamp) {
                    const id = ++serial;
                    sample('game-frame-enter', {id,timestamp});
                    try { return callback.call(this, timestamp); }
                    finally { sample('game-frame-exit', {id,timestamp}); }
                });
            };
            for (const kind of ['keydown','keyup']) document.addEventListener(kind, event => {
                if (event.key.startsWith('Arrow')) sample(kind,{key:event.key,trusted:event.isTrusted,eventTime:event.timeStamp});
            },{passive:true});
            window.__sequenceFrameObserver = {
                begin() { rows.length=0; active=true; sample('begin'); },
                end() { sample('end'); active=false; return rows.splice(0); }
            };
        });
    }});
};
const pan = BrowserPlayer.prototype.pan;
BrowserPlayer.prototype.pan = async function(dx, dy, before) {
    const session = await this.page.context().newCDPSession(this.page);
    const record = {player:this.name,dx,dy,before,throttleRate:4,failure:null,restored:false};
    try {
        await session.send('Emulation.setCPUThrottlingRate',{rate:4});
        await this.page.evaluate(() => window.__sequenceFrameObserver.begin());
        return await pan.call(this,dx,dy,before);
    } catch (error) {
        record.failure=error.message;
        await this.screenshot('scheduling-pan-failure');
        throw error;
    } finally {
        try { record.rows=await this.page.evaluate(() => window.__sequenceFrameObserver.end()); }
        finally {
            try {
                await session.send('Emulation.setCPUThrottlingRate',{rate:1});
                record.restored=true;
            } finally {
                await session.detach();
                fs.appendFileSync(path.join(process.env.ONLINE_EVIDENCE_DIR,'production-frame-observations.jsonl'),JSON.stringify(record)+'\n');
            }
        }
    }
};
