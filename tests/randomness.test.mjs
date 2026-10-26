import test from 'node:test';
import assert from 'node:assert/strict';
import {makeGame,addPlayer,startRound,openVoting,finishRound,tick,shuffled,traitorCountFor,applyAction} from '../lib/game/engine.mjs';
const base=1000000;
function lobby(count){
  const g=makeGame('ABC234','Random roles',{id:'p0',name:'Player 0'},base);
  for(let i=1;i<count;i++)addPlayer(g,{id:`p${i}`,name:`Player ${i}`});
  return g;
}
const traitors=g=>g.active.filter(id=>g.roles[id]==='traitor');
test('automatic round transitions read fresh cryptographic randomness after restoring stored Games',t=>{
  // Each round uses two shuffle draws and one task draw. These draws select p0, p1, then p2.
  const draws=[2,1,0, 2,0,0, 0,1,0];
  const entropy=t.mock.method(globalThis.crypto,'getRandomValues',array=>{
    assert.ok(draws.length,'Every round must request fresh entropy');array[0]=draws.shift();return array;
  });
  let g=lobby(3);startRound(g,base);
  for(let round=1;round<=3;round++){
    assert.equal(g.round,round);assert.deepEqual(traitors(g),[`p${round-1}`]);
    const rolesBefore=g.roles;openVoting(g);finishRound(g,base+round*1000000);
    if(round<3){
      g=JSON.parse(JSON.stringify(g));tick(g,g.deadline);
      assert.notEqual(g.roles,rolesBefore);assert.equal(g.results,null);assert.deepEqual(g.ballots,{});
    }
  }
  assert.equal(entropy.mock.callCount(),9);assert.deepEqual(draws,[]);
});
test('a fresh independent draw may select the same traitor for three rounds',()=>{
  const g=lobby(5);startRound(g,base,n=>n-1);
  for(let round=1;round<=3;round++){
    assert.deepEqual(traitors(g),['p0']);assert.equal(g.round,round);
    openVoting(g);finishRound(g,base+round*1000000);
    if(round<3)tick(g,g.deadline,n=>n-1);
  }
});
function* drawSequences(n){
  if(n===1){yield [];return;}
  for(let j=0;j<n;j++)for(const rest of drawSequences(n-1))yield [j,...rest];
}
for(const count of [3,5,6])test(`all traitor teams have equal selection chances with ${count} players`,()=>{
  const ids=Array.from({length:count},(_,i)=>`p${i}`),teams=new Map();
  for(const sequence of drawSequences(count)){
    const remaining=[...sequence];
    const team=shuffled(ids,()=>remaining.shift()).slice(0,traitorCountFor(count)).sort().join(',');
    assert.equal(remaining.length,0);teams.set(team,(teams.get(team)||0)+1);
  }
  const expected=count===3?[3,2]:count===5?[5,24]:[15,48];
  assert.equal(teams.size,expected[0]);assert.ok([...teams.values()].every(n=>n===expected[1]));
});

test('early roundtables redraw after each full break with 3, 4, 3, 6 and 6 players',t=>{
  const plans=[
    {active:['p0','p1','p2'],team:['p0']},
    {active:['p0','p1','p2','p3'],team:['p1']},
    {active:['p0','p1','p2'],team:['p2']},
    {active:['p0','p1','p2','p3','p4','p5'],team:['p5','p3']},
    {active:['p0','p1','p2','p3','p4','p5'],team:['p4','p0']},
  ];
  const draws=[];
  for(const {active,team} of plans){
    const order=[...team,...active.filter(id=>!team.includes(id))],working=[...active];
    for(let i=working.length-1;i>0;i--){
      const j=working.indexOf(order[i]);draws.push(j);[working[i],working[j]]=[working[j],working[i]];
    }
    if(team.length>1)draws.push(0); // Recognition phrase.
    draws.push(0); // Murder task.
  }
  const entropy=t.mock.method(globalThis.crypto,'getRandomValues',array=>{
    assert.ok(draws.length,'A new round must obtain a fresh draw');array[0]=draws.shift();return array;
  });
  let g=lobby(3),now=base;
  const act=(id,action)=>{applyAction(g,id,action,now);g=JSON.parse(JSON.stringify(g));};
  act('p0',{type:'start'});
  for(let i=0;i<plans.length;i++){
    const plan=plans[i];assert.equal(g.round,i+1);assert.deepEqual(g.active,plan.active);
    assert.deepEqual(traitors(g).sort(),[...plan.team].sort());
    const before=g.roles,calls=entropy.mock.callCount();now+=1000;
    act('p0',{type:'roundtable'});
    assert.deepEqual(g.roles,before);assert.equal(entropy.mock.callCount(),calls);
    if(i===0)addPlayer(g,{id:'p3',name:'Player 3'});
    if(i===1)act('p3',{type:'ready',ready:false});
    if(i===2){
      act('p3',{type:'ready',ready:true});
      for(const id of ['p4','p5'])addPlayer(g,{id,name:`Player ${id.slice(1)}`});
      assert.throws(()=>act('p5',{type:'ballot',target:'p0'}),/next round/);
    }
    for(const id of [...g.active])act(id,{type:'ballot',target:plan.team.includes(id)?null:plan.team[0]});
    assert.equal(g.phase,'results');assert.equal(g.history.length,i+1);
    assert.equal(entropy.mock.callCount(),calls);
    if(i<plans.length-1){
      const deadline=g.deadline;tick(g,deadline-1);assert.equal(g.phase,'results');
      assert.equal(entropy.mock.callCount(),calls);
      now=deadline;tick(g,now);g=JSON.parse(JSON.stringify(g));
      assert.equal(g.phase,'playing');assert.deepEqual(g.ballots,{});assert.equal(g.results,null);
      assert.ok(entropy.mock.callCount()>calls);
    }
  }
  assert.deepEqual(draws,[]);
});

test('an early-roundtable request arriving at the end of the break first draws the new round roles',t=>{
  const draws=[2,1,0, 2,0,0]; // Round one selects p0; round two selects p1.
  t.mock.method(globalThis.crypto,'getRandomValues',array=>{assert.ok(draws.length);array[0]=draws.shift();return array;});
  const g=lobby(3);applyAction(g,'p0',{type:'start'},base);
  applyAction(g,'p0',{type:'roundtable'},base+1000);
  for(const id of g.active)applyAction(g,id,{type:'ballot',target:id==='p0'?null:'p0'},base+1000);
  assert.equal(g.phase,'results');assert.deepEqual(traitors(g),['p0']);
  applyAction(g,'p0',{type:'roundtable'},g.deadline);
  assert.equal(g.round,2);assert.equal(g.phase,'voting');assert.deepEqual(traitors(g),['p1']);
  assert.deepEqual(g.ballots,{});assert.equal(g.results,null);assert.deepEqual(draws,[]);
});
