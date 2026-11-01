import test from 'node:test';
import assert from 'node:assert/strict';
import {makeGame,addPlayer,applyAction,publicView} from '../lib/game/engine.mjs';

const now=1000000;
function game(phase='lobby'){
  const g=makeGame('ABC234','Admin handover',{id:'a',name:'Alex',loginHash:'alex-code',tokenHashes:['alex-token']},now);
  addPlayer(g,{id:'b',name:'Ben',loginHash:'ben-code',tokenHashes:['ben-token']});
  addPlayer(g,{id:'c',name:'Charlie'});
  if(phase!=='lobby')applyAction(g,'a',{type:'start'},now,n=>n-1);
  if(['voting','results'].includes(phase))applyAction(g,'a',{type:'roundtable'},now);
  if(phase==='results')applyAction(g,'a',{type:'finishVoting'},now);
  return g;
}
const player=(g,id)=>g.players.find(p=>p.id===id);
const roundState=g=>structuredClone({phase:g.phase,round:g.round,roles:g.roles,active:g.active,ballots:g.ballots,deadline:g.deadline,voteDeadline:g.voteDeadline,pausedAt:g.pausedAt,mission:g.mission,signal:g.signal,results:g.results,history:g.history,players:g.players.map(({id,name,score,loginHash,tokenHashes})=>({id,name,score,loginHash,tokenHashes}))});
const transfer=(g,type='leave',newAdminId='b',actor='a')=>applyAction(g,actor,{type,...(type==='ready'?{ready:false}:{}),newAdminId},now);

for(const phase of ['lobby','playing','voting','results'])for(const action of ['ready','leave'])test(`an admin can hand over and ${action==='ready'?'sit out':'leave'} during ${phase} without changing the round`,()=>{
  const g=game(phase),before=roundState(g);transfer(g,action);
  assert.equal(g.adminId,'b');assert.equal(g.adminRevision,1);assert.equal(player(g,'a').nextActive,false);
  assert.equal(!!player(g,'a').left,action==='leave');assert.equal(player(g,'b').nextActive,true);
  assert.deepEqual(roundState(g),before);
  assert.equal(publicView(g,'a',now).me.isAdmin,false);assert.equal(publicView(g,'b',now).me.isAdmin,true);
  assert.equal(publicView(g,'b',now).me.adminRevision,1);assert.equal(publicView(g,'a',now).me.adminRevision,0);
  assert.equal(publicView(g,'c',now).players.filter(p=>p.isAdmin).length,1);
});

test('an admin can sit out and keep every admin permission',()=>{
  const g=game();applyAction(g,'a',{type:'ready',ready:false},now);assert.equal(g.adminId,'a');assert.equal(g.adminRevision,0);
  applyAction(g,'a',{type:'start'},now,n=>n-1);assert.equal(publicView(g,'a',now).secret,null);
  applyAction(g,'a',{type:'roundtable'},now);applyAction(g,'a',{type:'finishVoting'},now);assert.equal(g.phase,'results');
});

test('the old admin immediately loses all admin actions, including in a stale tab',()=>{
  const g=game('playing');transfer(g,'ready');const before=structuredClone(g);
  for(const type of ['start','nextRound','roundtable','finishVoting','pause','resume','end'])assert.throws(()=>applyAction(g,'a',{type,round:g.round},now),/Only the admin/);
  assert.throws(()=>transfer(g,'leave','c'),/Only the admin/);assert.deepEqual(g,before);
});

test('the new admin can manage every phase using their existing player identity',()=>{
  const g=game(),credentials=structuredClone(player(g,'b'));transfer(g);
  assert.equal(player(g,'b').loginHash,credentials.loginHash);assert.deepEqual(player(g,'b').tokenHashes,credentials.tokenHashes);
  applyAction(g,'b',{type:'start'},now,n=>n-1);assert.deepEqual(g.active,['b','c']);
  applyAction(g,'b',{type:'pause'},now);applyAction(g,'b',{type:'resume'},now);
  applyAction(g,'b',{type:'roundtable'},now);applyAction(g,'b',{type:'finishVoting'},now);
  applyAction(g,'b',{type:'nextRound',round:g.round},now,n=>n-1);assert.equal(g.round,2);
  applyAction(g,'b',{type:'end'},now);assert.equal(g.phase,'ended');
});

test('ordinary players cannot give themselves or anyone else admin access',()=>{
  for(const action of ['ready','leave'])for(const target of ['a','b','c']){
    const g=game('playing'),before=structuredClone(g);
    assert.throws(()=>transfer(g,action,target,'b'),/Only the admin/);assert.deepEqual(g,before);
  }
});

test('bad and cross-game replacements leave admin access and readiness unchanged',()=>{
  for(const action of ['ready','leave'])for(const target of ['a','','outside-this-game',null,undefined,7,{},[]]){
    const g=game('playing'),before=structuredClone(g);
    assert.throws(()=>applyAction(g,'a',{type:action,...(action==='ready'?{ready:false}:{}),newAdminId:target},now),/Choose another|no longer available/);assert.deepEqual(g,before);
  }
});

test('leaving without a replacement is blocked even for older clients and a lone admin',()=>{
  for(const alone of [false,true]){
    const g=game();if(alone)g.players=g.players.slice(0,1);const before=structuredClone(g);
    assert.throws(()=>applyAction(g,'a',{type:'leave'},now),/Choose another admin before leaving, or end/);assert.deepEqual(g,before);
    applyAction(g,'a',{type:'end'},now);assert.equal(g.phase,'ended');
  }
});

test('a person who left cannot receive admin access, including from a stale choice',()=>{
  const g=game('playing');applyAction(g,'b',{type:'leave'},now);const before=structuredClone(g);
  for(const action of ['ready','leave'])assert.throws(()=>transfer(g,action),/no longer available/);
  assert.deepEqual(g,before);assert.equal(publicView(g,'c',now).players.find(p=>p.id==='b').left,true);
});

test('someone sitting out can still take over as admin',()=>{
  const g=game('playing');applyAction(g,'b',{type:'ready',ready:false},now);transfer(g);
  assert.equal(g.adminId,'b');assert.equal(player(g,'b').nextActive,false);
  applyAction(g,'b',{type:'roundtable'},now);assert.equal(g.phase,'voting');
});

test('a late arrival can take over without joining the current round or seeing its roles',()=>{
  const g=game('playing');addPlayer(g,{id:'late',name:'Taylor'});const assigned=structuredClone(g.roles);
  transfer(g,'leave','late');const v=publicView(g,'late',now);
  assert.equal(v.me.isAdmin,true);assert.equal(v.me.active,false);assert.equal(v.secret,null);assert.deepEqual(g.roles,assigned);
  for(const p of v.players){assert.equal(p.role,undefined);assert.equal(p.loginHash,undefined);assert.equal(p.tokenHashes,undefined);}
  applyAction(g,'late',{type:'roundtable'},now);assert.equal(g.phase,'voting');
});

test('handover is allowed while paused and the replacement can resume the same timer',()=>{
  for(const phase of ['playing','voting']){
    const g=game(phase);applyAction(g,'a',{type:'pause'},now);const before=roundState(g);transfer(g);
    assert.deepEqual(roundState(g),before);applyAction(g,'b',{type:'resume'},now+5000);
    assert.equal(g.pausedAt,null);if(phase==='playing')assert.equal(g.deadline,before.deadline+5000);
  }
});

test('admin transfer can only accompany sitting out or leaving, not joining a round',()=>{
  const g=game(),before=structuredClone(g);
  for(const ready of [true,undefined,'false',null])assert.throws(()=>applyAction(g,'a',{type:'ready',ready,newAdminId:'b'},now),/only be passed|Choose whether/);
  assert.deepEqual(g,before);
});

test('duplicate and competing handovers cannot replace the winning admin again',()=>{
  const g=game('playing');transfer(g,'leave','b');const committed=structuredClone(g);
  for(const target of ['b','c'])assert.throws(()=>transfer(g,'leave',target),/Only the admin/);
  assert.deepEqual(g,committed);assert.equal(g.adminRevision,1);
});

test('returning restores readiness but does not restore the previous admin privilege',()=>{
  const g=game();transfer(g);applyAction(g,'a',{type:'ready',ready:true},now);
  assert.equal(player(g,'a').left,false);assert.equal(player(g,'a').nextActive,true);assert.equal(publicView(g,'a',now).me.isAdmin,false);
  transfer(g,'ready','a','b');assert.equal(g.adminId,'a');assert.equal(g.adminRevision,2);assert.equal(publicView(g,'a',now).me.adminRevision,2);
});

test('leaving during voting keeps the current ballot and its missed-vote score intact',()=>{
  const g=game('voting'),assigned=structuredClone(g.roles);transfer(g);
  assert.deepEqual(g.active,['a','b','c']);assert.deepEqual(g.roles,assigned);
  applyAction(g,'b',{type:'finishVoting'},now);assert.equal(g.results.totalActive,3);
  assert.equal(g.results.players.find(p=>p.id==='a').submitted,false);
  assert.equal(g.results.players.find(p=>p.id==='a').delta,-2);
});

test('handover works for saved games without the new optional fields and survives serialization',()=>{
  const g=game('results');delete g.adminRevision;transfer(g,'ready');
  const restored=JSON.parse(JSON.stringify(g));assert.equal(restored.adminId,'b');assert.equal(restored.adminRevision,1);
  assert.equal(publicView(restored,'b',now).me.isAdmin,true);assert.equal(player(restored,'a').nextActive,false);
  applyAction(restored,'b',{type:'nextRound',round:restored.round},now,n=>n-1);assert.equal(restored.phase,'playing');
});

test('ended games cannot transfer admin control or change readiness',()=>{
  const g=game();applyAction(g,'a',{type:'end'},now);const before=structuredClone(g);
  for(const action of ['ready','leave'])assert.throws(()=>transfer(g,action),/ended/);assert.deepEqual(g,before);
});
