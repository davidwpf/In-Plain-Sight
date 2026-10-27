// Regression coverage for saved version 3 rounds; awareness tests cover new deals.
import test from 'node:test';
import assert from 'node:assert/strict';
import {makeGame,addPlayer,startRound,openVoting,applyAction,finishRound,publicView,tick,BREAK_MS,ROUND_RULES_VERSION} from '../lib/game/engine.mjs';
const now=1000000;
function game(count=8){
  const g=makeGame('ABC234','Mistaken attacks',{id:'p0',name:'Alice'},now);
  for(let i=1;i<count;i++)addPlayer(g,{id:`p${i}`,name:i===1?'Ben':`Player ${i}`});
  startRound(g,now,n=>n-1);g.roundRulesVersion=3;openVoting(g);return g;
}
const submit=(g,id,target,performed)=>applyAction(g,id,{type:'ballot',target,...(performed!==undefined?{performed}:{})},now);
const result=(g,id)=>g.results.players.find(p=>p.id===id);
const zero={mistakenAttack:0,traitorTarget:0};
for(const [caught,wantedAttacker,wantedTarget] of [['neither',-2,-1],['attacker',-4,-1],['target',-2,-3],['both',-4,-3]]){
  test(`mistaken attack penalties add to failed-murder scores: caught=${caught}`,()=>{
    const g=game();submit(g,'p0','p1',true);submit(g,'p1',null);
    if(caught==='attacker'||caught==='both')submit(g,'p2','p0');
    if(caught==='target'||caught==='both')submit(g,'p3','p1');
    finishRound(g,now);
    assert.equal(g.results.rulesVersion,3);assert.equal(g.results.murderedId,null);
    assert.equal(result(g,'p0').delta,wantedAttacker);assert.equal(result(g,'p1').delta,wantedTarget);
    assert.deepEqual(result(g,'p0').penalties,{mistakenAttack:-2,traitorTarget:0});
    assert.deepEqual(result(g,'p1').penalties,{mistakenAttack:0,traitorTarget:-1});
    assert.match(result(g,'p0').reason,/Completed the task on another traitor \(−2\)/);
    assert.match(result(g,'p1').reason,/Targeted by another traitor \(−1\)/);
    assert.deepEqual(result(g,'p1').attemptedBy,['p0']);assert.equal(result(g,'p1').murdered,false);
  });
}
test('two actual attackers each lose two points, while their target loses only one',()=>{
  const g=game(10);submit(g,'p0','p2',true);submit(g,'p1','p2',true);submit(g,'p2',null);finishRound(g,now);
  assert.equal(g.results.murderedId,null);assert.equal(result(g,'p0').delta,-2);assert.equal(result(g,'p1').delta,-2);assert.equal(result(g,'p2').delta,-1);
  assert.deepEqual(result(g,'p2').attemptedBy,['p0','p1']);assert.equal(result(g,'p2').penalties.traitorTarget,-1);
  assert.equal((result(g,'p2').reason.match(/Targeted by another traitor/g)||[]).length,1);
});
test('a non-performing reporter avoids the attacker penalty when another reporter actually attacks',()=>{
  const g=game(10);submit(g,'p0','p2',true);submit(g,'p1','p2',false);submit(g,'p2',null);finishRound(g,now);
  assert.equal(result(g,'p0').delta,-2);assert.equal(result(g,'p1').delta,0);assert.equal(result(g,'p2').delta,-1);
  assert.deepEqual(result(g,'p1').penalties,zero);assert.deepEqual(result(g,'p2').attemptedBy,['p0']);
});
test('a name-only report does not penalise either the reporter or the target',()=>{
  const g=game();submit(g,'p0','p1',false);submit(g,'p1',null);finishRound(g,now);
  for(const id of ['p0','p1']){assert.equal(result(g,id).delta,0);assert.deepEqual(result(g,id).penalties,zero);}
  assert.equal(result(g,'p1').attempted,true);assert.deepEqual(result(g,'p1').attemptedBy,[]);
});
test('even a majority of name-only reports creates no mistaken-attack penalties',()=>{
  const g=game(10);submit(g,'p0','p2',false);submit(g,'p1','p2',false);submit(g,'p2',null);finishRound(g,now);
  for(const id of ['p0','p1','p2']){assert.equal(result(g,id).delta,0);assert.deepEqual(result(g,id).penalties,zero);}
});
for(const caught of [false,true])test(`a missing target report still has a separate one-point target penalty, caught=${caught}`,()=>{
  const g=game();submit(g,'p0','p1',true);if(caught)submit(g,'p2','p1');finishRound(g,now);
  assert.equal(result(g,'p1').submitted,false);assert.equal(result(g,'p1').delta,-3);
  assert.equal(result(g,'p1').reason,'Did not submit a murder report (−2) · Targeted by another traitor (−1)');
});
for(const caught of [false,true])test(`mutual attacks apply both distinct penalties, caught=${caught}`,()=>{
  const g=game();submit(g,'p0','p1',true);submit(g,'p1','p0',true);
  if(caught){submit(g,'p2','p0');submit(g,'p3','p1');}finishRound(g,now);
  for(const id of ['p0','p1']){assert.equal(result(g,id).delta,caught?-5:-3);assert.deepEqual(result(g,id).penalties,{mistakenAttack:-2,traitorTarget:-1});}
});
for(const [vote,wanted] of [['correct',4],['wrong',-1],['missed',-2]])test(`a faithful surviving an actual attempted murder gets only their usual vote score: ${vote}`,()=>{
  const g=game(10);submit(g,'p0','p3',true);submit(g,'p1','p4',true);submit(g,'p2',null);
  if(vote!=='missed')submit(g,'p3',vote==='correct'?'p0':'p5');finishRound(g,now);
  assert.equal(g.results.murderedId,null);assert.equal(result(g,'p3').attempted,true);assert.equal(result(g,'p3').delta,wanted);
  for(const p of g.results.players)assert.deepEqual(p.penalties,zero);
});
for(const [performed,caught,wanted] of [[true,'neither',5],[true,'self',0],[true,'other',3],[true,'noVotes',3],[false,'neither',1],[false,'self',-1]]){
  test(`a successful ${performed?'murderer':'accomplice'} can also be a mistaken target: caught=${caught}`,()=>{
    const g=game(10);submit(g,'p0','p3',performed);submit(g,'p1','p3',!performed);submit(g,'p2','p0',true);
    if(caught==='self')submit(g,'p4','p0');
    else if(caught==='other')submit(g,'p4','p2');
    else if(caught==='neither')submit(g,'p4','p5');
    finishRound(g,now);
    assert.equal(g.results.murderedId,'p3');assert.equal(result(g,'p0').delta,wanted);assert.equal(result(g,'p0').killed,performed);assert.equal(result(g,'p0').accomplice,!performed);
    assert.equal(result(g,'p0').penalties.traitorTarget,-1);assert.equal(result(g,'p0').penalties.mistakenAttack,0);
    assert.equal(result(g,'p2').delta,caught==='other'?-4:-2);
    assert.deepEqual(g.results.murdererIds,[performed?'p0':'p1']);
  });
}
test('the target penalty does not require matching majority reports',()=>{
  const g=game(10);submit(g,'p0','p1',true);submit(g,'p1',null);submit(g,'p2',null);finishRound(g,now);
  assert.equal(result(g,'p0').delta,-2);assert.equal(result(g,'p1').delta,-1);assert.equal(result(g,'p2').delta,0);
});
test('No murder submissions and a solo traitor carry no mistaken-attack penalties',()=>{
  const g=game(3);submit(g,'p0',null);finishRound(g,now);assert.equal(result(g,'p0').delta,0);assert.deepEqual(result(g,'p0').penalties,zero);
});
test('role, attempt and penalty information stay private until results',()=>{
  const g=game();submit(g,'p0','p1',true);submit(g,'p1',null);
  for(const id of g.active){const v=publicView(g,id,now);assert.equal(v.results,null);assert.equal(v.me.score,0);assert.equal(v.me.penalties,undefined);assert.ok(v.players.every(p=>p.score===0&&p.penalties===undefined&&p.attemptedBy===undefined&&p.role===undefined));}
});
test('repeated finish requests cannot apply either extra penalty twice',()=>{
  const g=game();submit(g,'p0','p1',true);submit(g,'p1',null);applyAction(g,'p0',{type:'finishVoting'},now);
  const completed=structuredClone(g.results),scores=g.players.map(p=>p.score);
  applyAction(g,'p0',{type:'finishVoting'},now+1);assert.deepEqual(g.results,completed);assert.deepEqual(g.players.map(p=>p.score),scores);assert.equal(g.history.length,1);
  tick(g,now+BREAK_MS,n=>n-1);assert.deepEqual(g.history[0],completed);assert.deepEqual(g.players.map(p=>p.score),scores);
});
for(const phase of ['playing','voting'])test(`existing version 2 ${phase} rounds keep participation rules without new penalties`,()=>{
  const g=game();g.roundRulesVersion=2;
  if(phase==='playing'){g.phase='playing';g.deadline=now+3600000;applyAction(g,'p0',{type:'roundtable'},now);}
  assert.throws(()=>submit(g,'p0','p1'),/personally completed/);
  submit(g,'p0','p1',true);submit(g,'p1',null);finishRound(g,now);
  assert.equal(g.results.rulesVersion,2);assert.equal(result(g,'p0').delta,0);assert.equal(result(g,'p1').delta,0);
  assert.equal(result(g,'p0').penalties,undefined);assert.deepEqual(g.results.attempts[0].performerIds,['p0']);
  const previous=structuredClone(g.results);tick(g,now+BREAK_MS,n=>n-1);assert.equal(g.roundRulesVersion,ROUND_RULES_VERSION);assert.deepEqual(g.history[0],previous);
});
test('version 1 rounds retain original ballots and failed-murder scoring',()=>{
  const g=game();delete g.roundRulesVersion;submit(g,'p0','p1');submit(g,'p1',null);finishRound(g,now);
  assert.equal(g.results.rulesVersion,undefined);assert.equal(result(g,'p0').delta,0);assert.equal(result(g,'p1').delta,0);assert.equal(result(g,'p0').penalties,undefined);
});
