'use strict';
// Read-only diagnostics around the existing browser input driver. Enable only
// for a declared provider experiment; do not change inputs or retry failures.
const fs = require('node:fs');
const path = require('node:path');

async function camera(player) {
    return player.observe(() => ({
        offset: {...canvas.offset}, scale: canvas.scale,
        bounds: {left: gameEvent.screen.getScreenLeft(), right: gameEvent.screen.getScreenRight(),
            top: gameEvent.screen.getScreenTop(), bottom: gameEvent.screen.getScreenBottom()},
        speed: {x: gameEvent.screen.speedX, y: gameEvent.screen.speedY},
        keys: {horizontal: [...gameEvent.pressed_horizontal_keys], vertical: [...gameEvent.pressed_vertical_keys]},
        fps: framesPerSecond, lastFrame: lastGameFrameTime, visibility: document.visibilityState,
        connected: onlineSocket?.connected, waiting: gameEvent.waitingMode,
        overlay: nextTurnPauseInterface.visible, menu: menu.visible,
        browserNow: performance.now(),
    }));
}

function install(BrowserPlayer, directory) {
    const original = BrowserPlayer.prototype.pan;
    let sequence = 0;
    BrowserPlayer.prototype.pan = async function(dx, dy, before) {
        const row = {id: ++sequence, player: this.name, startedAt: new Date().toISOString(),
            requested: {dx, dy, before}, before: await camera(this)};
        try {
            const result = await original.call(this, dx, dy, before);
            row.pass = true;
            return result;
        } catch (error) {
            row.pass = false;
            row.error = error.message;
            // Capture before withServices tears down sockets and changes the UI.
            try { row.screenshot = await this.screenshot('pan-failure-before-cleanup'); }
            catch (captureError) { row.screenshotError = captureError.message; }
            throw error;
        } finally {
            try { row.after = await camera(this); }
            catch (captureError) { row.observationError = captureError.message; }
            row.finishedAt = new Date().toISOString();
            fs.appendFileSync(path.join(directory, 'pan-observations.jsonl'), JSON.stringify(row) + '\n');
        }
    };
    return () => { BrowserPlayer.prototype.pan = original; };
}

if (process.env.TASK225_PAN_OBSERVATIONS === '1' && process.env.ONLINE_EVIDENCE_DIR) {
    install(require('/root/diplomacy_server/tests/reliability/helpers/browser-driver').BrowserPlayer,
        process.env.ONLINE_EVIDENCE_DIR);
}
module.exports = {camera, install};
