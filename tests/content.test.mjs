import test from 'node:test';
import assert from 'node:assert/strict';
import {makeGame,addPlayer,startRound,openVoting,finishRound,tick,applyAction,publicView,CONTENT,validateContent} from '../lib/game/engine.mjs';
const nextRound=(g,at,rng)=>applyAction(g,g.adminId,{type:'nextRound',round:g.round},at,rng);
const base=1000000;
function fixture(count=8){
  const g=makeGame('ABC234','Task cycles',{id:'p0',name:'Admin'},base);
  for(let i=1;i<count;i++)addPlayer(g,{id:`p${i}`,name:`Player ${i}`});
  startRound(g,base,n=>n-1);return g;
}
function next(g){openVoting(g);finishRound(g,g.deadline??base);nextRound(g,base,n=>n-1);return g;}

test('recognition accepts a single shared signal and still supports a legacy reply',()=>{
  const content={...CONTENT,recognition:[{id:'signal',prompt:'Pretend to sneeze.'}]};
  assert.equal(validateContent(content),true);
  assert.equal(validateContent({...content,recognition:[{id:'legacy',prompt:'Question?',reply:'Answer.'}]}),true);
  for(const reply of ['',null,42])assert.throws(()=>validateContent({...content,recognition:[{id:'bad',prompt:'Question?',reply}]}),/reply/);
  assert.throws(()=>validateContent({...content,recognition:[{id:'empty',prompt:''}]}),/prompt/);
});

test('both task lists complete independent cycles without repeats or immediate boundary repeats',()=>{
  const g=fixture(),signals=[],murders=[];
  for(let i=0;i<CONTENT.recognition.length*2;i++){
    signals.push(g.signal.id);murders.push(g.mission.id);
    if(i>0){assert.notEqual(signals[i],signals[i-1]);assert.notEqual(murders[i],murders[i-1]);}
    next(g);
  }
  for(const [draws,items] of [[signals,CONTENT.recognition],[murders,CONTENT.murders]]){
    for(let i=0;i+items.length<=draws.length;i+=items.length){
      assert.deepEqual(new Set(draws.slice(i,i+items.length)),new Set(items.map(item=>item.id)));
    }
  }
});

test('task draw history survives stored-Game restoration and is private',()=>{
  let g=fixture();const signals=[],murders=[];
  for(let i=0;i<12;i++){
    signals.push(g.signal.id);murders.push(g.mission.id);
    const p=publicView(g,'p0',base);assert.equal(p.usedTaskIds,undefined);
    const faithful=publicView(g,g.active.find(id=>g.roles[id]==='faithful'),base);
    assert.equal(faithful.secret.signal,undefined);assert.equal(faithful.secret.mission,undefined);
    g=JSON.parse(JSON.stringify(g));next(g);
  }
  assert.equal(new Set(signals).size,12);assert.equal(new Set(murders).size,12);
});

test('separate Games have their own draw cycles',()=>{
  const first=fixture(),second=fixture();assert.equal(first.signal.id,second.signal.id);assert.equal(first.mission.id,second.mission.id);
  next(first);assert.equal(second.usedTaskIds.recognition.length,1);assert.equal(second.usedTaskIds.murders.length,1);
});

test('solo-traitor rounds do not consume recognition signals',()=>{
  const g=fixture(3);for(let i=0;i<4;i++){assert.equal(g.signal,null);assert.equal(g.usedTaskIds.recognition,undefined);next(g);}
  for(let i=3;i<6;i++)addPlayer(g,{id:`p${i}`,name:`Player ${i}`});next(g);
  assert.ok(g.signal);assert.equal(g.usedTaskIds.recognition.length,1);
});

test('existing Games retain assigned legacy content until a new round is dealt',()=>{
  const g=fixture();delete g.usedTaskIds;const missionId=g.mission.id;
  g.signal={id:'legacy-signal',prompt:'Fancy a cuppa?',reply:'Only if you’re making it.'};
  assert.equal(publicView(g,'p0',base).secret.signal.reply,'Only if you’re making it.');
  next(g);assert.equal(g.signal.reply,undefined);assert.notEqual(g.mission.id,missionId);
});

test('reading, pausing or opening a roundtable does not change assigned content',()=>{
  const g=fixture(),before=structuredClone({signal:g.signal,mission:g.mission,used:g.usedTaskIds});
  publicView(g,'p0',base);applyAction(g,'p0',{type:'pause'},base);applyAction(g,'p0',{type:'resume'},base+1000);applyAction(g,'p0',{type:'roundtable'},base+2000);
  assert.deepEqual({signal:g.signal,mission:g.mission,used:g.usedTaskIds},before);
  applyAction(g,'p0',{type:'finishVoting'},base+2000);
  assert.deepEqual({signal:g.signal,mission:g.mission,used:g.usedTaskIds},before);
});
