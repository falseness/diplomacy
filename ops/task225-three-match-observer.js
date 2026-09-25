'use strict';
// Delegation-only observation of the real driver's await boundaries.
const {createRequire}=require('node:module');
const serverRequire=createRequire('/root/diplomacy_server/server/index.js');
require('/root/diplomacy_server/tests/reliability/helpers/concurrent-observer.js');
const {Collection}=serverRequire('mongodb');
let sequence=0;
for(const method of ['findOne','updateOne','insertOne']){
 const original=Collection.prototype[method];
 Collection.prototype[method]=async function(...args){
  if(this.collectionName!=='games')return original.apply(this,args);
  const operation=++sequence,gameID=args[0]?.gameID??null;
  const record=boundary=>console.log('G09_DB '+JSON.stringify({operation,method,gameID,boundary,at:Date.now(),ns:process.hrtime.bigint().toString()}));
  record('start');
  try{return await original.apply(this,args);}finally{record('end');}
 };
}
