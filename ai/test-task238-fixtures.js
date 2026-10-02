'use strict';
// Independent literals for authored pre-wave fixtures, never natural progression.
// Version-5 hexagonal boards: side 2R+1 with R = circleRadiusPlan(h,'tiny').radius; towns and
// portals sit on unmasked cells (layer <= R), eleven portals per human in 3/3/1/1/1/1/1 order.
const {coopHexCells,coopHexCenter,coopHexLayer}=require('./coop-hex-geometry');
const categories=['melee','melee','melee','ranged','ranged','ranged','siege','heavy','support','chaos','mage'];
const schedule={melee:[[4,'imp'],[8,'clawling'],[16,'brute']],ranged:[[4,'spitter'],[12,'emberArcher']],siege:[[16,'bombard'],[32,'mortar']],heavy:[[20,'bulwark']],support:[[16,'ravager'],[24,'hound']],chaos:[[28,'demonLord']],mage:[[20,'hexcaster'],[28,'hexmaster'],[36,'demonQueen']]};
const stats={imp:[2,1,2,'Imp'],clawling:[1,2,2,'Clawling'],brute:[3,2,2,'Brute'],spitter:[2,1,2,'Spitter'],emberArcher:[1,1,2,'EmberArcher'],hexcaster:[1,3,1,'Hexcaster'],hexmaster:[1,3,2,'Hexmaster'],demonQueen:[1,5,1,'DemonQueen'],bombard:[4,0,2,'Bombard'],mortar:[4,0,2,'Mortar'],bulwark:[7,1,2,'Bulwark'],ravager:[4,1,3,'Ravager'],hound:[2,1,5,'Hound'],demonLord:[5,3,2,'DemonLord']};
const typeAt=(c,r)=>r>0&&r%4===0?schedule[c].filter(([n])=>n<=r).at(-1)?.[1]||null:null;
function spec(h){
 const side={1:21,2:25,12:57}[h],R=(side-1)/2,center=coopHexCenter(R),cells=coopHexCells(R);
 const ring=cells.filter(c=>coopHexLayer(c.x,c.y,center)===R-1),towns=Array.from({length:h},(_,i)=>ring[Math.floor(i*ring.length/h)]);
 const inner=cells.filter(c=>coopHexLayer(c.x,c.y,center)<=R-3);
 const portals=Array.from({length:h*11},(_,i)=>({x:inner[i].x,y:inner[i].y,category:categories[i%11]}));
 return {label:'TASK-238-H'+h,humans:h,size:'tiny',side,radius:R,seed:1,players:[{rgb:{r:100,g:100,b:100},gold:0,towns:[]},...towns.map((t,i)=>({rgb:{r:30+i*15,g:40,b:180},gold:100,towns:[{x:t.x,y:t.y}]}))],demons:[],portals,terrain:{mountains:[],lakes:[],bushes:[],goldmines:[]},generation:{version:5,playerCount:h,seed:1,size:'tiny',options:{seed:1,size:'tiny'},testFixture:{label:'TASK-238',generated:false,kind:'declared-local-fixture',purpose:'pre-wave boundary, not natural progression'}}};
}
const project=`players[gameSettings.coop.demonSlot].units.filter(u=>!u.killed).map(u=>({type:u.name,className:u.constructor.name,hp:u.hp,damage:u.dmg,movement:u.speed,owner:u.playerColor,x:u.coord.x,y:u.coord.y,category:grid.getBuilding(u.coord).category})).sort((a,b)=>a.x-b.x||a.y-b.y)`;
function expected(s,r,excluded=[]){return s.portals.filter(p=>typeAt(p.category,r)&&!excluded.includes(s.portals.indexOf(p))).map(p=>{const type=typeAt(p.category,r),[hp,damage,movement,className]=stats[type];return {type,className,hp,damage,movement,owner:s.humans+1,x:p.x,y:p.y,category:p.category};}).sort((a,b)=>a.x-b.x||a.y-b.y);}
module.exports={spec,expected,project,typeAt,stats};
