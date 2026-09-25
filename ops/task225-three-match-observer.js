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
  const checkpoint=args[1]?.$set?.coopCheckpoint;
  const phase=checkpoint?{stage:checkpoint.stage,round:checkpoint.round}:null;
  const record=(boundary,outcome={})=>console.log('G09_DB '+JSON.stringify({operation,method,gameID,phase,boundary,...outcome,at:Date.now(),ns:process.hrtime.bigint().toString()}));
  record('start');
  try{
   const result=await original.apply(this,args);
   record('end',{succeeded:true,...(method==='updateOne'?{writeResult:{acknowledged:result.acknowledged,matchedCount:result.matchedCount,modifiedCount:result.modifiedCount}}:{})});
   return result;
  }catch(error){record('end',{succeeded:false});throw error;}
 };
}
