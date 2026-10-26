import test from 'node:test';
import assert from 'node:assert/strict';
import {makeGame,addPlayer,startRound,openVoting,applyAction,publicView,validateRoundMinutes,ROUND_MS,BREAK_MS,CONTENT,tick} from '../lib/game/engine.mjs';
const now=1000000;
function fixture(minutes=60){
  const g=makeGame('ABC234','Options',{id:'p0',name:'Admin'},now,minutes);
  for(let i=1;i<6;i++)addPlayer(g,{id:`p${i}`,name:`Player ${i}`});
  startRound(g,now,n=>n-1);return g;
}
for(const minutes of [30,60,90,120,150,1440,10080,30000])test(`round length accepts ${minutes} minutes and persists between rounds`,()=>{
  const g=fixture(minutes);assert.equal(g.deadline,now+minutes*60000);assert.equal(publicView(g,'p2',now).roundMinutes,minutes);
  tick(g,g.deadline-1);assert.equal(g.phase,'playing');tick(g,g.deadline);assert.equal(g.phase,'voting');
  applyAction(g,'p0',{type:'finishVoting'},g.deadline??now+minutes*60000);
  const next=g.deadline;tick(g,next,()=>0);assert.equal(g.deadline,next+minutes*60000);assert.equal(g.roundMinutes,minutes);
});
for(const value of [0,-30,15,45,30.5,'60',null,NaN,Infinity,Number.MAX_SAFE_INTEGER])test(`invalid round length ${String(value)} is rejected`,()=>assert.throws(()=>validateRoundMinutes(value),/30-minute steps/));
test('new Games and existing Games without a duration default to 60 minutes',()=>{
  const g=fixture();assert.equal(g.roundMinutes,60);delete g.roundMinutes;
  assert.equal(publicView(g,'p2',now).roundMinutes,60);startRound(g,now,n=>n-1);assert.equal(g.deadline,now+ROUND_MS);
});
for(const count of [0,1,3])test(`admin can finish voting with ${count} of six submitted`,()=>{
  const g=fixture();openVoting(g);
  for(const id of g.active.slice(0,count))applyAction(g,id,{type:'ballot',target:g.roles[id]==='traitor'?null:'p0'},now);
  applyAction(g,'p0',{type:'finishVoting'},now+1000);
  assert.equal(g.phase,'results');assert.equal(g.results.submittedCount,count);assert.equal(g.deadline,now+1000+BREAK_MS);
  assert.equal(g.history.length,1);assert.equal(g.voteDeadline,null);
  for(const p of g.results.players.filter(p=>!p.submitted&&p.role==='faithful'))assert.equal(p.delta,-1);
});
test('only the admin can finish voting and paused voting must be resumed first',()=>{
  const g=fixture();openVoting(g);assert.throws(()=>applyAction(g,'p2',{type:'finishVoting'},now),/Only the admin/);
  applyAction(g,'p0',{type:'pause'},now);assert.throws(()=>applyAction(g,'p0',{type:'finishVoting'},now),/Resume/);
  assert.equal(g.history.length,0);applyAction(g,'p0',{type:'resume'},now+1000);applyAction(g,'p0',{type:'finishVoting'},now+1000);assert.equal(g.history.length,1);
});
test('repeating Finish voting or reaching its deadline scores the round only once',()=>{
  const g=fixture();openVoting(g);for(const id of ['p0','p1','p2'])applyAction(g,id,{type:'ballot',target:g.roles[id]==='traitor'?null:'p0'},now);
  const deadline=g.voteDeadline;applyAction(g,'p0',{type:'finishVoting'},deadline);
  const scores=g.players.map(p=>p.score);applyAction(g,'p0',{type:'finishVoting'},deadline+1000);
  assert.equal(g.history.length,1);assert.deepEqual(g.players.map(p=>p.score),scores);
});
test('Finish voting is unavailable before a roundtable or after the Game ends',()=>{
  const g=fixture();assert.throws(()=>applyAction(g,'p0',{type:'finishVoting'},now),/Voting is not open/);
  applyAction(g,'p0',{type:'end'},now);assert.throws(()=>applyAction(g,'p0',{type:'finishVoting'},now),/Voting is not open/);
});
test('the murder method stays private until results and is retained when later tasks change',()=>{
  const g=fixture();g.mission={...CONTENT.murders[0]};const method={...g.mission};
  assert.equal(publicView(g,'p2',now).secret.mission,undefined);openVoting(g);
  for(const id of ['p0','p1'])applyAction(g,id,{type:'ballot',target:'p2'},now);
  assert.equal(publicView(g,'p2',now).results,null);applyAction(g,'p0',{type:'finishVoting'},now);
  assert.deepEqual(g.results.murderMethod,method);assert.notEqual(g.results.murderMethod,g.mission);
  g.mission.title='Changed task';assert.deepEqual(g.history[0].murderMethod,method);
  tick(g,g.deadline,()=>0);assert.deepEqual(publicView(g,'p2',g.deadline).history[0].murderMethod,method);
});
test('results without a confirmed murder do not name a successful murder method',()=>{
  const g=fixture();openVoting(g);applyAction(g,'p0',{type:'ballot',target:'p2'},now);applyAction(g,'p1',{type:'ballot',target:'p3'},now);
  applyAction(g,'p0',{type:'finishVoting'},now);assert.equal(g.results.murderedId,null);assert.equal(g.results.murderMethod,null);
});
