import test from 'node:test';
import assert from 'node:assert/strict';
import {makeGame,addPlayer,startRound,openVoting,applyAction,finishRound,publicView,tick,traitorWeights,MIN_PLAYERS,ROUND_RULES_VERSION,VOTE_MS,ROUND_MS} from '../lib/game/engine.mjs';
const nextRound=(g,at,rng)=>applyAction(g,g.adminId,{type:'nextRound',round:g.round},at,rng);
const now=1000000;
function lobby(count=2){const g=makeGame('ABC234','Two-player test',{id:'p0',name:'Alex'},now);for(let i=1;i<count;i++)addPlayer(g,{id:`p${i}`,name:`Guest ${i}`});return g;}
function game(killer=false){const g=lobby();startRound(g,now,killer?n=>n-1:()=>0);return g;}
const vote=(g,id,target,suspectedAttempt=false,time=now)=>applyAction(g,id,{type:'ballot',target,suspectedAttempt},time);
const report=(g,target,time=now)=>applyAction(g,'p0',{type:'ballot',target},time);
const result=(g,id)=>g.results.players.find(p=>p.id===id);

test('two ready players can start with the unchanged sixty-minute default',()=>{
  const g=lobby();assert.equal(MIN_PLAYERS,2);applyAction(g,'p0',{type:'start'},now,()=>0);
  assert.equal(g.phase,'playing');assert.equal(g.active.length,2);assert.equal(g.roundMinutes,60);assert.equal(g.deadline,now+ROUND_MS);
  assert.equal(g.roundRulesVersion,ROUND_RULES_VERSION);assert.equal(publicView(g,'p1',now).roundMode,'two-player');
});
test('the zero-or-one draw is separate from the weighted player draw',()=>{
  const counts={0:0,1:0};
  for(const first of [0,1])for(const playerDraw of [0,1]){
    const g=lobby(),ranges=[];startRound(g,now,n=>{ranges.push(n);return ranges.length===1?first:ranges.length===2?playerDraw:0;});
    assert.equal(ranges[0],2);counts[g.traitorCount]++;
    assert.equal(Object.values(g.roles).filter(role=>role==='traitor').length,first);
    if(!first){assert.deepEqual(ranges,[2]);assert.equal(g.mission,null);assert.equal(g.signal,null);assert.equal(g.usedTaskIds,undefined);}
    else{assert.equal(g.roles[playerDraw===0?'p1':'p0'],'traitor');assert.ok(g.mission);assert.equal(g.signal,null);}
  }
  assert.deepEqual(counts,{0:2,1:2});
});
test('two-player rounds use fresh cryptographic entropy and never assign two killers',t=>{
  let value=0;const entropy=t.mock.method(globalThis.crypto,'getRandomValues',array=>{array[0]=value;return array;});
  const g=lobby();startRound(g,now);assert.equal(g.traitorCount,0);const calls=entropy.mock.callCount();
  openVoting(g);vote(g,'p0',null);vote(g,'p1',null);value=1;nextRound(g,now);
  assert.ok(entropy.mock.callCount()>calls);assert.equal(g.traitorCount,1);assert.equal(g.round,2);
});
test('weighting still favours fewer killer turns while keeping everyone eligible',()=>{
  const g=game(true);openVoting(g);report(g,null);vote(g,'p1',null);const weights=traitorWeights(g,g.active);
  assert.ok(weights.p0<weights.p1);assert.ok(weights.p0>0);
  for(const ticket of [0,weights.p0]){
    const restored=structuredClone(g);let call=0;nextRound(restored,now,n=>++call===1?1:call===2?ticket:0);
    assert.equal(restored.traitorCount,1);assert.equal(restored.roles[ticket===0?'p0':'p1'],'traitor');
  }
});
for(const phase of ['playing','voting','paused','ended'])test(`an Innocent cannot distinguish zero and one killer from the ${phase} public view`,()=>{
  const none=game(false),one=game(true);
  for(const g of [none,one]){
    if(phase==='voting'||phase==='paused')openVoting(g);
    if(phase==='paused')applyAction(g,'p0',{type:'pause'},now);
    if(phase==='ended')applyAction(g,'p0',{type:'end'},now);
  }
  assert.deepEqual(publicView(none,'p1',now),publicView(one,'p1',now));
  assert.equal(publicView(one,'p1',now).traitorCount,null);assert.equal(publicView(one,'p1',now).nextTraitorCount,null);
});
test('admin and waiting players do not gain the hidden count, task or roles',()=>{
  for(const g of [game(false),game(true)]){
    addPlayer(g,{id:'late',name:'Late'});
    for(const id of ['p0','p1','late']){const v=publicView(g,id,now);assert.equal(v.traitorCount,null);assert.equal(v.nextTraitorCount,1);assert.ok(v.players.every(p=>p.role===undefined));assert.equal(v.results,null);assert.equal(v.mission,undefined);assert.equal(v.roles,undefined);}
    assert.equal(publicView(g,'late',now).secret,null);assert.equal(publicView(g,'p1',now).secret.mission,undefined);
  }
});

for(const accuse of [false,true])for(const answer of [false,true])test(`both Innocent: accuse=${accuse}, awareness=${answer}`,()=>{
  const g=game(false);openVoting(g);vote(g,'p0',accuse?'p1':null,answer);vote(g,'p1','p0',false);
  assert.equal(g.phase,'results');assert.equal(g.results.mode,'two-player');assert.equal(g.results.murderedId,null);
  assert.equal(result(g,'p0').delta,(accuse?-1:2)+(accuse&&answer?-1:0));assert.equal(result(g,'p1').delta,-1);
  assert.equal(result(g,'p0').noKiller,!accuse);assert.equal(result(g,'p0').reason.includes('Most accusations'),false);
  assert.equal(publicView(g,'p0',now).traitorCount,0);
});
for(const killed of [false,true])for(const accuse of [false,true])for(const answer of [false,true])test(`one killer: murder=${killed}, accused=${accuse}, awareness=${answer}`,()=>{
  const g=game(true);openVoting(g);report(g,killed?'p1':null);vote(g,'p1',accuse?'p0':null,answer);
  const awareness=accuse?(answer?(killed?1:-1):(killed?-1:0)):0;
  assert.equal(result(g,'p1').delta,(accuse?4:-1)+awareness);
  assert.equal(result(g,'p0').delta,killed?(accuse?1:6):(accuse?-2:0));
  assert.equal(result(g,'p1').murdered,killed);assert.equal(result(g,'p0').caught,accuse);
  assert.equal(result(g,'p1').noKiller,!accuse);assert.equal(result(g,'p1').awareness.points,awareness);
  assert.equal(publicView(g,'p1',now).traitorCount,1);
});
test('No killer is an explicit locked submission that starts the five-minute timer',()=>{
  const g=game(false);openVoting(g);vote(g,'p0',null,false);
  assert.equal(g.phase,'voting');assert.equal(g.voteDeadline,now+VOTE_MS);assert.equal(publicView(g,'p0',now).submittedCount,1);
  assert.deepEqual(publicView(g,'p0',now).myBallot,{kind:'accusation',targetId:null});
  assert.equal(publicView(g,'p1',now).myBallot,null);assert.equal(publicView(g,'p1',now).traitorCount,null);
  assert.throws(()=>vote(g,'p0','p1'),/locked/);tick(g,now+VOTE_MS);
  assert.equal(g.phase,'results');assert.equal(result(g,'p0').delta,2);assert.equal(result(g,'p1').delta,-2);
  assert.equal(result(g,'p1').noKiller,false);assert.equal(result(g,'p1').awareness.points,0);
});
test('a missing Innocent vote cannot award the killer an escape bonus',()=>{
  const g=game(true);openVoting(g);report(g,'p1');tick(g,g.voteDeadline);
  assert.equal(result(g,'p0').delta,4);assert.equal(result(g,'p1').delta,-2);
});
test('accusing the other player requires an awareness answer, while No killer rejects performer claims',()=>{
  const g=game(false);openVoting(g);
  for(const answer of [undefined,null,0,'false'])assert.throws(()=>applyAction(g,'p0',{type:'ballot',target:'p1',suspectedAttempt:answer},now),/Choose Yes or No/);
  assert.throws(()=>applyAction(g,'p0',{type:'ballot',target:null,suspectedAttempt:false,performed:true},now),/Innocent/);
  assert.deepEqual(g.ballots,{});assert.equal(g.voteDeadline,null);
});
test('group ballots and old rules cannot choose No killer; self accusations are still invalid',()=>{
  const g=lobby(3);startRound(g,now,n=>n-1);openVoting(g);assert.throws(()=>vote(g,'p1',null),/another player/);
  const pair=game(false);openVoting(pair);assert.throws(()=>vote(pair,'p0','p0'),/another player/);
  pair.roundRulesVersion=4;assert.throws(()=>vote(pair,'p0',null),/another player/);
});
test('pausing voting freezes its deadline and blocks every ballot choice',()=>{
  const g=game(false);openVoting(g);vote(g,'p0',null);applyAction(g,'p0',{type:'pause'},now+1000);
  assert.throws(()=>vote(g,'p1',null,false,now+100000),/paused/);tick(g,now+VOTE_MS+100000);assert.equal(g.phase,'voting');
  applyAction(g,'p0',{type:'resume'},now+11000);assert.equal(g.voteDeadline,now+VOTE_MS+10000);
  vote(g,'p1',null,false,now+11000);assert.equal(g.phase,'results');
});
test('joining a pair during play, voting or results changes only the next deal',()=>{
  for(const phase of ['playing','voting','results']){
    const g=game(false);if(phase!=='playing')openVoting(g);if(phase==='results')finishRound(g,now);
    const assigned={...g.roles};addPlayer(g,{id:'late',name:'Late'});
    assert.deepEqual(g.roles,assigned);assert.equal(g.active.length,2);assert.equal(publicView(g,'late',now).secret,null);
    assert.equal(publicView(g,'p0',now).roundMode,'two-player');
    if(phase==='playing')openVoting(g);if(g.phase==='voting'){assert.throws(()=>vote(g,'late',null),/next round/);finishRound(g,now);}
    const saved=structuredClone(g.results);tick(g,now+5000);assert.equal(g.phase,'results');nextRound(g,now,n=>n-1);
    assert.equal(g.active.length,3);assert.equal(g.traitorCount,1);assert.equal(publicView(g,'late',g.deadline).roundMode,'group');
    assert.ok(publicView(g,'late',g.deadline).secret);assert.deepEqual(g.history[0],saved);openVoting(g);assert.throws(()=>vote(g,'p1',null),/another player/);
  }
});
test('a group can shrink to two, grow to six, and shrink to two again without changing its duration or history',()=>{
  const g=lobby(6);g.roundMinutes=90;startRound(g,now,n=>n-1);
  const sizes=[2,6,2];
  for(const size of sizes){
    for(const [i,p] of g.players.entries())applyAction(g,p.id,{type:'ready',ready:i<size},now);
    const roles={...g.roles},oldActive=[...g.active];openVoting(g);assert.deepEqual(g.roles,roles);assert.deepEqual(g.active,oldActive);finishRound(g,now);
    const saved=structuredClone(g.history),scores=g.players.map(p=>p.score);nextRound(g,now,n=>n-1);
    assert.equal(g.active.length,size);assert.equal(publicView(g,'p0',now).roundMode,size===2?'two-player':'group');
    assert.equal(g.roundMinutes,90);assert.equal(g.deadline,now+90*60000);
    assert.deepEqual(g.history,saved);assert.deepEqual(g.players.map(p=>p.score),scores);
  }
});
test('leaving marks only the authenticated player out of future rounds and preserves the current round',()=>{
  const g=lobby(3);startRound(g,now,n=>n-1);const current={roles:{...g.roles},active:[...g.active],deadline:g.deadline};
  applyAction(g,'p2',{type:'leave'},now);assert.equal(g.players[2].nextActive,false);assert.ok(g.players.slice(0,2).every(p=>p.nextActive));
  assert.deepEqual(g.roles,current.roles);assert.deepEqual(g.active,current.active);assert.equal(g.deadline,current.deadline);assert.equal(g.players.length,3);
  openVoting(g);finishRound(g,now);nextRound(g,now,()=>0);assert.equal(g.active.length,2);assert.equal(publicView(g,'p2',now).me.active,false);
  const score=g.players[2].score;applyAction(g,'p2',{type:'ready',ready:true},now);openVoting(g);finishRound(g,now);nextRound(g,now,n=>n-1);
  assert.equal(g.active.length,3);assert.equal(g.players[2].score,score);assert.ok(publicView(g,'p2',now).secret);
});
test('an admin can sit out without losing admin access while two others keep playing',()=>{
  const g=lobby(3);startRound(g,now,n=>n-1);applyAction(g,'p0',{type:'leave'},now);openVoting(g);finishRound(g,now);nextRound(g,now,()=>0);
  const admin=publicView(g,'p0',now);assert.equal(admin.me.isAdmin,true);assert.equal(admin.me.active,false);assert.equal(admin.secret,null);assert.equal(admin.traitorCount,null);
  applyAction(g,'p0',{type:'roundtable'},now);assert.equal(g.phase,'voting');applyAction(g,'p0',{type:'finishVoting'},now);assert.equal(g.phase,'results');
});
test('a pair dropping below two waits on results until a player returns',()=>{
  const g=game(false);applyAction(g,'p1',{type:'leave'},now);openVoting(g);vote(g,'p0',null);finishRound(g,now);tick(g,now+86400000);
  assert.equal(g.phase,'results');assert.equal(g.deadline,null);assert.throws(()=>nextRound(g,now),/two players/);
  applyAction(g,'p1',{type:'ready',ready:true},now);nextRound(g,now,()=>0);assert.equal(g.phase,'playing');assert.equal(g.round,2);
});
test('old group rounds retain scoring while their next deal can use two-player rules',()=>{
  const g=lobby(3);startRound(g,now,n=>n-1);g.roundRulesVersion=4;applyAction(g,'p2',{type:'leave'},now);openVoting(g);
  applyAction(g,'p0',{type:'ballot',target:null},now);vote(g,'p1','p0');finishRound(g,now);
  const saved=structuredClone(g.results);assert.equal(saved.rulesVersion,4);assert.equal(result(g,'p1').delta,4);
  nextRound(g,now,()=>0);assert.equal(g.roundRulesVersion,ROUND_RULES_VERSION);assert.equal(g.active.length,2);assert.equal(g.traitorCount,0);assert.deepEqual(g.history[0],saved);
});
test('both-Innocent rounds do not use up or repeat tasks when a killer returns',()=>{
  const g=game(true),task=g.mission.id,used=structuredClone(g.usedTaskIds);openVoting(g);finishRound(g,now);nextRound(g,now,()=>0);
  assert.equal(g.traitorCount,0);assert.equal(g.mission,null);assert.deepEqual(g.usedTaskIds,used);
  openVoting(g);finishRound(g,now);nextRound(g,now,n=>n-1);assert.equal(g.traitorCount,1);assert.notEqual(g.mission.id,task);
});
test('repeated finish requests do not score a No killer ballot twice',()=>{
  const g=game(false);openVoting(g);vote(g,'p0',null);vote(g,'p1',null);const saved=structuredClone(g.results);
  applyAction(g,'p0',{type:'finishVoting'},now+1);assert.deepEqual(g.results,saved);assert.equal(g.history.length,1);assert.equal(g.players[0].score,2);
});

test('No killer accepts an omitted answer and awards no awareness points, even for a completed murder',()=>{
  const g=game(true);openVoting(g);applyAction(g,'p1',{type:'ballot',target:null},now);report(g,'p1');
  assert.equal(result(g,'p1').delta,-1);assert.equal(result(g,'p1').murdered,true);
  assert.deepEqual(result(g,'p1').awareness,{answer:null,taskCompleted:true,points:0,skipped:true});
});
for(const staleAnswer of [false,true])test(`an older form sending a No killer awareness answer (${staleAnswer}) is safely ignored`,()=>{
  const g=game(false);openVoting(g);vote(g,'p0',null,staleAnswer);applyAction(g,'p1',{type:'ballot',target:null},now);
  assert.equal(g.ballots.p0.suspectedAttempt,undefined);assert.equal(result(g,'p0').delta,2);assert.equal(result(g,'p0').awareness.skipped,true);
});
test('version 5 preserves a locked awareness answer but lets unsubmitted No killer votes skip it',()=>{
  const g=game(false);g.roundRulesVersion=5;openVoting(g);vote(g,'p0',null,true);
  assert.equal(g.ballots.p0.suspectedAttempt,true);applyAction(g,'p1',{type:'ballot',target:null},now);
  assert.equal(result(g,'p0').delta,1);assert.equal(result(g,'p0').awareness.points,-1);assert.equal(result(g,'p0').awareness.skipped,undefined);
  assert.equal(result(g,'p1').delta,2);assert.equal(result(g,'p1').awareness.skipped,true);
});
