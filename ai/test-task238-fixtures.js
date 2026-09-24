'use strict';
// Independent literals for authored pre-wave fixtures, never natural progression.
const categories=['melee','melee','melee','ranged','ranged','ranged','siege','heavy','support','chaos'];
const schedule={melee:[[4,'imp'],[8,'clawling'],[16,'brute']],ranged:[[4,'spitter'],[12,'emberArcher'],[20,'hexcaster']],siege:[[16,'bombard']],heavy:[[20,'bulwark']],support:[[16,'ravager'],[24,'hound']],chaos:[[28,'demonLord']]};
const stats={imp:[2,1,2,'Imp'],clawling:[1,2,2,'Clawling'],brute:[3,2,2,'Brute'],spitter:[2,1,2,'Spitter'],emberArcher:[1,1,2,'EmberArcher'],hexcaster:[1,3,1,'Hexcaster'],bombard:[4,0,2,'Bombard'],bulwark:[7,1,2,'Bulwark'],ravager:[4,1,3,'Ravager'],hound:[2,1,5,'Hound'],demonLord:[5,3,2,'DemonLord']};
const typeAt=(c,r)=>r>0&&r%4===0?schedule[c].filter(([n])=>n<=r).at(-1)?.[1]||null:null;
function spec(h){
 const side={1:12,2:14,12:33}[h];
 const portals=Array.from({length:h*10},(_,i)=>({x:i%side,y:side-1-Math.floor(i/side),category:categories[i%10]}));
 return {label:'TASK-238-H'+h,humans:h,size:'tiny',side,seed:1,players:[{rgb:{r:100,g:100,b:100},gold:0,towns:[]},...Array.from({length:h},(_,i)=>({rgb:{r:30+i*15,g:40,b:180},gold:100,towns:[{x:1+(i%6)*5,y:1+Math.floor(i/6)*4}]}))],demons:[],portals,terrain:{mountains:[],lakes:[],bushes:[],goldmines:[]},generation:{version:4,playerCount:h,seed:1,size:'tiny',options:{seed:1,size:'tiny'},testFixture:{label:'TASK-238',generated:false,kind:'declared-local-fixture',purpose:'pre-wave boundary, not natural progression'}}};
}
const project=`players[gameSettings.coop.demonSlot].units.filter(u=>!u.killed).map(u=>({type:u.name,className:u.constructor.name,hp:u.hp,damage:u.dmg,movement:u.speed,owner:u.playerColor,x:u.coord.x,y:u.coord.y,category:grid.getBuilding(u.coord).category})).sort((a,b)=>a.x-b.x||a.y-b.y)`;
function expected(s,r,excluded=[]){return s.portals.filter(p=>typeAt(p.category,r)&&!excluded.includes(s.portals.indexOf(p))).map(p=>{const type=typeAt(p.category,r),[hp,damage,movement,className]=stats[type];return {type,className,hp,damage,movement,owner:s.humans+1,x:p.x,y:p.y,category:p.category};}).sort((a,b)=>a.x-b.x||a.y-b.y);}
module.exports={spec,expected,project,typeAt,stats};
