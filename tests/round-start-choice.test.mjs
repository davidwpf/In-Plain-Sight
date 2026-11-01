import test from 'node:test';
import assert from 'node:assert/strict';
import {makeGame,addPlayer,applyAction,publicView} from '../lib/game/engine.mjs';
const now=1800000000000;
function game(n=3){const g=makeGame('ABC234','Start choice',{id:'p0',name:'Alex'},now);for(let i=1;i<n;i++)addPlayer(g,{id:`p${i}`,name:`Player ${i}`});return g;}
const choice=(g,asFinal)=>({type:g.round?'nextRound':'start',round:g.round,expectedFinalRound:g.finalRound??null,asFinal});
const start=(g,final=false)=>applyAction(g,'p0',choice(g,final),now+10,n=>n-1);
const complete=g=>{applyAction(g,'p0',{type:'roundtable'},now+20);applyAction(g,'p0',{type:'finishVoting'},now+21);};
const snapshot=g=>JSON.parse(JSON.stringify(g));
for(const phase of ['lobby','results'])for(const savedPlan of [false,true])test(`an older direct start cannot bypass confirmation in ${phase}, saved plan ${savedPlan}`,()=>{
 const g=game();if(phase==='results'){start(g);complete(g);}if(savedPlan)g.finalRound=g.round+1;
 const before=snapshot(g),type=phase==='lobby'?'start':'nextRound';
 for(const action of [{type,round:g.round},{type,round:g.round,expectedFinalRound:g.finalRound??null}]){
  assert.throws(()=>applyAction(g,'p0',action,now+30,()=>{throw new Error('Unconfirmed starts must not draw roles');}),/Choose Start.*Refresh the page/);
  assert.deepEqual(g,before);
 }
 start(g,savedPlan);assert.equal(g.phase,'playing');assert.equal(g.round,before.round+1);assert.equal(g.finalRound,savedPlan?g.round:null);
});
for(const final of [false,true])test(`the first round can start directly with asFinal ${final}`,()=>{
 const g=game();start(g,final);assert.equal(g.round,1);assert.equal(g.phase,'playing');assert.equal(g.finalRound,final?1:null);assert.equal(g.deadline,now+10+60*60000);assert.equal(g.history.length,0);assert.ok(publicView(g,'p0').secret);
});
for(const final of [false,true])test(`the next round starts atomically with asFinal ${final}`,()=>{
 const g=game();start(g);complete(g);const history=snapshot(g.history),scores=g.players.map(p=>p.score);start(g,final);assert.equal(g.round,2);assert.equal(g.finalRound,final?2:null);assert.deepEqual(g.history,history);assert.deepEqual(g.players.map(p=>p.score),scores);assert.deepEqual(g.ballots,{});assert.equal(g.results,null);
});
for(const final of [false,true])test(`Keep playing after final results can start another round with asFinal ${final}`,()=>{
 const g=game();start(g,true);complete(g);start(g,final);assert.equal(g.phase,'playing');assert.equal(g.round,2);assert.equal(g.finalRound,final?2:null);
});
for(const final of [false,true])test(`discarded final results allow a new normal or final round (${final})`,()=>{
 const g=game();start(g,true);complete(g);applyAction(g,'p0',{type:'openDispute',round:1},now+30);for(const id of ['p0','p1'])applyAction(g,id,{type:'disputeVote',round:1,choice:'discard'},now+31);start(g,final);assert.equal(g.round,2);assert.equal(g.finalRound,final?2:null);assert.equal(g.history[0].review.status,'discarded');assert.deepEqual(g.players.map(p=>p.score),[0,0,0]);
});
test('a normal start can replace a previously saved next-final plan',()=>{
 const g=game();start(g);complete(g);applyAction(g,'p0',{type:'setFinalRound',round:1,expectedFinalRound:null,enabled:true},now+30);assert.equal(g.finalRound,2);start(g,false);assert.equal(g.round,2);assert.equal(g.finalRound,null);
});
test('a failed start cannot change a saved final designation',()=>{
 const g=game();g.finalRound=1;for(const p of g.players.slice(1))p.nextActive=false;const before=snapshot(g);assert.throws(()=>start(g,false),/At least two/);assert.deepEqual(g,before);
 const h=game();start(h,true);complete(h);for(const p of h.players.slice(1))p.nextActive=false;const saved=snapshot(h);assert.throws(()=>start(h,false),/At least two/);assert.deepEqual(h,saved);
});
test('both start choices require explicit booleans and a matching saved designation',()=>{
 const g=game();for(const asFinal of [null,undefined,'true',1,{},[]])assert.throws(()=>applyAction(g,'p0',choice(g,asFinal),now),/Choose Start/);
 for(const round of [undefined,null,'0',1])assert.throws(()=>applyAction(g,'p0',{...choice(g,true),round},now),/choice has changed/);
 for(const expectedFinalRound of [undefined,0,1,'1'])assert.throws(()=>applyAction(g,'p0',{...choice(g,true),expectedFinalRound},now),/choice has changed/);
 assert.equal(g.phase,'lobby');assert.equal(g.finalRound,null);
});
test('another device changing the final designation invalidates an open start choice',()=>{
 const g=game();start(g);complete(g);const pending=choice(g,true);applyAction(g,'p0',{type:'setFinalRound',round:1,expectedFinalRound:null,enabled:true},now+30);const before=snapshot(g);assert.throws(()=>applyAction(g,'p0',pending,now+31),/choice has changed/);assert.deepEqual(g,before);
});
test('duplicate and stale starts cannot deal twice, even after the next results arrive',()=>{
 const g=game(),action=choice(g,true);applyAction(g,'p0',action,now,n=>n-1);assert.throws(()=>applyAction(g,'p0',action,now),/already started/);complete(g);const next=choice(g,false);applyAction(g,'p0',next,now,n=>n-1);assert.throws(()=>applyAction(g,'p0',next,now),/after the results/);complete(g);const before=snapshot(g);assert.throws(()=>applyAction(g,'p0',next,now),/moved on/);assert.deepEqual(g,before);
});
test('admin transfer, pause and dispute restrictions apply to either choice',()=>{
 for(const final of [false,true]){
  const g=game();assert.throws(()=>applyAction(g,'p1',choice(g,final),now),/Only the admin/);start(g);complete(g);applyAction(g,'p0',{type:'pause'},now+30);assert.throws(()=>start(g,final),/Resume/);applyAction(g,'p0',{type:'resume'},now+31);applyAction(g,'p1',{type:'openDispute',round:1},now+32);assert.throws(()=>start(g,final),/dispute vote/);
  const h=game();const pending=choice(h,final);applyAction(h,'p0',{type:'ready',ready:false,newAdminId:'p1'},now);assert.throws(()=>applyAction(h,'p0',pending,now),/Only the admin/);applyAction(h,'p1',pending,now,n=>n-1);assert.equal(h.finalRound,final?1:null);
 }
});
for(const n of [2,6,10,30])test(`the choice respects changing readiness and the ${n}-player role rules`,()=>{
 const g=game(n===30?29:n);start(g);complete(g);addPlayer(g,{id:'late',name:'Taylor'});if(n<30)g.players[1].nextActive=false;start(g,true);assert.equal(g.active.length,n);assert.ok(g.active.includes('late'));if(n<30){assert.ok(!g.active.includes('p1'));assert.equal(publicView(g,'p1').secret,null);}assert.equal(g.finalRound,2);assert.equal(publicView(g,'late').me.roundsPlayed,0);
});
test('an ended game cannot start either kind of round',()=>{
 const g=game();start(g,true);complete(g);applyAction(g,'p0',{type:'finishGame',round:1},now+30);for(const final of [false,true])assert.throws(()=>start(g,final),/after the results/);assert.equal(g.phase,'ended');
});
