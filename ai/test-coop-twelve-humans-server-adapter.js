'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'../../diplomacy_server'),target=path.join(root,'tests/coop/twelve-humans.test.js'),out=path.resolve('artifacts/TASK-127');
fs.mkdirSync(out,{recursive:true});
// Never rewrite sibling fixtures while the reliability runner or another adapter uses them.
require(path.resolve(__dirname,'../../diplomacy_server/tests/reliability/helpers/sibling-lock.js')).acquire('ai/test-coop-twelve-humans-server-adapter.js');
const before=fs.existsSync(target)?fs.readFileSync(target):null,hash=x=>x===null?null:crypto.createHash('sha256').update(x).digest('hex');
let status=1;
try{fs.writeFileSync(target,fs.readFileSync(path.join(__dirname,'fixtures/twelve-humans.test.js')));console.log('CWD='+root+'\nCOMMAND='+process.execPath+' --test tests/coop/twelve-humans.test.js\nRUNTIME='+process.version);const r=spawnSync(process.execPath,['--test','tests/coop/twelve-humans.test.js'],{cwd:root,stdio:'inherit',timeout:65000});status=r.status??1;console.log('SERVER_EXIT_STATUS='+status);if(r.error)console.error(r.error)}finally{if(before===null)fs.unlinkSync(target);else fs.writeFileSync(target,before);const after=fs.existsSync(target)?fs.readFileSync(target):null;assert.equal(hash(before),hash(after));fs.writeFileSync(path.join(out,'server-fixture-identity.json'),JSON.stringify({target,before:hash(before),after:hash(after),fixture:hash(fs.readFileSync(path.join(__dirname,'fixtures/twelve-humans.test.js')))},null,2)+'\n');console.log('PASS sibling fixture restored original bytes or absence')}
process.exitCode=status;
