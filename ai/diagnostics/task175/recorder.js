'use strict';
// Self-contained synchronous recorder, shared by Node and browser. No timers,
// listeners, network, saved raw identifiers, or callback argument serialization.
function recorder(secret, domain, limit = 100000) {
    const objects = new WeakMap(), sessions = new WeakMap();
    let serial = 0, sequence = 0, calls = 0, errors = 0, overflow = false, active = true;
    const rows = [], labels = new Map();
    function sha(text) {
        const bytes = new TextEncoder().encode(text), words = [], h = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
        const k = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
        for(let i=0;i<bytes.length;i++) words[i>>2]=(words[i>>2]||0)|(bytes[i]<<(24-(i%4)*8));
        words[bytes.length>>2]=(words[bytes.length>>2]||0)|(0x80<<(24-(bytes.length%4)*8));
        words[(((bytes.length+8)>>6)+1)*16-1]=bytes.length*8;
        const r=(v,n)=>(v>>>n)|(v<<(32-n));
        for(let i=0;i<words.length;i+=16){const w=[]; let [a,b,c,d,e,f,g,z]=h;
            for(let j=0;j<64;j++) {w[j]=j<16?(words[i+j]|0):((r(w[j-15],7)^r(w[j-15],18)^(w[j-15]>>>3))+w[j-16]+(r(w[j-2],17)^r(w[j-2],19)^(w[j-2]>>>10))+w[j-7])|0;
                const t=(z+(r(e,6)^r(e,11)^r(e,25))+((e&f)^(~e&g))+k[j]+w[j])|0;
                const u=((r(a,2)^r(a,13)^r(a,22))+((a&b)^(a&c)^(b&c)))|0;
                z=g;g=f;f=e;e=(d+t)|0;d=c;c=b;b=a;a=(t+u)|0;
            } [a,b,c,d,e,f,g,z].forEach((v,j)=>h[j]=(h[j]+v)|0);
        } return h.map(v=>(v>>>0).toString(16).padStart(8,'0')).join('');
    }
    function label(sid) {if(!sid)return null; if(!labels.has(sid)) labels.set(sid,sha(secret+'\0'+sid)); return labels.get(sid);}
    function object(o) {if(!o || !['object','function'].includes(typeof o))return null; if(!objects.has(o))objects.set(o,++serial);return objects.get(o);}
    function session(engine, sid) {
        if(!engine)return label(sid);
        const value=sid || engine.id;
        if(value) sessions.set(engine,label(value));
        return sessions.get(engine)||null;
    }
    function put(row) {if(!active)return; if(rows.length>=limit){overflow=true;return;} rows.push({seq:++sequence,domain,monoMs:performance.now(),...row});}
    function enter(hook,engine,transport,sid,detail) {
        if(!active)return null;
        try {const token={call:++calls,hook,session:session(engine,sid),engine:object(engine),transport:object(transport),epoch:object(transport)};
            // Only literal, allowlisted control reasons are retained.
            if(['ping timeout','transport close','forced close','transport error','upgrade','ping','open','message'].includes(detail))token.detail=detail;
            token.kind=hook==='opening-emission'?'event-emission':hook==='server-upgrade-accepted'?'upgrade-acceptance':'callback';
            put({...token,kind:token.kind+'-entry'});return token;
        }catch{errors++;return null;}
    }
    function leave(token) {try{if(token)put({...token,kind:token.kind+'-exit'});}catch{errors++;}}
    function network(objectValue,sid,transport,direction,packet) {try{
        let event=null,type=String(packet).charAt(0);const m=/^42\d*(\[.*)$/s.exec(String(packet));
        if(m){try{const v=JSON.parse(m[1])[0];if(['startGameOrConnect','gameStarted','playYourTurn','waitYouTurn'].includes(v))event=v;}catch{}}
        put({kind:'network-observation',object:object(objectValue),session:label(sid),transport,direction,type,event});
    }catch{errors++;}}
    return {enter,leave,label,network,flush(){active=false;return {domain,overflow,errors,complete:true,rows};}};
}
if(typeof module!=='undefined')module.exports=recorder;
