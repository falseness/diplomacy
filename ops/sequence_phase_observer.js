'use strict';
// Schedule the unchanged trusted pan relative to a native production frame.
require('./sequence_pan_observer');
require('./sequence_native_frame_probe');
const fs = require('node:fs');
const path = require('node:path');
const {BrowserPlayer} = require('/root/diplomacy_server/tests/reliability/helpers/browser-driver');
const phase = process.env.SEQUENCE_NATIVE_PHASE;
if (!['after-frame', 'after-frame-plus-50ms'].includes(phase)) throw new Error('undeclared native phase');
const delayMs = phase === 'after-frame' ? 0 : 50;
const pan = BrowserPlayer.prototype.pan;
let samples = 0;
BrowserPlayer.prototype.pan = async function(dx, dy, before) {
    if (++samples > 2) throw new Error('native phase diagnostic sample bound exceeded');
    const record = {player:this.name, dx, dy, before, phase, delayMs, cpuThrottleRate:1, failure:null};
    await this.page.evaluate(() => window.__sequenceFrameObserver.begin());
    try {
        await this.page.evaluate(delay => window.__sequenceFrameObserver.align(delay), delayMs);
        return await pan.call(this, dx, dy, before);
    } catch (error) {
        record.failure = error.message;
        await this.screenshot('native-phase-pan-failure');
        throw error;
    } finally {
        record.rows = await this.page.evaluate(() => window.__sequenceFrameObserver.end());
        fs.appendFileSync(path.join(process.env.ONLINE_EVIDENCE_DIR, 'production-frame-observations.jsonl'), JSON.stringify(record)+'\n');
    }
};
