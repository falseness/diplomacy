'use strict';
// Native callback observation only; no CPU throttling or frame rescheduling.
const {BrowserPlayer} = require('/root/diplomacy_server/tests/reliability/helpers/browser-driver');
const open = BrowserPlayer.open;
BrowserPlayer.open = function(browser, options) {
    const beforeNavigate = options.beforeNavigate;
    return open.call(this, browser, {...options, beforeNavigate: async player => {
        if (beforeNavigate) await beforeNavigate(player);
        await player.page.addInitScript(() => {
            let active = false, serial = 0;
            let alignment = null;
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
                    finally {
                        sample('game-frame-exit', {id,timestamp});
                        if (alignment) {
                            const resolve = alignment; alignment = null;
                            sample('phase-anchor', {id,timestamp}); resolve();
                        }
                    }
                });
            };
            for (const kind of ['keydown','keyup']) document.addEventListener(kind, event => {
                if (event.key.startsWith('Arrow')) sample(kind,{key:event.key,trusted:event.isTrusted,eventTime:event.timeStamp});
            },{passive:true});
            window.__sequenceFrameObserver = {
                async align(delayMs) {
                    await new Promise((resolve, reject) => {
                        const timer = setTimeout(() => { alignment=null; reject(new Error('native frame alignment timeout')); }, 5000);
                        alignment = () => { clearTimeout(timer); resolve(); };
                    });
                    if (delayMs) await new Promise(resolve => setTimeout(resolve, delayMs));
                    sample('phase-ready', {delayMs});
                },
                begin() { rows.length=0; active=true; sample('begin'); },
                end() { sample('end'); active=false; return rows.splice(0); }
            };
        });
    }});
};
