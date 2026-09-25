'use strict';
// A focused diagnostic of the original TASK-231 readiness bound. This does
// not change gameplay, fixture setup, or the existing state assertions.
const fs = require('node:fs');
const {performance} = require('node:perf_hooks');
process.env.PLAYWRIGHT_BROWSERS_PATH ??= '0';
const {chromium} = require('playwright');
const output = process.env.TASK225_READINESS_LOG;
if (!output) throw new Error('TASK225_READINESS_LOG is required');
const launch = chromium.launch.bind(chromium);
let contextID = 0;
chromium.launch = async (...args) => {
    const browser = await launch(...args);
    const newContext = browser.newContext.bind(browser);
    browser.newContext = async (...contextArgs) => {
        const context = await newContext(...contextArgs), id = contextID++;
        const newPage = context.newPage.bind(context);
        let pageID = 0;
        context.newPage = async (...pageArgs) => {
            const page = await newPage(...pageArgs), index = pageID++;
            const wait = page.waitForFunction.bind(page);
            page.waitForFunction = async (fn, arg, options) => {
                if (String(fn).replace(/\s/g, '') !== '()=>menu.visible&&imagesCountLoaded===images.length') {
                    return wait(fn, arg, options);
                }
                const started = new Date().toISOString(), start = performance.now();
                let passed = false, error;
                try {
                    const result = await wait(fn, arg, {...options, timeout: 15000});
                    passed = true;
                    return result;
                } catch (failure) {
                    error = failure.message;
                    throw failure;
                } finally {
                    const row = {context: id, page: index, started, elapsedMs: performance.now() - start,
                        timeoutMs: 15000, passed, error};
                    fs.appendFileSync(output, JSON.stringify(row) + '\n');
                    console.log('TASK225_READINESS ' + JSON.stringify(row));
                }
            };
            return page;
        };
        return context;
    };
    return browser;
};
