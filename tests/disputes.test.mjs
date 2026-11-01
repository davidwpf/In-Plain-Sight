import test from 'node:test';
import assert from 'node:assert/strict';
import {makeGame,addPlayer,applyAction,publicView,tick,traitorWeights} from '../lib/game/engine.mjs';
import {DISPUTE_MS} from '../lib/game/disputes.mjs';
import {resultOutcome,personalResult,scoreBreakdown,roundSummary} from '../lib/game/presentation.mjs';
import {nextEventAt} from '../lib/notifications/server.mjs';
import {pollDelay} from '../lib/game/polling.mjs';
const now=1800000000000;
function completed(n=6){
  const g=makeGame('ABC234','Disputes',{id:'p0',name:'Alex'},now);
  for(let i=1;i<n;i++)addPlayer(g,{id:`p${i}`,name:`Player ${i}`});
  applyAction(g,'p0',{type:'start'},now,n=>n-1);
  applyAction(g,'p0',{type:'roundtable'},now+1);
  // A real scored round, with positive points, negative points and extras.
  const victim=g.active.find(id=>g.roles[id]==='faithful'),killer=g.active.find(id=>g.roles[id]==='traitor');
  for(const id of g.active){
    if(g.roles[id]==='traitor')applyAction(g,id,{type:'ballot',target:victim,performed:true},now+2);
    else applyAction(g,id,{type:'ballot',target:killer??null,...(killer?{suspectedAttempt:id===victim}:{})},now+2);
  }
  return g;
}
const open=(g,id='p0',at=now+100)=>applyAction(g,id,{type:'openDispute',round:g.round},at);
const vote=(g,id,choice,at=now+200)=>applyAction(g,id,{type:'disputeVote',round:g.round,choice},at);
const scores=g=>g.players.map(p=>p.score);
const restored=g=>JSON.parse(JSON.stringify(g));

test('any round participant can open a dispute and the two-minute timer starts immediately',()=>{
  const g=completed();open(g,'p2');assert.equal(g.dispute.deadline,now+100+DISPUTE_MS);assert.equal(g.dispute.status,'open');assert.deepEqual(g.dispute.votes,{});
  assert.equal(g.phase,'results');assert.equal(nextEventAt(g),g.dispute.deadline);
  assert.equal(publicView(g,'p2',now).dispute.majority,4);
});
test('disputes are optional and completed legacy rounds without dispute fields still work',()=>{
  const g=completed();delete g.dispute;assert.equal(publicView(g,'p0').dispute,null);const saved=restored(g.results),old=scores(g);tick(g,now+7*86400000);assert.deepEqual(g.results,saved);assert.deepEqual(scores(g),old);open(g);assert.equal(g.dispute.status,'open');
});
test('a strict full-roster majority to discard reverses all saved deltas, exactly once after persistence',()=>{
  let g=completed(),original=restored(g.results);g=restored(g);open(g);
  for(let i=0;i<4;i++)vote(g,`p${i}`,'discard');
  assert.equal(g.dispute.status,'discarded');assert.deepEqual(scores(g),Array(6).fill(0));
  assert.equal(g.results.review.resolution,'majority');assert.equal(g.results.review.adminTieBreak,null);
  for(const p of g.results.players){assert.equal(p.delta,0);assert.equal(p.score,0);assert.equal(p.originalDelta,original.players.find(o=>o.id===p.id).delta);}
  assert.deepEqual(g.results,g.history[0]);g=restored(g);for(let i=0;i<3;i++)tick(g,now+DISPUTE_MS+1000);
  assert.deepEqual(scores(g),Array(6).fill(0));assert.throws(()=>vote(g,'p4','discard'),/closed/);assert.throws(()=>open(g),/already had/);
});
test('direct in-memory results/history aliases do not zero original deltas twice',()=>{
  const g=completed();assert.equal(g.results,g.history[0]);const delta=g.results.players[0].delta;open(g);for(let i=0;i<4;i++)vote(g,`p${i}`,'discard');assert.equal(g.results.players[0].originalDelta,delta);assert.deepEqual(scores(g),Array(6).fill(0));
});
test('discarding the latest round preserves all earlier points, history and role exposure weights',()=>{
  const g=completed(),first=restored(g.history),old=scores(g);
  applyAction(g,'p0',{type:'nextRound',round:1},now+10,n=>n-1);applyAction(g,'p0',{type:'roundtable'},now+11);applyAction(g,'p0',{type:'finishVoting'},now+12);
  const weights=traitorWeights(g,g.active);open(g);for(let i=0;i<4;i++)vote(g,`p${i}`,'discard');
  assert.deepEqual(scores(g),old);assert.deepEqual(g.history[0],first[0]);assert.deepEqual(traitorWeights(g,g.active),weights);
  for(let i=0;i<6;i++)assert.equal(g.results.players[i].score,old[i]);
  applyAction(g,'p0',{type:'nextRound',round:2},now+300,n=>n-1);assert.equal(g.round,3);assert.equal(g.dispute,null);assert.deepEqual(scores(g),old);
  applyAction(g,'p0',{type:'roundtable'},now+301);applyAction(g,'p0',{type:'finishVoting'},now+302);open(g);assert.equal(g.dispute.round,3);
});
test('a majority to keep resolves early without modifying a single point or recorded result',()=>{
  const g=completed(),old=scores(g),original=restored(g.results);open(g);
  for(let i=0;i<4;i++)vote(g,`p${i}`,'keep');assert.equal(g.dispute.status,'kept');assert.deepEqual(scores(g),old);
  const {review,...rest}=g.results;assert.deepEqual(rest,original);assert.equal(review.resolution,'majority');assert.equal(nextEventAt(g),null);
});
for(const adminChoice of ['keep','discard'])test(`a full six-player tie gives the admin exactly one extra ${adminChoice} point`,()=>{
  const g=completed();open(g);const other=adminChoice==='keep'?'discard':'keep';
  vote(g,'p0',adminChoice);vote(g,'p1',other);assert.equal(g.dispute.status,'open','partial tie must wait');
  vote(g,'p2',adminChoice);vote(g,'p3',other);vote(g,'p4',adminChoice);assert.equal(g.dispute.status,'open');
  vote(g,'p5',other);assert.equal(g.dispute.status,adminChoice==='keep'?'kept':'discarded');assert.equal(g.results.review.adminTieBreak,adminChoice);assert.equal(g.results.review.keepVotes,3);assert.equal(g.results.review.discardVotes,3);assert.equal(g.results.review.resolution,'admin-tie');
});
for(const choice of ['keep','discard'])test(`two-player tie uses the admin's ${choice} vote`,()=>{
  const g=completed(2);open(g);vote(g,'p0',choice);assert.equal(g.dispute.status,'open');vote(g,'p1',choice==='keep'?'discard':'keep');assert.equal(g.dispute.status,choice==='keep'?'kept':'discarded');assert.equal(g.results.review.adminTieBreak,choice);
});
test('a tied vote at timeout can use the admin point if it reaches the full-roster majority',()=>{
  const g=completed(5);open(g);for(let i=0;i<4;i++)vote(g,`p${i}`,i%2?'keep':'discard');tick(g,g.dispute.deadline-1);assert.equal(g.dispute.status,'open');tick(g,g.dispute.deadline);assert.equal(g.dispute.status,'discarded');assert.equal(g.results.review.adminTieBreak,'discard');
});
test('a small partial tie cannot discard the round even with the admin extra point',()=>{
  const g=completed();open(g);vote(g,'p0','discard');vote(g,'p1','keep');tick(g,g.dispute.deadline);assert.equal(g.dispute.status,'kept');assert.equal(g.results.review.adminTieBreak,null);assert.equal(g.results.review.resolution,'timeout');
});
test('unanswered, insufficient and non-tied votes keep the round when the timer expires',()=>{
  for(const choices of [[],['discard'],['discard','discard','discard'],['keep','keep']]){
    const g=completed(),old=scores(g);open(g);choices.forEach((c,i)=>vote(g,`p${i}`,c));tick(g,g.dispute.deadline);assert.equal(g.dispute.status,'kept');assert.equal(g.results.review.adminTieBreak,null);assert.deepEqual(scores(g),old);
  }
});
test('an admin who does not vote has no extra point',()=>{
  const g=completed(5);open(g);for(let i=1;i<5;i++)vote(g,`p${i}`,i%2?'discard':'keep');tick(g,g.dispute.deadline);assert.equal(g.dispute.status,'kept');assert.equal(g.results.review.adminTieBreak,null);
});
test('new arrivals and sit-outs cannot vote; leaving or changing readiness does not change eligibility',()=>{
  const g=completed();addPlayer(g,{id:'late',name:'Taylor'});assert.throws(()=>open(g,'late'),/Only players/);open(g);
  const roster=[...g.dispute.eligibleIds];applyAction(g,'p1',{type:'leave'},now+110);applyAction(g,'p2',{type:'ready',ready:false},now+111);addPlayer(g,{id:'later',name:'Morgan'});
  assert.deepEqual(g.dispute.eligibleIds,roster);assert.throws(()=>vote(g,'late','discard'),/Only players/);assert.throws(()=>vote(g,'later','discard'),/Only players/);
  vote(g,'p1','keep');vote(g,'p2','keep');assert.equal(publicView(g,'p1').dispute.eligible,true);assert.equal(publicView(g,'late').dispute.eligible,false);
});
test('an admin who sat out the disputed round cannot break its tie',()=>{
  const g=completed(5);addPlayer(g,{id:'newAdmin',name:'Host'});applyAction(g,'p0',{type:'ready',ready:false,newAdminId:'newAdmin'},now+20);open(g,'p1');assert.equal(g.dispute.adminId,null);
  for(let i=0;i<4;i++)vote(g,`p${i}`,i%2?'discard':'keep');tick(g,g.dispute.deadline);assert.equal(g.dispute.status,'kept');assert.equal(g.results.review.adminTieBreak,null);
});
test('admin handover cannot change an open dispute tie-breaker or steal its extra point',()=>{
  const g=completed();open(g);vote(g,'p0','discard');applyAction(g,'p0',{type:'ready',ready:false,newAdminId:'p1'},now+210);assert.equal(g.adminId,'p1');assert.equal(g.dispute.adminId,'p0');
  for(let i=1;i<6;i++)vote(g,`p${i}`,i<4?'keep':'discard',now+220);assert.equal(g.dispute.status,'discarded');assert.equal(g.results.review.adminTieBreak,'discard');
});
test('open disputes block the next round, pause and end without disabling sharing or readiness',()=>{
  const g=completed();open(g);const before=restored(g);
  for(const action of [{type:'nextRound',round:1},{type:'pause'},{type:'end'}])assert.throws(()=>applyAction(g,'p0',action,now+200),/dispute vote/);
  assert.deepEqual(g,before);applyAction(g,'p1',{type:'ready',ready:false},now+200);assert.equal(g.players[1].nextActive,false);
  tick(g,g.dispute.deadline);applyAction(g,'p0',{type:'end'},g.dispute.deadline+1);assert.equal(g.phase,'ended');
});
test('only one dispute is allowed, including retries, and stale round numbers cannot affect a later round',()=>{
  const g=completed();open(g);assert.throws(()=>open(g,'p1'),/already had/);vote(g,'p0','keep');assert.throws(()=>vote(g,'p0','discard'),/locked/);
  for(const choice of [null,undefined,'yes',true,{},'__proto__'])assert.throws(()=>vote(g,'p1',choice),/Choose Keep/);
  for(const round of [undefined,null,'1',0,2])assert.throws(()=>applyAction(g,'p1',{type:'disputeVote',round,choice:'discard'},now+200),/moved on/);
  tick(g,g.dispute.deadline);applyAction(g,'p0',{type:'nextRound',round:1},now+DISPUTE_MS+200,n=>n-1);
  assert.throws(()=>applyAction(g,'p1',{type:'openDispute',round:1},now+DISPUTE_MS+201),/results/);
  applyAction(g,'p0',{type:'roundtable'},now+DISPUTE_MS+202);applyAction(g,'p0',{type:'finishVoting'},now+DISPUTE_MS+203);assert.throws(()=>applyAction(g,'p1',{type:'openDispute',round:1},now+DISPUTE_MS+204),/moved on/);
});
test('opening is rejected in lobby, play, voting, ended and paused results',()=>{
  const g=completed();for(const phase of ['lobby','playing','voting','ended']){const copy=restored(g);copy.phase=phase;assert.throws(()=>open(copy),/results/);}
  g.pausedAt=now;assert.throws(()=>open(g),/Resume/);g.pausedAt=null;assert.throws(()=>open(g,'outsider'),/Player not found/);
});
test('a vote at or after the exact deadline cannot change the completed outcome',()=>{
  const g=completed();open(g);vote(g,'p0','discard');vote(g,'p1','discard');vote(g,'p2','discard');const deadline=g.dispute.deadline;
  assert.throws(()=>vote(g,'p3','discard',deadline),/closed/);assert.equal(g.dispute.status,'kept');assert.equal(g.results.review.discardVotes,3);
});
test('public views and history never reveal another player dispute choice or private vote map',()=>{
  const g=completed();open(g);vote(g,'p0','discard');const a=publicView(g,'p0'),b=publicView(g,'p1');assert.equal(a.dispute.myVote,'discard');assert.equal(b.dispute.myVote,null);assert.equal(b.dispute.submittedCount,1);
  for(const v of [a,b]){assert.equal(v.dispute.votes,undefined);assert.equal(v.dispute.eligibleIds,undefined);assert.equal(v.dispute.keepVotes,undefined);assert.equal(v.dispute.discardVotes,undefined);assert.equal(v.results.review,undefined);}
  for(let i=1;i<4;i++)vote(g,`p${i}`,'discard');const view=publicView(g,'p5');assert.equal(view.results.review.discardVotes,4);assert.equal(view.results.review.votes,undefined);assert.equal(view.history[0].review.votes,undefined);
});
test('discarded result presentation never claims a murder or awards earlier points',()=>{
  const g=completed();open(g);for(let i=0;i<4;i++)vote(g,`p${i}`,'discard');const result=g.results;
  for(const p of result.players){assert.equal(scoreBreakdown(p,result).reduce((n,p)=>n+p.points,0),0);assert.match(personalResult(p,result),/discarded/);assert.match(resultOutcome(p,result),/No points/);}
  const story=roundSummary(result);assert.match(story.body,/discarded/);assert.doesNotMatch(story.body,/was murdered/);
});
test('polling checks just after the dispute deadline and stops scheduling it once settled',()=>{
  const g=completed();open(g);const v=publicView(g,'p0');assert.equal(pollDelay(v,0,g.dispute.deadline-1000),1100);tick(g,g.dispute.deadline);assert.equal(nextEventAt(g),null);assert.equal(pollDelay(publicView(g,'p0'),0,g.dispute.deadline+1),6000);
});
for(let n=2;n<=30;n++)test(`${n}-player majority keeps or discards with the same fixed-roster threshold`,()=>{
  for(const choice of ['keep','discard']){const g=completed(n);open(g);const majority=Math.floor(n/2)+1;for(let i=0;i<majority-1;i++)vote(g,`p${i}`,choice);assert.equal(g.dispute.status,'open');vote(g,`p${majority-1}`,choice);assert.equal(g.dispute.status,choice==='keep'?'kept':'discarded');assert.equal(g.results.review.adminTieBreak,null);}
});

test('discarding restores mixed accusation, awareness, missed-report and mistaken-Killer penalties',()=>{
  const g=makeGame('ABC234','Penalty reversal',{id:'p0',name:'Alex'},now);
  for(let i=1;i<8;i++)addPlayer(g,{id:`p${i}`,name:`Player ${i}`});applyAction(g,'p0',{type:'start'},now,n=>n-1);
  assert.deepEqual(g.active.filter(id=>g.roles[id]==='traitor'),['p0','p1']);applyAction(g,'p0',{type:'roundtable'},now+1);
  voteReport('p0','p1',{performed:true});voteReport('p1','p2',{performed:true});
  for(const id of ['p2','p3','p5','p6'])voteReport(id,id==='p3'?'p2':'p3',{suspectedAttempt:false});voteReport('p7','p0',{suspectedAttempt:true});
  applyAction(g,'p0',{type:'finishVoting'},now+3);assert.ok(g.results.players.some(p=>p.delta<0));assert.ok(g.results.players.some(p=>p.delta>0));
  assert.equal(g.results.players[0].penalties.mistakenAttack,-2);assert.equal(g.results.players[1].penalties.traitorTarget,-1);assert.equal(g.results.players[2].awareness.points,-1);assert.equal(g.results.players[4].submitted,false);
  open(g);for(let i=0;i<5;i++)vote(g,`p${i}`,'discard');assert.deepEqual(scores(g),Array(8).fill(0));
  function voteReport(id,target,extra){applyAction(g,id,{type:'ballot',target,...extra},now+2);}
});
test('the admin point never applies to a non-tied vote or overrules a majority',()=>{
  const g=completed();open(g);vote(g,'p0','discard');vote(g,'p1','discard');for(let i=2;i<6;i++)vote(g,`p${i}`,'keep');assert.equal(g.dispute.status,'kept');assert.equal(g.results.review.adminTieBreak,null);
});
