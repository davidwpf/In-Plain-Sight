import test from 'node:test';
import assert from 'node:assert/strict';
import {makeGame,addPlayer,startRound,openVoting,finishRound,tick,drawTraitors,traitorWeights,traitorCountFor,applyAction,publicView} from '../lib/game/engine.mjs';
const base=1000000;
function lobby(count){
  const g=makeGame('ABC234','Random roles',{id:'p0',name:'Player 0'},base);
  for(let i=1;i<count;i++)addPlayer(g,{id:`p${i}`,name:`Player ${i}`});
  return g;
}
const traitors=g=>g.active.filter(id=>g.roles[id]==='traitor');
test('automatic rounds obtain fresh cryptographic randomness after restoring stored Games',t=>{
  const entropy=t.mock.method(globalThis.crypto,'getRandomValues',array=>{array[0]=0;return array;});
  let g=lobby(3);startRound(g,base);const teams=[];
  for(let round=1;round<=3;round++){
    assert.equal(g.round,round);assert.equal(traitors(g).length,1);teams.push(traitors(g));
    const calls=entropy.mock.callCount();openVoting(g);finishRound(g,base+round*1000000);
    if(round<3){
      g=JSON.parse(JSON.stringify(g));tick(g,g.deadline);
      assert.ok(entropy.mock.callCount()>calls);assert.equal(g.results,null);assert.deepEqual(g.ballots,{});
    }
  }
  assert.notDeepEqual(teams[0],teams[1]);
});
test('weighted draws keep a previous traitor eligible for three consecutive rounds',()=>{
  const g=lobby(5);startRound(g,base,n=>n-1);
  for(let round=1;round<=3;round++){
    assert.deepEqual(traitors(g),['p0']);assert.equal(g.round,round);
    openVoting(g);finishRound(g,base+round*1000000);
    if(round<3)tick(g,g.deadline,()=>0);
  }
});
function* drawSequences(n){
  if(n===1){yield [];return;}
  for(let j=0;j<n;j++)for(const rest of drawSequences(n-1))yield [j,...rest];
}
for(const count of [3,5,6])test(`first-round traitor teams have equal selection chances with ${count} players`,()=>{
  const ids=Array.from({length:count},(_,i)=>`p${i}`),teams=new Map(),weights=traitorWeights(lobby(count),ids);
  assert.ok(Object.values(weights).every(w=>w===100));
  for(const sequence of drawSequences(count)){
    const remaining=[...sequence],team=drawTraitors(ids,weights,traitorCountFor(count),()=>remaining.shift()).sort().join(',');
    assert.equal(remaining.length,0);teams.set(team,(teams.get(team)||0)+1);
  }
  const expected=count===3?[3,2]:count===5?[5,24]:[15,48];
  assert.equal(teams.size,expected[0]);assert.ok([...teams.values()].every(n=>n===expected[1]));
});
test('fewer traitor turns relative to opportunities means a greater weight; new players are neutral',()=>{
  const g=lobby(3);startRound(g,base,n=>n-1);openVoting(g);finishRound(g,base);
  addPlayer(g,{id:'late',name:'Late'});const before=structuredClone(g);
  const weights=traitorWeights(g,[...g.active,'late']);
  assert.equal(weights.p0,40);assert.equal(weights.p1,159);assert.equal(weights.p2,159);assert.equal(weights.late,100);
  assert.deepEqual(g,before);
});
test('weighted selection uses each positive weight exactly and never excludes a player',()=>{
  const ids=['a','b','c'],weights={a:25,b:100,c:400},counts={a:0,b:0,c:0};
  for(let ticket=0;ticket<525;ticket++)counts[drawTraitors(ids,weights,1,()=>ticket)[0]]++;
  assert.deepEqual(counts,weights);
  assert.deepEqual(drawTraitors(ids,weights,3,()=>0),ids);
});
test('weights remain bounded after long streaks and sitting out adds no advantage',()=>{
  const g=lobby(3),round={players:[{id:'p0',role:'traitor'},{id:'p1',role:'faithful'},{id:'p2',role:'faithful'}]};
  g.history=Array.from({length:100},()=>structuredClone(round));
  const before=traitorWeights(g,['p0','p1','p2','late']);
  assert.deepEqual(before,{p0:25,p1:400,p2:400,late:100});
  g.history.push({players:[{id:'other1',role:'traitor'},{id:'other2',role:'faithful'},{id:'other3',role:'faithful'}]});
  assert.deepEqual(traitorWeights(g,['p0','p1','p2','late']),before);
});
test('weighted assignment recalculates the correct ratio without duplicate traitors for 3–30 players',()=>{
  for(let count=3;count<=30;count++){
    const g=lobby(count);startRound(g,base,n=>n-1);openVoting(g);finishRound(g,base);
    tick(g,g.deadline,()=>0);
    assert.equal(traitors(g).length,traitorCountFor(count));assert.equal(new Set(traitors(g)).size,traitorCountFor(count));
    assert.deepEqual(Object.keys(g.roles),g.active);
    assert.ok(publicView(g,'p0').players.every(p=>p.weight===undefined));
  }
});
test('early roundtables redraw after each full break with 3, 4, 3, 6 and 6 players',t=>{
  const entropy=t.mock.method(globalThis.crypto,'getRandomValues',array=>{array[0]=0;return array;});
  let g=lobby(3),now=base;const act=(id,action)=>{applyAction(g,id,action,now);g=JSON.parse(JSON.stringify(g));};
  act('p0',{type:'start'});
  for(const [i,count] of [3,4,3,6,6].entries()){
    assert.equal(g.round,i+1);assert.equal(g.active.length,count);assert.equal(traitors(g).length,traitorCountFor(count));
    const before={...g.roles},calls=entropy.mock.callCount();now+=1000;act('p0',{type:'roundtable'});
    assert.deepEqual(g.roles,before);assert.equal(entropy.mock.callCount(),calls);
    if(i===0)addPlayer(g,{id:'p3',name:'Player 3'});
    if(i===1)act('p3',{type:'ready',ready:false});
    if(i===2){act('p3',{type:'ready',ready:true});for(const id of ['p4','p5'])addPlayer(g,{id,name:`Player ${id.slice(1)}`});assert.throws(()=>act('p5',{type:'ballot',target:'p0'}),/next round/);}
    const team=traitors(g);
    for(const id of [...g.active])act(id,{type:'ballot',target:team.includes(id)?null:team[0]});
    assert.equal(g.phase,'results');assert.equal(g.history.length,i+1);assert.equal(entropy.mock.callCount(),calls);
    if(i<4){
      const deadline=g.deadline;tick(g,deadline-1);assert.equal(g.phase,'results');assert.equal(entropy.mock.callCount(),calls);
      now=deadline;tick(g,now);g=JSON.parse(JSON.stringify(g));
      assert.equal(g.phase,'playing');assert.deepEqual(g.ballots,{});assert.equal(g.results,null);assert.ok(entropy.mock.callCount()>calls);
    }
  }
});
test('an early-roundtable request at the break boundary draws new weighted roles before opening voting',t=>{
  t.mock.method(globalThis.crypto,'getRandomValues',array=>{array[0]=0;return array;});
  const g=lobby(3);applyAction(g,'p0',{type:'start'},base);const first=traitors(g);
  applyAction(g,'p0',{type:'roundtable'},base+1000);
  for(const id of g.active)applyAction(g,id,{type:'ballot',target:first.includes(id)?null:first[0]},base+1000);
  assert.equal(g.phase,'results');applyAction(g,'p0',{type:'roundtable'},g.deadline);
  assert.equal(g.round,2);assert.equal(g.phase,'voting');assert.notDeepEqual(traitors(g),first);
  assert.deepEqual(g.ballots,{});assert.equal(g.results,null);
});
