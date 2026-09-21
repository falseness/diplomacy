'use strict';
// Across processes, only session + ordered protocol occurrence + exact keyed
// wire membership are used. Wall-clock proximity is deliberately unavailable.
function classify(clients, network, server) {
    const links=[], gaps=[];
    const occurrences=t=>t.rows.filter(r=>r.kind==='occurrence');
    const serverEntries=new Map(server.rows.filter(r=>r.kind==='entry').map(r=>[r.call,r]));
    function ancestor(entries,call,target) {
        const visited=new Set();
        while(call && !visited.has(call)) {if(call===target)return true;visited.add(call);call=entries.get(call)?.parent;}
        return false;
    }
    const serverWires=occurrences(server).filter(r=>r.hook==='server-wire'&&r.event==='startGameOrConnect');
    for(const client of clients) {
        const entries=new Map(client.rows.filter(r=>r.kind==='entry').map(r=>[r.call,r]));
        const app=occurrences(client).filter(r=>r.hook==='application-packet'&&r.event==='startGameOrConnect');
        const writes=occurrences(client).filter(r=>['polling-wire','websocket-send'].includes(r.hook)&&r.event==='startGameOrConnect');
        const counters=new Map();
        for(const write of writes) {const n=(counters.get(write.session)||0)+1;counters.set(write.session,n);write.protocolOrdinal=n;}
        const net=occurrences(network).filter(r=>r.hook==='network-'+client.name&&r.direction==='sent'&&r.event==='startGameOrConnect');
        for(const emit of app) {
            const token=entries.get(emit.call)?.parent;
            const candidates=writes.filter(w=>ancestor(entries,w.call,token));
            const result={page:client.name,emit:token,payload:emit.payload,buffered:emit.buffered,writes:[],classification:candidates.length?'written':'emit-without-write'};
            for(const w of candidates) {
                const n=net.filter(n=>n.session===w.session&&n.joinOrdinal===w.protocolOrdinal);
                const s=serverWires.filter(s=>s.session===w.session&&s.joinOrdinal===w.protocolOrdinal);
                const item={call:w.call,session:w.session,ordinal:w.protocolOrdinal,network:null,server:null,handlers:[],queue:[],assignment:[],opening:[],classification:'write-without-network-observation'};
                if(!w.session || n.length!==1 || n[0].wireDigest!==w.wireDigest) {gaps.push('unbound/ambiguous write/network '+client.name+':'+w.call);item.classification='unknown';}
                else {
                    item.network={domain:network.domain,call:n[0].call,object:n[0].object,packetIndex:n[0].packetIndex};
                    if(s.length>1 || (s.length===1&&s[0].wireDigest!==w.wireDigest)) {gaps.push('ambiguous server packet '+client.name+':'+w.call);item.classification='unknown';}
                    else if(!s.length)item.classification='network-send-without-server-decode';
                    else {
                        item.server={domain:server.domain,call:s[0].call};
                        const engineDecode=serverEntries.get(s[0].call)?.parent;
                        const descendants=server.rows.filter(r=>r.kind==='entry'&&ancestor(serverEntries,r.call,engineDecode));
                        for(const [key,hook] of [['handlers','handler-receipt'],['queue','queue-execution'],['assignment','assignment'],['opening','opening-emission']])item[key]=descendants.filter(r=>r.hook===hook).map(r=>r.call);
                        item.classification=!item.handlers.length?'decoded-without-handler':!item.queue.length?'handler-without-queue-execution':!item.assignment.length?'queue-without-assignment':!item.opening.length?'assigned-without-opening':'emit-write-decode-handler-queue-opening';
                    }
                }
                result.writes.push(item);
            }
            if(candidates.length)result.classification=[...new Set(result.writes.map(w=>w.classification))].join(',');
            links.push(result);
        }
        for(const write of writes)if(!app.some(a=>ancestor(entries,write.call,entries.get(a.call)?.parent)))gaps.push('write without application occurrence '+client.name+':'+write.call);
        if(net.length!==writes.length)gaps.push('network/write occurrence count '+client.name);
    }
    return {basis:'explicit local ancestry; exact session + ordered protocol occurrence + keyed wire digest; no wall-clock or payload-only matching',links,gaps};
}
module.exports=classify;
