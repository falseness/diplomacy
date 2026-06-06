const fs = require('fs')
const path = require('path')

const repoRoot = path.resolve(__dirname, '..')
const ignoredDirectories = new Set(['.git', 'ai', 'node_modules'])
const sourceExtensions = new Set(['.js', '.html'])

function listSourceFiles(directory, result) {
    for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
        if (entry.isDirectory() && ignoredDirectories.has(entry.name)) {
            continue
        }
        const absolutePath = path.join(directory, entry.name)
        if (entry.isDirectory()) {
            listSourceFiles(absolutePath, result)
        }
        else if (sourceExtensions.has(path.extname(entry.name))) {
            result.push(absolutePath)
        }
    }
}

const files = []
listSourceFiles(repoRoot, files)

const forbiddenDefinitions = [
    /class\s+AIPlayer\b/,
    /class\s+SimpleAiPlayer\b/,
    /function\s+trainModel\b/,
    /function\s+vectoriseGrid\b/,
    /GameManager\.playAndTrain\s*=/,
    /GameManager\.generateAndPlay\s*=/
]

for (const file of files) {
    const source = fs.readFileSync(file, 'utf8')
    for (const pattern of forbiddenDefinitions) {
        if (pattern.test(source)) {
            throw new Error(`AI implementation escaped ai/: ${path.relative(repoRoot, file)} (${pattern})`)
        }
    }
}

const index = fs.readFileSync(path.join(repoRoot, 'index.html'), 'utf8')
const requiredOrder = [
    'ai/generateMap.js',
    'ai/vectorizeContent.js',
    'ai/model.js',
    'player.js',
    'ai/players.js',
    'ai/gameManagerTraining.js',
    'ai/runtimeIntegration.js',
    'nextTurn.js'
]
let previousIndex = -1
for (const script of requiredOrder) {
    const scriptIndex = index.indexOf(script)
    if (scriptIndex <= previousIndex) {
        throw new Error(`Browser AI load order is invalid at ${script}`)
    }
    previousIndex = scriptIndex
}

console.log(`AI runtime boundary passed across ${files.length} non-ai source files`)
