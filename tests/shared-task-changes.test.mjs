import test from 'node:test';
import assert from 'node:assert/strict';
import {makeGame,addPlayer,startRound,applyAction,publicView,openVoting,finishRound,CONTENT,tick} from '../lib/game/engine.mjs';
const now=1_000_000;
function game(count=6,rng=n=>n-1){const g=makeGame('ABC234','Shared changes',{id:'p0',name:'Alex'},now);for(let i=1;i<count;i++)addPlayer(g,{id:`p${i}`,name:`Player ${i}`});startRound(g,now,rng);return g;}
const team=g=>g.active.filter(id=>g.roles[id]==='traitor');
const innocent=g=>g.active.find(id=>g.roles[id]==='faithful');
const askAction=g=>({type:'requestMissionChange',round:g.round,missionId:g.mission.id,requestRevision:g.missionChangeRevision??0});
const replyAction=(g,accept,request=g.missionChangeRequest)=>({type:'respondMissionChange',round:request.round,missionId:request.missionId,requestId:request.id,accept});
const ask=(g,id=team(g)[0])=>applyAction(g,id,askAction(g),now,()=>{throw new Error('Requests must not draw a task');});
const answer=(g,id,accept=true)=>applyAction(g,id,replyAction(g,accept),now,n=>n-1);
function agree(g,requester=team(g)[0]){ask(g,requester);for(const id of team(g).filter(id=>id!==requester))answer(g,id);}
const snapshot=g=>JSON.parse(JSON.stringify(g));
function next(g,count=team(g).length){openVoting(g);finishRound(g,now);applyAction(g,g.adminId,{type:'nextRound',round:g.round,expectedFinalRound:g.finalRound??null,asFinal:false},now,n=>n-1);assert.equal(team(g).length,count);}

for(const count of [6,10,30])test(`${count} players: all Killers must accept before the shared task changes`,()=>{
 const g=game(count),ids=team(g),old=snapshot(g.mission),fixed=snapshot({roles:g.roles,players:g.players,deadline:g.deadline,signal:g.signal,history:g.history});
 ask(g);assert.deepEqual(g.mission,old);assert.equal(g.missionChanges,0);
 assert.deepEqual(publicView(g,ids[0],now).secret.missionChange,{id:'1:1',status:'open',total:ids.length,acceptedCount:1,requestedByMe:true,myDecision:true,canRespond:false});
 for(const [index,id] of ids.slice(1).entries()){
  answer(g,id);if(index<ids.length-2){assert.equal(g.missionChangeRequest.status,'open');assert.deepEqual(g.mission,old);assert.equal(g.missionChanges,0);}
 }
 assert.equal(g.missionChangeRequest.status,'accepted');assert.notEqual(g.mission.id,old.id);assert.equal(g.missionChanges,1);
 for(const id of ids){const s=publicView(g,id,now).secret;assert.deepEqual(s.mission,g.mission);assert.equal(s.missionChangesRemaining,1);}
 assert.deepEqual({roles:g.roles,players:g.players,deadline:g.deadline,signal:g.signal,history:g.history},fixed);
});
for(const requester of ['p0','p1','p2'])test(`any Killer can request the change, including ${requester}`,()=>{
 const g=game(10);assert.ok(team(g).includes(requester));agree(g,requester);assert.equal(g.missionChanges,1);
});
for(const count of [6,10])test(`one rejection keeps the task and locks further requests with ${team(game(count)).length} Killers`,()=>{
 const g=game(count),ids=team(g),old=snapshot(g.mission),used=snapshot(g.usedTaskIds);ask(g);
 if(ids.length===3)answer(g,ids[1]);answer(g,ids.at(-1),false);
 assert.equal(g.missionChangeRequest.status,'rejected');assert.deepEqual(g.mission,old);assert.deepEqual(g.usedTaskIds,used);assert.equal(g.missionChanges,0);
 const before=snapshot(g);
 for(const id of ids){assert.equal(publicView(g,id,now).secret.missionChangesRemaining,0);assert.throws(()=>ask(g,id),/No more requests/);assert.deepEqual(g,before);}
 next(g);assert.ok(team(g).every(id=>publicView(g,id,now).secret.missionChangesRemaining===2));agree(g);assert.equal(g.missionChanges,1);
});
test('the two changes are shared across all Killers and cannot return to an earlier task',()=>{
 const g=game(10),ids=team(g),seen=[g.mission.id];
 agree(g,ids[0]);seen.push(g.mission.id);agree(g,ids[1]);seen.push(g.mission.id);
 assert.equal(new Set(seen).size,3);assert.deepEqual(g.roundMissionIds,seen);assert.equal(g.missionChanges,2);
 for(const id of ids){assert.equal(publicView(g,id,now).secret.missionChangesRemaining,0);const before=snapshot(g);assert.throws(()=>ask(g,id),/No change left/);assert.deepEqual(g,before);}
});
test('a rejection after one approved change locks the remaining change for every Killer',()=>{
 const g=game(10),ids=team(g);agree(g);const task=snapshot(g.mission);ask(g,ids[1]);answer(g,ids[2],false);
 assert.equal(g.missionChanges,1);assert.equal(g.missionChangeRevision,2);assert.deepEqual(g.mission,task);
 for(const id of ids){assert.equal(publicView(g,id,now).secret.missionChangesRemaining,0);assert.throws(()=>ask(g,id),/No more requests/);}
 next(g);assert.equal(g.missionChanges,0);assert.equal(g.missionChangeRequest,null);agree(g);assert.equal(g.missionChanges,1);
});
test('replayed or competing requests cannot create another request or replace the task',()=>{
 const g=game(),ids=team(g),action=askAction(g);applyAction(g,ids[0],action,now);const before=snapshot(g);
 for(const id of ids)assert.throws(()=>applyAction(g,id,action,now),/already changed/);
 assert.deepEqual(g,before);answer(g,ids[1],false);const closed=snapshot(g);assert.throws(()=>applyAction(g,ids[0],action,now),/already changed/);assert.deepEqual(g,closed);
});
test('a stale acceptance cannot undo a rejection or answer a request next round',()=>{
 const g=game(10),ids=team(g);ask(g);const stale=replyAction(g,true);answer(g,ids[1],false);const before=snapshot(g);
 assert.throws(()=>applyAction(g,ids[2],stale,now),/no longer open/);assert.deepEqual(g,before);
 next(g);ask(g);const fresh=snapshot(g);assert.throws(()=>applyAction(g,team(g)[1],stale,now),/already changed/);assert.deepEqual(g,fresh);
 for(const id of team(g).slice(1))answer(g,id);assert.equal(g.missionChanges,1);
});
test('a rejection lock survives storage, sign-in views and pause/resume',()=>{
 let g=game(10),ids=team(g);ask(g);answer(g,ids[1],false);g=snapshot(g);const saved=snapshot(g);
 for(const id of g.active)publicView(g,id,now);assert.deepEqual(g,saved);
 applyAction(g,g.adminId,{type:'pause'},now);applyAction(g,g.adminId,{type:'resume'},now+100);
 for(const id of ids){assert.equal(publicView(g,id,now+100).secret.missionChange.status,'rejected');assert.equal(publicView(g,id,now+100).secret.missionChangesRemaining,0);assert.throws(()=>ask(g,id),/No more requests/);}
 assert.equal(g.missionChanges,0);assert.deepEqual(g.mission,saved.mission);
});
test('an answer is locked, including the implicit acceptance by the requester',()=>{
 const g=game(10),ids=team(g);ask(g);
 assert.throws(()=>answer(g,ids[0],false),/already locked/);answer(g,ids[1]);const before=snapshot(g);
 for(const accept of [true,false])assert.throws(()=>answer(g,ids[1],accept),/already locked/);assert.deepEqual(g,before);
 answer(g,ids[2]);const finished=snapshot(g);assert.throws(()=>applyAction(g,ids[2],replyAction(g,true),now),/already changed/);assert.deepEqual(g,finished);
});
test('answers require an explicit boolean and matching request, round and task',()=>{
 const g=game(),id=team(g)[1];ask(g);const valid=replyAction(g,true),before=snapshot(g);
 for(const accept of [undefined,null,1,'yes',{},[]])assert.throws(()=>applyAction(g,id,{...valid,accept},now),/Accept change or Reject change/);
 for(const patch of [{requestId:undefined},{requestId:'other'},{round:0},{round:'1'},{missionId:'other'}])assert.throws(()=>applyAction(g,id,{...valid,...patch},now),/changed|no longer open/);
 assert.deepEqual(g,before);
});
test('only current Killers may request or answer, including when an Innocent is admin',()=>{
 const g=game(10,()=>0),ids=team(g);assert.equal(g.roles[g.adminId],'faithful');addPlayer(g,{id:'late',name:'Late arrival'});
 const unauthorized=[...g.active.filter(id=>g.roles[id]==='faithful'),'late'];
 for(const id of unauthorized){const before=snapshot(g);assert.throws(()=>applyAction(g,id,askAction(g),now),/Only Killers sharing/);assert.deepEqual(g,before);}
 ask(g,ids[0]);for(const id of unauthorized){const before=snapshot(g);assert.throws(()=>applyAction(g,id,replyAction(g,true),now),/Only Killers sharing/);assert.deepEqual(g,before);}
});
test('Innocents cannot probe task identifiers or the hidden two-player Killer count through change errors',()=>{
 for(const count of [2,6])for(const rng of [()=>0,n=>n-1]){
  const g=game(count,rng),id=innocent(g);const errors=[];
  for(const missionId of [undefined,'wrong',g.mission?.id]){try{applyAction(g,id,{...askAction({...g,mission:g.mission??{id:'none'}}),missionId},now);}catch(e){errors.push(e.message);}}
  assert.equal(new Set(errors).size,1);assert.match(errors[0],/Only Killers sharing/);
 }
});
test('shared tasks cannot be changed directly by an older solo-change command',()=>{
 for(const count of [6,10]){const g=game(count);for(const id of team(g)){const before=snapshot(g);assert.throws(()=>applyAction(g,id,{type:'changeMission',round:1,missionId:g.mission.id},now),/Only a solo Killer/);assert.deepEqual(g,before);}}
});
test('a solo Killer still changes directly and cannot open a shared request',()=>{
 const g=game(3),id=team(g)[0];assert.throws(()=>ask(g,id),/Only Killers sharing/);
 applyAction(g,id,{type:'changeMission',round:1,missionId:g.mission.id},now);assert.equal(g.missionChanges,1);assert.equal(g.missionChangeRequest,null);
});
test('request status exposes counts and only the signed-in Killer answer, never identities',()=>{
 const g=game(10),ids=team(g);ask(g);
 for(const id of ids){const r=publicView(g,id,now).secret.missionChange;assert.equal(r.acceptedCount,1);assert.equal(r.total,3);assert.equal(r.myDecision,id===ids[0]?true:null);for(const field of ['requestedBy','voters','votes','missionId'])assert.equal(r[field],undefined);for(const other of ids)assert.ok(!JSON.stringify(r).includes(other));}
 addPlayer(g,{id:'late',name:'Late arrival'});
 for(const id of [...g.active.filter(id=>g.roles[id]==='faithful'),'late']){const v=publicView(g,id,now);for(const field of ['missionChangeRequest','missionChangeRevision','missionChanges','roundMissionIds'])assert.equal(v[field],undefined);assert.ok(!JSON.stringify(v.secret).includes('missionChange'));}
});
test('pending and partial acceptances survive storage and private reads',()=>{
 let g=game(10),ids=team(g);ask(g);answer(g,ids[1]);const saved=snapshot(g);for(const id of g.active)publicView(g,id,now);assert.deepEqual(g,saved);
 g=JSON.parse(JSON.stringify(g));answer(g,ids[2]);assert.equal(g.missionChanges,1);assert.equal(g.missionChangeRequest.status,'accepted');
});
test('older saved rounds without request fields can use unanimous changes',()=>{
 const g=game();delete g.missionChangeRequest;delete g.missionChangeRevision;delete g.missionChanges;delete g.roundMissionIds;delete g.usedTaskIds;
 g.mission={id:'removed-task',title:'Old task',instruction:'Saved wording.',kind:'action',difficulty:'easy'};agree(g);assert.equal(g.missionChanges,1);assert.equal(g.roundMissionIds[0],'removed-task');assert.notEqual(g.mission.id,'removed-task');
});
test('pausing blocks both new requests and responses, without losing partial acceptance',()=>{
 const g=game(10),ids=team(g);applyAction(g,g.adminId,{type:'pause'},now);assert.throws(()=>ask(g),/Resume/);applyAction(g,g.adminId,{type:'resume'},now+100);
 ask(g);answer(g,ids[1]);applyAction(g,g.adminId,{type:'pause'},now+200);const before=snapshot(g);assert.throws(()=>answer(g,ids[2]),/Resume/);assert.deepEqual(g,before);
 applyAction(g,g.adminId,{type:'resume'},now+300);answer(g,ids[2]);assert.equal(g.missionChanges,1);
});
test('Court closes unanswered requests and keeps the original task and change budget',()=>{
 const g=game(10),ids=team(g),old=snapshot(g.mission);ask(g);answer(g,ids[1]);applyAction(g,g.adminId,{type:'roundtable'},now);
 assert.equal(g.missionChangeRequest,null);assert.deepEqual(g.mission,old);assert.equal(g.missionChanges,0);assert.equal(publicView(g,ids[0],now).secret.missionChange,null);
 assert.throws(()=>applyAction(g,ids[2],{type:'respondMissionChange',round:1,missionId:old.id,requestId:'1:1',accept:true},now),/before Court/);
});
test('an approval at the round deadline cannot change the task after Court opens',()=>{
 const g=game(),id=team(g)[1],old=snapshot(g.mission);ask(g);const action=replyAction(g,true);
 assert.throws(()=>applyAction(g,id,action,g.deadline),/before Court/);assert.equal(g.phase,'voting');assert.equal(g.missionChangeRequest,null);assert.deepEqual(g.mission,old);assert.equal(g.missionChanges,0);
});
test('an unanswered request is not a scheduled deadline or a reason to advance the round',()=>{
 const g=game();ask(g);const before=snapshot(g);tick(g,now+60_000);assert.deepEqual(g,before);
});
test('ending a game closes a pending request without scoring or replacing the task',()=>{
 const g=game(),old=snapshot(g.mission);ask(g);applyAction(g,g.adminId,{type:'end'},now);assert.equal(g.missionChangeRequest,null);assert.deepEqual(g.mission,old);assert.equal(g.history.length,0);assert.ok(g.players.every(p=>p.score===0));
});
test('a new round resets the shared budget and rejects answers from the previous round',()=>{
 const g=game(),ids=team(g);agree(g);ask(g);const stale=replyAction(g,true);next(g);assert.equal(g.missionChanges,0);assert.equal(g.missionChangeRevision,0);assert.equal(g.missionChangeRequest,null);ask(g);const before=snapshot(g);assert.throws(()=>applyAction(g,team(g)[1],stale,now),/already changed/);assert.deepEqual(g,before);answer(g,team(g)[1]);assert.equal(g.missionChanges,1);
});
test('leaving, sitting out or joining does not reduce the current Killer electorate',()=>{
 const g=game(10),ids=team(g);ask(g);applyAction(g,ids[2],{type:'leave'},now);applyAction(g,ids[1],{type:'ready',ready:false},now);addPlayer(g,{id:'late',name:'Late player'});answer(g,ids[1]);assert.equal(g.missionChangeRequest.status,'open');assert.equal(g.missionChangeRequest.voters.length,3);answer(g,ids[2]);assert.equal(g.missionChanges,1);
});
test('handing admin control to an Innocent grants no task-change rights and keeps the request',()=>{
 const g=game(),ids=team(g),newAdmin=innocent(g);ask(g);const request=snapshot(g.missionChangeRequest);applyAction(g,g.adminId,{type:'ready',ready:false,newAdminId:newAdmin},now);assert.deepEqual(g.missionChangeRequest,request);assert.throws(()=>answer(g,newAdmin),/Only Killers sharing/);answer(g,ids[1]);assert.equal(g.missionChanges,1);
});
test('a deck boundary never reoffers a task already shown in the current round',()=>{
 const g=game(10);g.usedTaskIds.murders=CONTENT.murders.map(t=>t.id);const seen=[g.mission.id];agree(g);seen.push(g.mission.id);agree(g,team(g)[1]);seen.push(g.mission.id);assert.equal(new Set(seen).size,3);
});
test('accepted task changes leave scoring unchanged and preserve the final method in history',()=>{
 const g=game(),ids=team(g),victim=innocent(g);agree(g);const method=snapshot(g.mission);openVoting(g);
 for(const [index,id] of ids.entries())applyAction(g,id,{type:'ballot',target:victim,performed:index===0},now);
 applyAction(g,victim,{type:'ballot',target:ids[0],suspectedAttempt:true},now);finishRound(g,now);
 assert.equal(g.results.murderedId,victim);assert.deepEqual(g.results.murderMethod,method);assert.equal(g.results.players.find(p=>p.id===ids[0]).delta,1);assert.equal(g.results.players.find(p=>p.id===ids[1]).delta,0);assert.equal(g.results.players.find(p=>p.id===victim).delta,5);
 assert.ok(!JSON.stringify(g.history).includes('missionChangeRequest'));const saved=snapshot(g.history);applyAction(g,g.adminId,{type:'nextRound',round:1,expectedFinalRound:null,asFinal:false},now,n=>n-1);agree(g);assert.deepEqual(g.history,saved);
});
