import test from 'node:test';
import assert from 'node:assert/strict';
import {makeGame,addPlayer,startRound,openVoting,applyAction,finishRound,publicView,tick,BREAK_MS,ROUND_RULES_VERSION} from '../lib/game/engine.mjs';
const now=1000000;
function game(count=8){
  const g=makeGame('ABC234','Awareness',{id:'p0',name:'Alice'},now);
  for(let i=1;i<count;i++)addPlayer(g,{id:`p${i}`,name:`Player ${i}`});
  startRound(g,now,n=>n-1);openVoting(g);return g;
}
const report=(g,id,target,performed=true)=>applyAction(g,id,{type:'ballot',target,...(target?{performed}:{})},now);
const accuse=(g,id,target,suspectedAttempt)=>applyAction(g,id,{type:'ballot',target,suspectedAttempt},now);
const result=(g,id)=>g.results.players.find(p=>p.id===id);

for(const mode of ['confirmed','failed attempt','name only','no attempt'])for(const answer of [true,false])for(const correct of [true,false])for(const caught of [true,false]){
  test(`awareness adds once to accusation: ${mode}, answer=${answer}, correct=${correct}, most accused=${caught}`,()=>{
    const g=game(),completed=['confirmed','failed attempt'].includes(mode);
    if(mode==='confirmed'){report(g,'p0','p2');report(g,'p1','p2',false);}
    if(mode==='failed attempt'){report(g,'p0','p2');report(g,'p1','p5');}
    if(mode==='name only'){report(g,'p0','p2',false);report(g,'p1','p2',false);}
    if(mode==='no attempt'){report(g,'p0',null);report(g,'p1',null);}
    accuse(g,'p2',correct?'p0':'p3',answer);
    accuse(g,'p3',caught?'p2':'p0',false);accuse(g,'p4',caught?'p2':'p0',false);
    finishRound(g,now);
    const points=answer?(completed?1:-1):(completed?-1:0),p=result(g,'p2');
    assert.equal(g.results.rulesVersion,4);
    assert.deepEqual(p.awareness,{answer,taskCompleted:completed,points});
    assert.equal(p.delta,(correct?4:-1)-(caught?1:0)+points);assert.equal(p.score,p.delta);
    assert.equal(p.murdered,mode==='confirmed');assert.equal(p.caught,caught);
    assert.equal(result(g,'p0').awareness,undefined);
  });
}
for(const invalid of [undefined,null,0,1,'true','false','yes','no',{},[]])test(`Innocents must give an explicit boolean, received ${JSON.stringify(invalid)}`,()=>{
  const g=game(),before=structuredClone(g);
  assert.throws(()=>accuse(g,'p2','p0',invalid),/Choose Yes or No/);assert.deepEqual(g,before);
});
test('a missing awareness answer never starts the halfway timer or partially locks a ballot',()=>{
  const g=game();report(g,'p0',null);report(g,'p1',null);accuse(g,'p2','p0',false);
  assert.throws(()=>accuse(g,'p3','p0',undefined),/Choose Yes or No/);
  assert.equal(Object.keys(g.ballots).length,3);assert.equal(g.voteDeadline,null);assert.equal(publicView(g,'p3',now).myBallot,null);
  accuse(g,'p3','p0',false);assert.equal(g.voteDeadline,now+300000);
});
test('Killers cannot submit an awareness answer or change a locked report',()=>{
  const g=game();assert.throws(()=>applyAction(g,'p0',{type:'ballot',target:'p2',performed:true,suspectedAttempt:false},now),/Only Innocents/);
  assert.equal(publicView(g,'p0',now).myBallot,null);report(g,'p0','p2');
  assert.throws(()=>report(g,'p0','p3'),/locked/);
});
test('a locked Innocent ballot preserves both choices and exposes neither to other players',()=>{
  const g=game();accuse(g,'p2','p0',true);report(g,'p0','p2');addPlayer(g,{id:'late',name:'Late'});
  assert.deepEqual(publicView(g,'p2',now).myBallot,{kind:'accusation',targetId:'p0',suspectedAttempt:true});
  assert.throws(()=>accuse(g,'p2','p1',false),/locked/);
  for(const id of ['p1','p3','late']){
    const v=publicView(g,id,now);assert.equal(v.myBallot,null);assert.equal(v.results,null);assert.equal(v.me.score,0);
    for(const p of v.players)for(const key of ['suspectedAttempt','awareness','performed','taskCompleted','targetId'])assert.equal(p[key],undefined);
    for(const key of ['ballots','roles','completedTargets','murderedId','attempts'])assert.equal(v[key],undefined);
  }
});
test('awareness uses all final reports, including those submitted after the Innocent ballot',()=>{
  const g=game();accuse(g,'p2','p0',true);report(g,'p0','p2');report(g,'p1','p3');
  applyAction(g,'p0',{type:'finishVoting'},now);assert.equal(result(g,'p2').delta,5);assert.equal(result(g,'p2').awareness.taskCompleted,true);
  assert.match(result(g,'p2').reason,/Spotted a murder attempt \(\+1\)/);
});
test('several completed tasks on one player give only one awareness bonus',()=>{
  const g=game(10);for(const id of ['p0','p1','p2'])report(g,id,'p3');accuse(g,'p3','p0',true);
  finishRound(g,now);assert.equal(result(g,'p3').delta,5);assert.equal(result(g,'p3').awareness.points,1);
});
test('a solo killer implicitly completes the task, which counts for the awareness answer',()=>{
  const g=game(3);accuse(g,'p1','p0',true);report(g,'p0','p1');accuse(g,'p2','p0',false);
  assert.equal(g.phase,'results');assert.equal(result(g,'p1').delta,5);assert.equal(result(g,'p1').awareness.taskCompleted,true);
});
for(const mostAccused of [false,true])test(`missing the whole ballot adds no awareness penalty, most accused=${mostAccused}`,()=>{
  const g=game();report(g,'p0','p2');report(g,'p1','p2',false);accuse(g,'p3',mostAccused?'p2':'p0',false);
  finishRound(g,now);assert.equal(result(g,'p2').delta,mostAccused?-3:-2);
  assert.deepEqual(result(g,'p2').awareness,{answer:null,taskCompleted:true,points:0});
});
test('all ballots close immediately with correct mixed awareness results',()=>{
  const g=game();report(g,'p0','p2');report(g,'p1','p3');
  for(const id of g.active.slice(2))accuse(g,id,'p0',id==='p2'||id==='p4');
  assert.equal(g.phase,'results');assert.equal(g.results.submittedCount,8);
  assert.equal(result(g,'p2').delta,5);assert.equal(result(g,'p3').delta,3);
  assert.equal(result(g,'p4').delta,3);assert.equal(result(g,'p5').delta,4);
  const completed=structuredClone(g.results),scores=g.players.map(p=>p.score);
  applyAction(g,'p0',{type:'finishVoting'},now+1);assert.deepEqual(g.results,completed);assert.deepEqual(g.players.map(p=>p.score),scores);
  tick(g,now+BREAK_MS,n=>n-1);assert.equal(g.round,2);assert.equal(g.results,null);assert.deepEqual(g.ballots,{});assert.deepEqual(g.history[0],completed);
});
test('timer closure applies the awareness score only to submitted ballots',()=>{
  const g=game();report(g,'p0','p2');report(g,'p1','p2',false);accuse(g,'p2','p0',true);accuse(g,'p3','p0',false);
  tick(g,g.voteDeadline);assert.equal(g.phase,'results');assert.equal(result(g,'p2').delta,5);assert.equal(result(g,'p4').delta,-2);assert.equal(result(g,'p4').awareness.points,0);
});
test('paused and late-player submissions cannot answer the awareness question',()=>{
  const g=game();addPlayer(g,{id:'late',name:'Late'});assert.throws(()=>accuse(g,'late','p0',true),/next round/);
  applyAction(g,'p0',{type:'pause'},now);assert.throws(()=>accuse(g,'p2','p0',true),/paused/);assert.deepEqual(g.ballots,{});
});
for(const version of [1,2,3])for(const phase of ['playing','voting'])test(`saved version ${version} ${phase} round retains its rules until the next deal`,()=>{
  const g=game();g.roundRulesVersion=version;
  if(phase==='playing'){g.phase='playing';g.deadline=now+3600000;applyAction(g,'p0',{type:'roundtable'},now);}
  report(g,'p0','p2');report(g,'p1','p2',false);applyAction(g,'p2',{type:'ballot',target:'p0'},now);
  finishRound(g,now);assert.equal(result(g,'p2').delta,4);assert.equal(result(g,'p2').awareness,undefined);
  const saved=structuredClone(g.results),scores=g.players.map(p=>p.score);
  tick(g,now+BREAK_MS,n=>n-1);assert.equal(g.roundRulesVersion,ROUND_RULES_VERSION);assert.deepEqual(g.history[0],saved);assert.deepEqual(g.players.map(p=>p.score),scores);
  openVoting(g);const innocent=g.active.find(id=>g.roles[id]==='faithful'),killer=g.active.find(id=>g.roles[id]==='traitor');
  assert.throws(()=>applyAction(g,innocent,{type:'ballot',target:killer},now+BREAK_MS),/Choose Yes or No/);
});
