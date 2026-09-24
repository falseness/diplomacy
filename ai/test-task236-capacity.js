'use strict';
// Independent specification oracle. No production imports: enumerate discrete
// clearance sites and use closed-form cube distance, rather than planner BFS.
const range = (lo, hi, step=1) => Array.from({length:Math.max(0,Math.floor((hi-lo)/step)+1)},(_,i)=>lo+i*step);
const distance=(a,b)=>{const z=p=>p.y-(p.x-(p.x&1))/2;return Math.max(Math.abs(a.x-b.x),Math.abs(z(a)-z(b)),Math.abs(a.x+z(a)-b.x-z(b)));};
function feasible(h,size,n) {
 const objects=h*{tiny:1,normal:2,big:3}[size],minDistance={tiny:6,normal:10,big:14}[size];
 const terrain=Math.round(n*n*.08)+Math.round(n*n*.06),bushes=Math.round(n*n*.10);
 const lattice=(x,y)=>((3*x-(x&1))/2-y)%3===0;
 for(const depth of range(1,Math.floor(n/3))) {
  const count=(start,width,top=null)=>{
   let total=0;
   for(const x of range(start,start+width-1))for(const y of range(0,depth-1)) {
    if(!lattice(x,y))continue;
    // The nearest allied centre lies in its top row; enumerate that row.
    if(top!==null&&Math.min(...range(2,n-3).map(tx=>distance({x,y},{x:tx,y:top})))<minDistance)continue;
    total++;
   }return total;
  };
  const minWidth=range(1,Math.floor(n/2)).find(w=>count(0,w)>=3*h&&count(n-w,w)>=3*h);
  if(minWidth===undefined)continue;
  for(const width of range(minWidth,Math.min(Math.floor(n/2),minWidth+4),2))for(const thick of [1,2])for(const ridge of range(depth+1,n-5-thick)) {
   const top=ridge+thick+2;
   if(n-2-top<(h<=2?2:Math.ceil(h/2)+2))continue;
   if(range(2,n-3,3).length*range(top,n-3,3).length<h)continue;
   if(n*(n-top)-9*h<h||thick*(n-4)>terrain)continue;
   let sites=0;
   for(const y of range(2,ridge-2,3))sites+=range(y<=depth?Math.max(2,width+1):2,y<=depth?Math.min(n-3,n-width-2):n-3,3).length;
   if(sites<objects||n*(ridge-1)-2*width*depth-9*objects<objects-h)continue;
   const free=n*n-thick*(n-4)-6*(thick+3)-2*n-2*width*depth-9*(h+objects)-objects;
   if(free<terrain-thick*(n-6)+bushes)continue;
   if(count(0,width,top)>=3*h&&count(n-width,width,top)>=3*h)return {depth,width,thick,ridge};
  }
 }
 return null;
}
const cache=new Map();
function expectation(h,size){
 const key=size+':'+h;if(cache.has(key))return cache.get(key);
 const base=Math.max({tiny:11,normal:15,big:21}[size],Math.ceil({tiny:15,normal:25,big:39}[size]*Math.sqrt(h/4)));
 const rejected=[];let side=base,witness;
 while(!(witness=feasible(h,size,side))){rejected.push(side++);if(side>200)throw Error('oracle bound');}
 const result={base,side,rejected,witness};cache.set(key,result);return result;
}
module.exports={expectation};
