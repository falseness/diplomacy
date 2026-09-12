const http = require('http')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {spawn} = require('child_process')

const root = path.resolve(__dirname, '..')
const mime = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.png': 'image/png'}
const chromeCandidates = process.platform == 'win32' ? [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
] : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']
const chrome = process.env.CHROME_PATH || chromeCandidates.find(candidate => fs.existsSync(candidate))
if (!chrome)
    throw new Error('Chrome not found; set CHROME_PATH to run browser regressions')

let finish
const completed = new Promise(resolve => finish = resolve)
const server = http.createServer((request, response) => {
    if (request.method == 'POST' && request.url == '/__results') {
        let body = ''
        request.on('data', chunk => body += chunk)
        request.on('end', () => {
            const report = JSON.parse(body)
            response.writeHead(204).end()
            finish(report)
        })
        return
    }

    // The production page loads Socket.IO from a CDN. Browser regressions are
    // deliberately self-contained, so serve the same page without that one
    // online-only script instead of waiting on network access.
    if (request.method == 'GET' && request.url == '/__game.html') {
        fs.readFile(path.join(root, 'index.html'), 'utf8', (error, source) => {
            if (error) {
                response.writeHead(500).end(String(error))
                return
            }
            const offlineSource = source.replace(/\s*<script src=["']https:\/\/cdn\.socket\.io\/[^>]+><\/script>/, '')
            response.writeHead(200, {'content-type': mime['.html']})
            response.end(offlineSource)
        })
        return
    }

    const requestPath = decodeURIComponent((request.url || '/').split('?')[0])
    const relative = requestPath == '/' ? 'tests/regression.html' : requestPath.replace(/^\/+/, '')
    const filename = path.resolve(root, relative)
    if (filename != root && !filename.startsWith(root + path.sep)) {
        response.writeHead(403).end('Forbidden')
        return
    }
    fs.readFile(filename, (error, data) => {
        if (error) {
            response.writeHead(404).end('Not found')
            return
        }
        response.writeHead(200, {'content-type': mime[path.extname(filename)] || 'application/octet-stream'})
        response.end(data)
    })
})

server.listen(0, '127.0.0.1', async () => {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'diplomacy-regression-'))
    const address = server.address()
    const browser = spawn(chrome, [
        '--headless=new', '--disable-gpu', '--hide-scrollbars',
        `--user-data-dir=${profile}`,
        `http://127.0.0.1:${address.port}/tests/regression.html`
    ], {stdio: 'ignore'})
    const timeout = setTimeout(() => finish({passed: 0, failed: 1, results: [{name: 'suite timeout', passed: false, details: 'No result received within 45 seconds'}]}), 45000)
    const report = await completed
    clearTimeout(timeout)
    browser.kill()
    server.close()
    const resolvedProfile = path.resolve(profile)
    const resolvedTemp = path.resolve(os.tmpdir())
    if (resolvedProfile.startsWith(resolvedTemp + path.sep) &&
        path.basename(resolvedProfile).startsWith('diplomacy-regression-')) {
        try { fs.rmSync(resolvedProfile, {recursive: true, force: true}) } catch (_) {}
    }

    for (const result of report.results)
        console.log(`${result.passed ? 'PASS' : 'FAIL'}  ${result.name}${result.details ? `\n      ${result.details}` : ''}`)
    console.log(`\n${report.passed} passed, ${report.failed} failed`)
    process.exitCode = report.failed ? 1 : 0
})
