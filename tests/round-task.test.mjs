import test from 'node:test';
import assert from 'node:assert/strict';
import {makeGame,addPlayer,startRound,openVoting,finishRound,publicView,applyAction} from '../lib/game/engine.mjs';
const now=1_000_000;
function game(count=3,rng=n=>n-1){const g=makeGame('ABC234','Evening',{id:'alex',name:'Alex'},now);for(let i=1;i<count;i++)addPlayer(g,{id:`p${i}`,name:`Player ${i}`});startRound(g,now,rng);return g;}
const killer=g=>g.active.find(id=>g.roles[id]==='traitor');
test('the task stays private until Court has finished, including in two-player rounds',()=>{
 for(const count of [2,3,6]){const g=game(count);for(const phase of ['playing','voting']){if(phase==='voting')openVoting(g);for(const id of g.active){const v=publicView(g,id,now);assert.equal(v.murderTask,undefined);assert.equal(v.results,null);assert.equal(v.history.length,0);if(g.roles[id]==='faithful')assert.equal(v.secret.mission,undefined);}}}
});
test('results reveal the assigned task to everyone even when no murder was reported',()=>{
 const g=game(6),task=structuredClone(g.mission);openVoting(g);finishRound(g,now);assert.equal(g.results.murderedId,null);assert.equal(g.results.murderMethod,null);
 for(const id of g.active){const v=publicView(g,id,now);assert.deepEqual(v.results.murderTask,task);assert.deepEqual(v.history[0].murderTask,task);}
});
test('an attempted murder still reveals the shared task',()=>{
 const g=game(6),ids=g.active.filter(id=>g.roles[id]==='traitor'),victims=g.active.filter(id=>g.roles[id]==='faithful'),task=structuredClone(g.mission);openVoting(g);
 for(const [i,id] of ids.entries())applyAction(g,id,{type:'ballot',target:victims[i],performed:true},now);finishRound(g,now);
 assert.equal(g.results.murderedId,null);assert.equal(g.results.attempts.length,2);assert.deepEqual(g.results.murderTask,task);
});
test('a successful murder keeps both the task description and the existing murder method',()=>{
 const g=game(),id=killer(g),victim=g.active.find(id=>g.roles[id]==='faithful'),task=structuredClone(g.mission);openVoting(g);applyAction(g,id,{type:'ballot',target:victim},now);finishRound(g,now);
 assert.equal(g.results.murderedId,victim);assert.deepEqual(g.results.murderTask,task);assert.deepEqual(g.results.murderMethod,task);
});
test('a two-Innocent round explicitly saves no task',()=>{
 const g=game(2,()=>0);assert.equal(g.traitorCount,0);openVoting(g);finishRound(g,now);assert.ok(Object.hasOwn(g.results,'murderTask'));assert.equal(g.results.murderTask,null);assert.equal(g.results.murderMethod,null);
});
test('results retain the final replacement task through storage, disputes and later rounds',()=>{
 const g=game();applyAction(g,killer(g),{type:'changeMission',round:1,missionId:g.mission.id},now,()=>0);const task=structuredClone(g.mission);openVoting(g);finishRound(g,now);
 applyAction(g,g.adminId,{type:'openDispute',round:1},now);for(const id of g.active)if(g.dispute.status==='open')applyAction(g,id,{type:'disputeVote',round:1,choice:'discard'},now);assert.deepEqual(g.results.murderTask,task);
 applyAction(g,g.adminId,{type:'nextRound',round:1,expectedFinalRound:null,asFinal:false},now,n=>n-1);const saved=JSON.parse(JSON.stringify(g));assert.deepEqual(saved.history[0].murderTask,task);assert.notEqual(saved.mission.id,task.id);
 for(const id of saved.active)assert.deepEqual(publicView(saved,id,now).history[0].murderTask,task);
});
test('older current results can use their saved game task without mutating state',()=>{
 const g=game(),task=structuredClone(g.mission);openVoting(g);finishRound(g,now);delete g.results.murderTask;const saved=JSON.stringify(g);
 const v=publicView(g,g.adminId,now);assert.deepEqual(v.results.murderTask,task);assert.deepEqual(v.history[0].murderTask,task);assert.equal(JSON.stringify(g),saved);
});
test('an old historical round is never assigned a newer round task',()=>{
 const g=game();openVoting(g);finishRound(g,now);delete g.results.murderTask;applyAction(g,g.adminId,{type:'nextRound',round:1,expectedFinalRound:null,asFinal:false},now,n=>n-1);
 const v=publicView(g,g.adminId,now);assert.equal(v.history[0].murderTask,undefined);assert.equal(v.results,null);
});
