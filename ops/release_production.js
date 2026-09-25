'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const auth=require('./release_authenticated');
function prepare({outputDir,stopAt,config}) {
    config=config||auth.loadProductionConfig();
    assert(config.scope==='production','production-config-required');
    const roots=path.join(outputDir,'host-roots.json');
    auth.write(outputDir,'host-roots.json',config.rollbackRoots);
    const effective={...config,observerArgv:['python3',path.join(__dirname,'observe_release_host.py'),'--expected-host',config.host,
        '--service',config.service,'--roots-json',roots,'--stop-at-ms',String(stopAt)]};
    const service=require('./release_service_adapter').createServiceAdapter(effective);
    return {config,operations:require('./release_operations').createOperations({config:effective,...service,rehearseService:service.rehearse})};
}
module.exports={prepare};
