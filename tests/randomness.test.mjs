import test from 'node:test';
import assert from 'node:assert/strict';
import {makeGame,addPlayer,startRound,openVoting,finishRound,tick,shuffled,traitorCountFor} from '../lib/game/engine.mjs';
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
