import test from 'node:test';
import assert from 'node:assert/strict';
import {makeGame,addPlayer,startRound,openVoting,applyAction,finishRound} from '../lib/game/engine.mjs';
const now=1000000;
function game(){
  const g=makeGame('ABC234','Scoring',{id:'p0',name:'Player 0'},now);
  for(let i=1;i<8;i++)addPlayer(g,{id:`p${i}`,name:`Player ${i}`});
  startRound(g,now,n=>n-1); // p0 and p1 are traitors.
  openVoting(g);return g;
}
const vote=(g,id,target)=>applyAction(g,id,{type:'ballot',target},now);
const result=(g,id)=>g.results.players.find(p=>p.id===id);
for(const [accusation,basePoints] of [['correct',4],['wrong',-1],['missed',-1]]){
  for(const murdered of [false,true])for(const mostAccused of [false,true]){
    test(`faithful scoring: ${accusation}, murdered=${murdered}, most accused=${mostAccused}`,()=>{
      const g=game();
      if(murdered){vote(g,'p0','p2');vote(g,'p1','p2');}
      if(accusation!=='missed')vote(g,'p2',accusation==='correct'?'p0':'p3');
      vote(g,'p3',mostAccused?'p2':'p0');vote(g,'p4',mostAccused?'p2':'p0');
      finishRound(g,now);
      const p=result(g,'p2');
      const murderPenalty=murdered&&accusation!=='correct';
      const expected=basePoints-(mostAccused?1:0)-(murderPenalty?1:0);
      assert.equal(p.delta,expected);assert.equal(p.score,expected);
      assert.equal(p.caught,mostAccused);assert.equal(p.murdered,murdered);
      assert.equal(p.reason.includes('Most accusations (−1)'),mostAccused);
      assert.equal(p.reason.includes('Murdered (−1)'),murderPenalty);
    });
  }
}
test('receiving five accusations only costs one extra point',()=>{
  const g=game();vote(g,'p2','p0');
  for(const id of ['p3','p4','p5','p6','p7'])vote(g,id,'p2');
  finishRound(g,now);const p=result(g,'p2');
  assert.equal(p.votes,5);assert.equal(p.delta,3);
});
test('a faithful with the most votes among faithful is not penalised when a traitor has more',()=>{
  const g=game();vote(g,'p2','p0');vote(g,'p3','p2');vote(g,'p4','p0');
  finishRound(g,now);assert.equal(result(g,'p2').votes,1);
  assert.equal(result(g,'p2').caught,false);assert.equal(result(g,'p2').delta,4);
});
test('ties with a traitor count for the single most-accusations penalty',()=>{
  const g=game();vote(g,'p2','p0');vote(g,'p3','p2');finishRound(g,now);
  assert.equal(result(g,'p2').caught,true);assert.equal(result(g,'p2').delta,3);
  assert.equal(result(g,'p0').delta,-3);
});
test('with no accusations, nobody receives a most-accusations penalty',()=>{
  const g=game();vote(g,'p0','p2');vote(g,'p1','p2');finishRound(g,now);
  assert.ok(g.results.players.every(p=>!p.caught));
  assert.equal(result(g,'p2').delta,-2);assert.equal(result(g,'p3').delta,-1);
});
