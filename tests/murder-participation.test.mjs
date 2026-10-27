// Regression coverage for saved version 3 rounds; awareness tests cover new deals.
import test from 'node:test';
import assert from 'node:assert/strict';
import {makeGame,addPlayer,startRound,openVoting,applyAction,finishRound,publicView,tick,ROUND_RULES_VERSION} from '../lib/game/engine.mjs';
const nextRound=(g,at,rng)=>applyAction(g,g.adminId,{type:'nextRound',round:g.round},at,rng);
const now=1000000;
function game(count=8){
  const g=makeGame('ABC234','Participation',{id:'p0',name:'Alice'},now);
  for(let i=1;i<count;i++)addPlayer(g,{id:`p${i}`,name:i===1?'Ben':`Player ${i}`});
  startRound(g,now,n=>n-1);g.roundRulesVersion=3;openVoting(g);return g;
}
const submit=(g,id,target,performed)=>applyAction(g,id,{type:'ballot',target,...(performed!==undefined?{performed}:{})},now);
const result=(g,id)=>g.results.players.find(p=>p.id===id);
for(const [performed,otherPerformed] of [[true,false],[false,true],[true,true]]){
  for(const [outcome,wantedActor,wantedHelper] of [['escape',6,2],['caught',1,0],['otherCaught',4,0],['tied',1,0],['noVotes',4,0]]){
    test(`confirmed murder: performed=${performed}, other=${otherPerformed}, outcome=${outcome}`,()=>{
      const g=game();submit(g,'p0','p2',performed);submit(g,'p1','p2',otherPerformed);
      if(outcome==='escape')submit(g,'p3','p4');
      if(outcome==='caught'||outcome==='tied')submit(g,'p3','p0');
      if(outcome==='otherCaught'||outcome==='tied')submit(g,'p4','p1');
      finishRound(g,now);
      assert.equal(g.results.murderedId,'p2');assert.equal(g.results.rulesVersion,3);
      assert.equal(result(g,'p0').delta,performed?wantedActor:wantedHelper);
      assert.equal(result(g,'p0').killed,performed);assert.equal(result(g,'p0').accomplice,!performed);
      assert.equal(result(g,'p0').performed,performed);
      assert.deepEqual(g.results.murdererIds,['p0','p1'].filter((_,i)=>[performed,otherPerformed][i]));
      assert.deepEqual(g.results.accompliceIds,['p0','p1'].filter((_,i)=>![performed,otherPerformed][i]));
      const killerNames=[performed?'Alice':null,otherPerformed?'Ben':null].filter(Boolean);
      assert.equal(result(g,'p2').blurb,`You were murdered. ${killerNames.join(' and ')}${killerNames.length===2?' both':''} killed you.`);
    });
  }
}
test('a caught murderer scores more than their escaped accomplice',()=>{
  const g=game();submit(g,'p0','p2',true);submit(g,'p1','p2',false);submit(g,'p3','p0');finishRound(g,now);
  assert.equal(result(g,'p0').delta,1);assert.equal(result(g,'p1').delta,0);
});
test('matching reports with no performed claim are an attempt, not a murder',()=>{
  const g=game();submit(g,'p0','p2',false);submit(g,'p1','p2',false);submit(g,'p3','p4');finishRound(g,now);
  assert.equal(g.results.murderedId,null);assert.deepEqual(g.results.murdererIds,[]);assert.deepEqual(g.results.accompliceIds,[]);
  assert.deepEqual(g.results.attempts,[{targetId:'p2',reporterIds:['p0','p1'],performerIds:[]}]);
  assert.equal(result(g,'p0').delta,0);assert.equal(result(g,'p1').delta,0);
  assert.equal(result(g,'p2').attempted,true);assert.deepEqual(result(g,'p2').attemptedBy,[]);
  assert.match(result(g,'p2').blurb,/nobody confirmed/);assert.ok(!result(g,'p2').blurb.includes('Alice'));
});
test('a task performed on a minority target cannot validate the majority target',()=>{
  const g=game(10);submit(g,'p0','p3',false);submit(g,'p1','p3',false);submit(g,'p2','p4',true);finishRound(g,now);
  assert.equal(g.results.murderedId,null);assert.equal(g.results.attempts.length,2);
  assert.deepEqual(result(g,'p3').attemptedBy,[]);assert.deepEqual(result(g,'p4').attemptedBy,['p2']);
  for(const id of ['p0','p1','p2'])assert.equal(result(g,id).delta,0);
});
test('two of three matching reports work with one performer and one accomplice',()=>{
  const g=game(10);submit(g,'p0','p3',true);submit(g,'p1','p3',false);submit(g,'p2','p4',true);submit(g,'p5','p6');finishRound(g,now);
  assert.equal(g.results.murderedId,'p3');assert.deepEqual(g.results.murdererIds,['p0']);assert.deepEqual(g.results.accompliceIds,['p1']);
  assert.equal(result(g,'p0').delta,6);assert.equal(result(g,'p1').delta,2);assert.equal(result(g,'p2').delta,0);
});
test('a minority target gets no confirmed-murder points even if a majority murder succeeds',()=>{
  const g=game(10);submit(g,'p0','p3',true);submit(g,'p1','p3',false);submit(g,'p2','p4',true);submit(g,'p5','p2');finishRound(g,now);
  assert.equal(result(g,'p0').delta,4);assert.equal(result(g,'p1').delta,0);assert.equal(result(g,'p2').delta,-2);
  assert.equal(result(g,'p2').killed,false);assert.equal(result(g,'p2').accomplice,false);
});
for(const caught of [false,true]){
  test(`a missing traitor report costs −2 total, caught=${caught}`,()=>{
    const g=game();if(caught)submit(g,'p2','p0');finishRound(g,now);
    assert.equal(result(g,'p0').delta,-2);assert.equal(result(g,'p0').submitted,false);
  });
  test(`an explicit No murder is a report, caught=${caught}`,()=>{
    const g=game();submit(g,'p0',null);if(caught)submit(g,'p2','p0');finishRound(g,now);
    assert.equal(result(g,'p0').delta,caught?-2:0);assert.equal(result(g,'p0').submitted,true);assert.equal(result(g,'p0').performed,false);
  });
}
test('missing reports never lower the majority even with a performed task',()=>{
  for(const count of [8,10]){const g=game(count);submit(g,'p0',count===8?'p2':'p3',true);finishRound(g,now);assert.equal(g.results.murderedId,null);}
});
test('one traitor choosing a victim implicitly confirms performing the task',()=>{
  const g=game(3);submit(g,'p0','p1');assert.equal(g.ballots.p0.performed,true);finishRound(g,now);assert.equal(g.results.murderedId,'p1');assert.equal(result(g,'p0').delta,4);
});
for(const bad of [undefined,null,0,1,'true','false',{},[]])test(`multiple traitors must explicitly answer with a boolean (${JSON.stringify(bad)})`,()=>{
  const g=game(),before=structuredClone(g);assert.throws(()=>submit(g,'p0','p2',bad),/personally completed/);assert.deepEqual(g,before);
});
test('contradictory claims and faithful participation claims are rejected',()=>{
  const g=game();assert.throws(()=>submit(g,'p0',null,true),/No murder/);assert.throws(()=>submit(g,'p2','p0',true),/Innocent vote/);
  const solo=game(3);assert.throws(()=>submit(solo,'p0','p1',false),/Choosing a victim/);
  assert.deepEqual(g.ballots,{});assert.deepEqual(solo.ballots,{});
});
test('a locked claim cannot be changed by resubmitting',()=>{
  const g=game();submit(g,'p0','p2',false);assert.throws(()=>submit(g,'p0','p2',true),/locked/);assert.equal(g.ballots.p0.performed,false);
});
test('majority reports naming another traitor still fail without exposing roles early',()=>{
  const g=game(10);submit(g,'p0','p2',true);submit(g,'p1','p2',false);assert.equal(publicView(g,'p0',now).myBallot.targetId,'p2');finishRound(g,now);
  assert.equal(g.results.murderedId,null);assert.deepEqual(g.results.attempts[0].performerIds,['p0']);
});
test('claims stay private until results; only the reporter can see their own answer',()=>{
  const g=game();submit(g,'p0','p2',false);submit(g,'p1','p2',true);
  assert.equal(publicView(g,'p0',now).myBallot.performed,false);assert.equal(publicView(g,'p1',now).myBallot.performed,true);
  for(const id of ['p2','p3']){const v=publicView(g,id,now);assert.equal(v.myBallot,null);assert.equal(v.results,null);assert.equal(v.accompliceIds,undefined);assert.equal(v.murdererIds,undefined);assert.ok(v.players.every(p=>p.performed===undefined&&p.role===undefined));}
});
test('existing in-progress rounds retain old ballots and scoring; the next deal uses the new rules',()=>{
  const g=game();delete g.roundRulesVersion;submit(g,'p0','p2');submit(g,'p1','p2');submit(g,'p2','p1');
  assert.equal(publicView(g,'p0',now).roundRulesVersion,1);finishRound(g,now);
  assert.equal(result(g,'p0').delta,2);assert.equal(result(g,'p1').delta,1);assert.equal(result(g,'p3').delta,-1);
  assert.deepEqual(g.results.murdererIds,['p0','p1']);assert.equal(g.results.rulesVersion,undefined);
  const oldResults=structuredClone(g.results),oldScores=g.players.map(p=>p.score);
  nextRound(g,now+5000,n=>n-1);assert.equal(g.roundRulesVersion,ROUND_RULES_VERSION);assert.deepEqual(g.history[0],oldResults);assert.deepEqual(g.players.map(p=>p.score),oldScores);
});
test('a restored old playing round also keeps its rules when the admin calls an early roundtable',()=>{
  const g=game();g.phase='playing';g.deadline=now+3600000;delete g.roundRulesVersion;
  applyAction(g,'p0',{type:'roundtable'},now);submit(g,'p0','p2');submit(g,'p1','p2');finishRound(g,now);
  assert.equal(g.results.murderedId,'p2');assert.equal(result(g,'p0').delta,4);
});
