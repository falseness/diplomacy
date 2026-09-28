'use strict';
// Diagnostic preload only. The shipped source, input durations, assertions and
// animation callbacks are unchanged. Each pan retains its own passive timeline.
const fs = require('node:fs');
const path = require('node:path');
const {BrowserPlayer} = require('/root/diplomacy_server/tests/reliability/helpers/browser-driver');
const open = BrowserPlayer.open;
BrowserPlayer.open = function(browser, options) {
    const beforeNavigate = options.beforeNavigate;
    return open.call(this, browser, {...options, beforeNavigate: async player => {
        if (beforeNavigate) await beforeNavigate(player);
        await player.page.addInitScript(() => {
            const rows = [];
            let active = false;
            function sample(kind, extra = {}) {
                if (!active) return;
                const row = {kind, time: performance.now(), origin: performance.timeOrigin,
                    visibility: document.visibilityState, focus: document.hasFocus(), ...extra};
                try {
                    const s = gameEvent.screen;
                    Object.assign(row, {offset: {...canvas.offset}, speed: {x:s.speedX,y:s.speedY},
                        bounds: {left:s.getScreenLeft(),right:s.getScreenRight(),top:s.getScreenTop(),bottom:s.getScreenBottom()},
                        lastGameFrameTime, round:gameRound, slot:whooseTurn,
                        horizontal:[...gameEvent.pressed_horizontal_keys],vertical:[...gameEvent.pressed_vertical_keys]});
                } catch (e) { row.observationError = e.message; }
                rows.push(row);
            }
            for (const kind of ['keydown','keyup']) document.addEventListener(kind, e => {
                // Never retain password/menu keys.
                if (e.key.startsWith('Arrow')) sample(kind, {key:e.key,eventTime:e.timeStamp,trusted:e.isTrusted});
            }, {passive:true});
            for (const kind of ['focus','blur','visibilitychange']) addEventListener(kind, () => sample(kind), {passive:true});
            function frame(timestamp) { sample('frame', {timestamp}); if (active) requestAnimationFrame(frame); }
            window.__sequencePanObserver = {
                begin() { rows.length=0; active=true; sample('begin'); requestAnimationFrame(frame); },
                end() { sample('end'); active=false; return rows.splice(0); }
            };
        });
    }});
};
const pan = BrowserPlayer.prototype.pan;
BrowserPlayer.prototype.pan = async function(dx, dy, before) {
    await this.page.evaluate(() => window.__sequencePanObserver.begin());
    let failure = null;
    try { return await pan.call(this, dx, dy, before); }
    catch (error) { failure=error.message; throw error; }
    finally {
        const rows = await this.page.evaluate(() => window.__sequencePanObserver.end());
        fs.appendFileSync(path.join(process.env.ONLINE_EVIDENCE_DIR,'pan-observations.jsonl'),
            JSON.stringify({player:this.name,dx,dy,before,failure,rows})+'\n');
    }
};
