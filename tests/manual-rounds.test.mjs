import test from 'node:test';
import assert from 'node:assert/strict';
import {makeGame,addPlayer,applyAction,publicView,tick} from '../lib/game/engine.mjs';
const now=1000000,day=86400000;
function completed(){
 const g=makeGame('ABC234','Manual rounds',{id:'admin',name:'Alex'},now,90);
 addPlayer(g,{id:'sam',name:'Sam'});addPlayer(g,{id:'jo',name:'Jo'});
 applyAction(g,'admin',{type:'start'},now,()=>0);
 applyAction(g,'admin',{type:'roundtable'},now+1000);
 applyAction(g,'admin',{type:'finishVoting'},now+2000);
 return g;
}
const next=(g,at=now+day)=>applyAction(g,'admin',{type:'nextRound',round:g.round},at,()=>0);
for(const oldDeadline of [undefined,now+120000,now-120000,null])test(`results wait indefinitely, including saved deadline ${oldDeadline}`,()=>{
 const g=completed();assert.equal(g.deadline,null);const saved=structuredClone(g.results),scores=g.players.map(p=>p.score),roles={...g.roles},tasks=structuredClone(g.usedTaskIds);
 if(oldDeadline!==undefined)g.deadline=oldDeadline;
 for(const at of [now+120000,now+day,now+6*day]){tick(g,at,()=>{throw new Error('Waiting must not draw roles');});const v=publicView(g,'sam',at);assert.equal(v.phase,'results');assert.equal(v.deadline,null);assert.equal(v.round,1);assert.deepEqual(v.results,saved);}
 assert.deepEqual(g.players.map(p=>p.score),scores);assert.deepEqual(g.roles,roles);assert.deepEqual(g.usedTaskIds,tasks);
});
test('only an admin can start the next round and requests must name the completed round',()=>{
 const g=completed(),before=structuredClone(g);
 assert.throws(()=>applyAction(g,'sam',{type:'nextRound',round:1},now+day),/Only the admin/);
 for(const round of [undefined,null,0,2,'1'])assert.throws(()=>applyAction(g,'admin',{type:'nextRound',round},now+day),/moved on/);
 assert.deepEqual(g,before);next(g);assert.equal(g.round,2);assert.equal(g.phase,'playing');assert.equal(g.deadline,now+day+90*60000);assert.deepEqual(g.ballots,{});assert.equal(g.results,null);assert.deepEqual(g.history,before.history);assert.deepEqual(g.players.map(p=>p.score),before.players.map(p=>p.score));
});
test('duplicate and stale start requests cannot deal twice or skip future results',()=>{
 const g=completed(),action={type:'nextRound',round:1};applyAction(g,'admin',action,now+day,()=>0);const deadline=g.deadline;
 assert.throws(()=>applyAction(g,'admin',action,now+day+1),/after the results/);assert.equal(g.round,2);assert.equal(g.deadline,deadline);
 applyAction(g,'admin',{type:'roundtable'},now+day+2);applyAction(g,'admin',{type:'finishVoting'},now+day+3);const saved=structuredClone(g);
 assert.throws(()=>applyAction(g,'admin',action,now+day+4),/moved on/);assert.deepEqual(g,saved);
});
test('readiness changes during the discussion apply when the admin starts',()=>{
 const g=completed();applyAction(g,'sam',{type:'ready',ready:false},now+3000);addPlayer(g,{id:'late',name:'Taylor'});applyAction(g,'admin',{type:'leave'},now+4000);
 assert.equal(publicView(g,'late',now).secret,null);assert.equal(g.active.length,3);next(g);
 assert.deepEqual(g.active,['jo','late']);assert.equal(g.players.find(p=>p.id==='admin').nextActive,false);assert.equal(publicView(g,'admin',now+day).me.isAdmin,true);assert.equal(publicView(g,'admin',now+day).secret,null);assert.ok(publicView(g,'late',now+day).secret);
});
test('a saved paused results screen can resume without bringing back its countdown',()=>{
 const g=completed();g.pausedAt=now+3000;g.deadline=now+120000;tick(g,now+day);assert.equal(g.deadline,null);
 assert.throws(()=>next(g),/Resume/);applyAction(g,'admin',{type:'resume'},now+day);assert.equal(g.deadline,null);next(g);assert.equal(g.round,2);
});
test('ending during results retains scores and history without dealing another round',()=>{
 const g=completed(),saved=structuredClone(g.history),scores=g.players.map(p=>p.score);applyAction(g,'admin',{type:'end'},now+day);tick(g,now+2*day);
 assert.equal(g.phase,'ended');assert.equal(g.round,1);assert.deepEqual(g.history,saved);assert.deepEqual(g.players.map(p=>p.score),scores);assert.throws(()=>next(g,now+2*day),/after the results/);
});
