'use strict';
const fs=require('node:fs'),path=require('node:path');
const params=JSON.parse(fs.readFileSync(process.argv[2]));
const result=require(path.join(params.serverDir,'tests/reliability/helpers/release-final-output')).inspectFinalOutputs(params);
console.log(JSON.stringify(result));process.exitCode=result.pass?0:1;
