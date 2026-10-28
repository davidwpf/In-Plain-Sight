import test from 'node:test';
import assert from 'node:assert/strict';
import {makeGame,addPlayer,startRound,openVoting,finishRound,applyAction,publicView,CONTENT,MAX_MISSION_CHANGES} from '../lib/game/engine.mjs';
const now=1_000_000;
function fixture(count=3,rng=n=>n-1){
  const g=makeGame('ABC234','Task changes',{id:'p0',name:'Alex'},now);
  for(let i=1;i<count;i++)addPlayer(g,{id:`p${i}`,name:`Player ${i}`});
  startRound(g,now,rng);return g;
}
const killer=g=>g.active.find(id=>g.roles[id]==='traitor');
const change=g=>({type:'changeMission',round:g.round,missionId:g.mission.id});
const replace=g=>applyAction(g,killer(g),change(g),now,()=>0);
function nextRound(g,rng=n=>n-1){openVoting(g);finishRound(g,now);applyAction(g,g.adminId,{type:'nextRound',round:g.round},now,rng);}

test('the approved library has 23 distinct murder tasks and keeps all 34 recognition signals',()=>{
  const ids=['removable-sticker','hold-object','lend-object','help-carry','pick-up-object','put-in-bin','open-door','switch-light','another-room','write-word-number','fold-paper','read-aloud','tell-joke','sing-song','say-thank-you','answer-number','finish-phrase','wave-back','clap-hands','copy-gesture','change-volume','explain-something','say-dont-know'];
  assert.deepEqual(CONTENT.murders.map(t=>t.id),ids);assert.equal(CONTENT.recognition.length,34);
  assert.equal(new Set(CONTENT.murders.map(t=>t.instruction)).size,23);
});
test('a solo Killer can make exactly two changes, with three different tasks even for the same random draw',()=>{
  const g=fixture(),id=killer(g),seen=[g.mission.id];
  const fixed=structuredClone({roles:g.roles,deadline:g.deadline,signal:g.signal,players:g.players,ballots:g.ballots,history:g.history});
  assert.equal(MAX_MISSION_CHANGES,2);assert.equal(publicView(g,id,now).secret.missionChangesRemaining,2);
  for(const remaining of [1,0]){replace(g);seen.push(g.mission.id);assert.equal(publicView(g,id,now).secret.missionChangesRemaining,remaining);}
  assert.equal(new Set(seen).size,3);assert.deepEqual(g.roundMissionIds,seen);assert.equal(g.missionChanges,2);
  assert.deepEqual({roles:g.roles,deadline:g.deadline,signal:g.signal,players:g.players,ballots:g.ballots,history:g.history},fixed);
  const saved=structuredClone(g);assert.throws(()=>replace(g),/No change left\./);assert.deepEqual(g,saved);
});
test('solo Killers can change tasks without being the admin',()=>{
  const g=fixture(3,()=>0);assert.notEqual(killer(g),g.adminId);assert.doesNotThrow(()=>replace(g));
});
test('Innocents, waiting players and an Innocent admin cannot change a task',()=>{
  const g=fixture(3,()=>0);addPlayer(g,{id:'late',name:'Late player'});
  for(const id of [...g.active.filter(id=>g.roles[id]==='faithful'),'late']){
    const saved=structuredClone(g);assert.throws(()=>applyAction(g,id,change(g),now),/Only a solo Killer/);assert.deepEqual(g,saved);
  }
});
for(const count of [6,10])test(`all Killers in a ${count}-player round must keep their shared task`,()=>{
  const g=fixture(count),saved=structuredClone(g);
  for(const id of g.active.filter(id=>g.roles[id]==='traitor')){
    assert.equal(publicView(g,id,now).secret.missionChangesRemaining,undefined);
    assert.throws(()=>applyAction(g,id,change(g),now),/Only a solo Killer/);assert.deepEqual(g,saved);
  }
});
test('task-change metadata stays private, including the hidden two-player Killer count',()=>{
  for(const count of [2,3]){
    const g=fixture(count);replace(g);
    for(const id of g.active){
      const v=publicView(g,id,now);
      for(const field of ['missionChanges','roundMissionIds','usedTaskIds'])assert.equal(v[field],undefined);
      if(g.roles[id]==='faithful'){assert.equal(v.secret.mission,undefined);assert.equal(v.secret.missionChangesRemaining,undefined);}
      else assert.equal(v.secret.missionChangesRemaining,1);
      if(count===2)assert.equal(v.traitorCount,null);
    }
  }
  const innocentRound=fixture(2,()=>0);
  for(const id of innocentRound.active){const v=publicView(innocentRound,id,now);assert.equal(v.traitorCount,null);assert.equal(v.secret.missionChangesRemaining,undefined);assert.throws(()=>applyAction(innocentRound,id,{type:'changeMission',round:1,missionId:'anything'},now),/Only a solo Killer/);}
});
test('round and task snapshots reject stale or duplicate changes without spending the next change',()=>{
  const g=fixture(),id=killer(g),stale=change(g);applyAction(g,id,stale,now,()=>0);
  const saved=structuredClone(g);
  for(const action of [stale,{...change(g),round:g.round-1},{...change(g),round:undefined},{...change(g),missionId:undefined}]){
    assert.throws(()=>applyAction(g,id,action,now),/already changed/);assert.deepEqual(g,saved);
  }
  replace(g);assert.equal(g.missionChanges,2);
});
test('changes survive stored-Game restoration and do not reset on sign-in or reading',()=>{
  let g=fixture();replace(g);g=JSON.parse(JSON.stringify(g));
  assert.equal(publicView(g,killer(g),now).secret.missionChangesRemaining,1);replace(g);
  g=JSON.parse(JSON.stringify(g));assert.equal(publicView(g,killer(g),now).secret.missionChangesRemaining,0);
  assert.throws(()=>replace(g),/No change left/);
});
test('existing rounds without new metadata keep their current task and gain only two changes',()=>{
  let g=fixture();delete g.missionChanges;delete g.roundMissionIds;delete g.usedTaskIds;
  g.mission={id:'legacy-task',title:'Old task',kind:'spoken',difficulty:'easy',instruction:'Old instruction.'};
  assert.equal(publicView(g,killer(g),now).secret.mission.id,'legacy-task');
  assert.equal(publicView(g,killer(g),now).secret.missionChangesRemaining,2);
  replace(g);g=JSON.parse(JSON.stringify(g));replace(g);
  assert.equal(g.missionChanges,2);assert.equal(new Set(g.roundMissionIds).size,3);assert.throws(()=>replace(g),/No change left/);
});
test('pauses block changes without spending them, and resuming does not reset the limit',()=>{
  const g=fixture();replace(g);applyAction(g,g.adminId,{type:'pause'},now);
  const saved=structuredClone(g);assert.throws(()=>replace(g),/Resume/);assert.deepEqual(g,saved);
  applyAction(g,g.adminId,{type:'resume'},now);replace(g);assert.equal(g.missionChanges,2);
});
test('the roundtable, results and ended games do not allow task changes',()=>{
  for(const phase of ['voting','results','ended']){
    const g=fixture();openVoting(g);if(phase!=='voting')finishRound(g,now);if(phase==='ended')applyAction(g,g.adminId,{type:'end'},now);
    const saved=structuredClone(g);assert.throws(()=>replace(g),/before the roundtable/);assert.deepEqual(g,saved);
  }
  const g=fixture(),task=structuredClone(g.mission),deadline=g.deadline;
  assert.throws(()=>applyAction(g,killer(g),change(g),deadline),/before the roundtable/);
  assert.equal(g.phase,'voting');assert.deepEqual(g.mission,task);
});
test('a new round resets the two changes and discarded tasks remain used in the draw cycle',()=>{
  const g=fixture();replace(g);replace(g);const previous=[...g.roundMissionIds];nextRound(g);
  assert.equal(g.missionChanges,0);assert.equal(publicView(g,killer(g),now).secret.missionChangesRemaining,2);
  assert.deepEqual(g.roundMissionIds,[g.mission.id]);assert.ok(!previous.includes(g.mission.id));
  assert.equal(g.usedTaskIds.murders.length,4);replace(g);replace(g);assert.equal(g.usedTaskIds.murders.length,6);
});
test('a task cycle reset never brings back a task discarded earlier in the current round',()=>{
  const g=fixture();g.usedTaskIds.murders=CONTENT.murders.map(t=>t.id);
  const seen=[g.mission.id];replace(g);seen.push(g.mission.id);replace(g);seen.push(g.mission.id);
  assert.equal(new Set(seen).size,3);
});
test('many rounds and deck boundaries keep each round’s original and replacements distinct',()=>{
  const g=fixture();let previous=null;
  for(let i=0;i<30;i++){
    assert.notEqual(g.mission.id,previous);replace(g);replace(g);
    assert.equal(new Set(g.roundMissionIds).size,3);previous=g.mission.id;
    g.usedTaskIds=JSON.parse(JSON.stringify(g.usedTaskIds));nextRound(g);
  }
});
test('joining and sitting out change the next round’s eligibility, not the current round’s task rights',()=>{
  const g=fixture();replace(g);
  for(let i=3;i<6;i++)addPlayer(g,{id:`p${i}`,name:`Player ${i}`});
  replace(g);nextRound(g);assert.equal(g.traitorCount,2);assert.throws(()=>replace(g),/Only a solo Killer/);
  for(let i=3;i<6;i++)applyAction(g,`p${i}`,{type:'ready',ready:false},now);
  assert.throws(()=>replace(g),/Only a solo Killer/);nextRound(g);
  assert.equal(g.traitorCount,1);assert.equal(publicView(g,killer(g),now).secret.missionChangesRemaining,2);replace(g);
});
test('the final task is saved as the murder method, while scoring and roles are unchanged',()=>{
  const g=fixture(),id=killer(g),victim=g.active.find(p=>g.roles[p]==='faithful');
  replace(g);replace(g);const method=structuredClone(g.mission);
  openVoting(g);applyAction(g,id,{type:'ballot',target:victim},now);
  applyAction(g,victim,{type:'ballot',target:id,suspectedAttempt:true},now);finishRound(g,now);
  assert.equal(g.results.murderedId,victim);assert.deepEqual(g.results.murderMethod,method);
  assert.equal(g.results.players.find(p=>p.id===id).delta,1);
  assert.equal(g.results.players.find(p=>p.id===victim).delta,5);
  applyAction(g,g.adminId,{type:'nextRound',round:g.round},now,n=>n-1);replace(g);
  assert.deepEqual(g.history[0].murderMethod,method);
});
