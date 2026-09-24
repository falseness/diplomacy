'use strict';
// Current typed portals round-trip exactly; obsolete ownership is rejected.
const {run}=require('./test-task243-source');
if(require.main===module)run();
module.exports={run};
