// Read-only observation of real predecessor/candidate commands, predictions and teachers.
const fs = require('fs'), path = require('path'), vm = require('vm');
const assert = require('assert'), crypto = require('crypto'), zlib = require('zlib');
const root = process.cwd(), output = process.argv[2];
const pre = JSON.parse(fs.readFileSync(process.argv[3]));
const hash = v => crypto.createHash('sha256').update(v).digest('hex');
const stream = fs.openSync(output + '.trace.jsonl', 'wx');
let snapshots = new Map(), checks = 0, events = 0;
const OriginalScript = vm.Script;
vm.Script = class extends OriginalScript {
  constructor(source, options) {
    super(source + (options && options.filename === 'ai/players.js'
      ? require(path.join(root, 'ai/diagnostics/task102-allocation-hooks.cjs')) : ''), options);
  }
  runInContext(context, options) {
    context.__task102AllocationSink = (kind, encoded, meta) => {
      if (kind === 'snapshot') snapshots.set(meta.id, hash(encoded));
      if (kind === 'inputs') JSON.parse(encoded).forEach((input, i) => {
        if (meta[i] !== null) { assert.equal(hash(JSON.stringify(input)), snapshots.get(meta[i])); checks++; }
      });
      fs.writeSync(stream, JSON.stringify({kind, hash:hash(encoded), bytes:Buffer.byteLength(encoded), meta})+'\n'); events++;
    };
    return super.runInContext(context, options);
  }
};
async function main() {
 const harness = require(path.join(root,'ai/benchmarkHarness'));
 const games=[]; const run=harness.runGame;
 harness.runGame = function(...args) {const result=run.apply(this,args); games.push(result); return result;};
 const trainer=require(path.join(root,'ai/cloud-train-runner'));
 const api=require(path.join(root,'ai/benchmark-gamestart-trained-model'));
 const checkpoint=await api.loadCheckpoint(pre.checkpoint);
 const predict=api.createPredictor(checkpoint.model,{calls:0,positions:0,resizedInputs:0,channelAdaptations:0});
 const results=[];
 for (let i=0;i<6;i++) {
  snapshots=new Map();
  results.push(trainer.collectRuntimeCombatTeacherGame(137087,0,i+1));
  console.log('TEACHER_COMPLETE: '+(i+1)+' examples='+results.at(-1).examples.length);
 }
 for (const options of pre.component) {
  snapshots=new Map();
  results.push(harness.runGame({...options,predictFunction:predict,modelIdentifier:checkpoint.model,
    inferenceSource:'TASK-102 diagnostic frozen checkpoint; not original expert/evolving predictor'}));
 }
 fs.closeSync(stream);
 fs.writeFileSync(output+'.results.json.gz',zlib.gzipSync(JSON.stringify({results,games})),{flag:'wx'});
 assert(checks>0); assert(events>0);
 console.log('TRACE_LIFETIME: PASS '+checks+' snapshot comparisons; '+events+' command/input/score events');
 console.log('TRACE_SCENARIOS: PASS 6 teacher and 6 checkpoint games');
 checkpoint.model.dispose();
}
main().catch(e=>{console.error(e.stack); process.exitCode=1;});
