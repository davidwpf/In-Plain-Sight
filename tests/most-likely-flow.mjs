import assert from 'node:assert/strict';

const base=new URL(process.env.GAME_TEST_ORIGIN||'http://127.0.0.1:5173');
if(!['http:','https:'].includes(base.protocol)||!['localhost','127.0.0.1','[::1]'].includes(base.hostname))throw Error('This test only uses local disposable games.');
const origin=base.origin,groups=[];
const names=['Ben','Charlie','Isla','Jamie','Noah','Grace','Robin','Taylor','Sam'];
async function request(player,body){
 const response=await fetch(origin+'/api/game'+(body?'':'?code='+encodeURIComponent(player.view.code)),{method:body?'POST':'GET',headers:{'Content-Type':'application/json',Origin:origin,...(player?{Authorization:'Bearer '+player.token}:{})},...(body?{body:JSON.stringify({code:player?.view.code,...body})}:{})});
 return {status:response.status,data:await response.json()};
}
async function act(player,body,status=200){const result=await request(player,body);assert.equal(result.status,status,JSON.stringify(result.data));if(status===200)player.view=result.data;return result.data;}
async function read(player){const result=await request(player);assert.equal(result.status,200,JSON.stringify(result.data));player.view=result.data;return result.data;}
const readAll=players=>Promise.all(players.map(read));
async function join(players,name){const a=players[0],result=await request(a,{type:'join',invite:a.view.inviteKey,name});assert.equal(result.status,200,JSON.stringify(result.data));players.push(result.data);return result.data;}
async function create(count,label){const result=await request(null,{type:'create',name:'Alex',gameName:label});assert.equal(result.status,201,JSON.stringify(result.data));const players=[result.data];groups.push(players);for(const name of names.slice(0,count-1))await join(players,name);return players;}
async function start(players){const a=players[0];await read(a);await act(a,{type:a.view.phase==='lobby'?'start':'nextRound',round:a.view.round,expectedFinalRound:a.view.finalRound??null,asFinal:false});await readAll(players);}
const innocents=players=>players.filter(p=>p.view.me.active&&p.view.secret?.role==='faithful');
const killers=players=>players.filter(p=>p.view.me.active&&p.view.secret?.role==='traitor');
const active=players=>players.filter(p=>p.view.me.active);
const answer=(player,target)=>({type:'mostLikelyAnswer',round:player.view.round,questionId:player.view.secret.mostLikely.question.id,target});
function stable(view){const value=structuredClone(view);delete value.serverTime;return value;}
function assertPrivate(view){
 for(const key of ['mostLikely','mostLikelyQuestion','mostLikelyAnswers','mostLikelySubmittedCount','mostLikelyReadyCount'])assert.equal(view[key],undefined);
 for(const p of view.players)for(const key of ['mostLikely','mostLikelyAnswered','mostLikelySubmitted','questionAnswered','questionReady'])assert.equal(p[key],undefined);
}
function assertNoQuestion(view){assert.equal(view.secret?.mostLikely,undefined);assertPrivate(view);}
function assertQuestionClosed(players){for(const p of players){assert.equal(p.view.phase,'voting');assertNoQuestion(p.view);assert.equal(p.view.results,null);}}
const summary=(question,players,ids)=>({question,winners:players[0].view.players.filter(p=>ids.includes(p.id)).map(({id,name})=>({id,name}))});
async function submitPrivately(players,player,target){
 const before=new Map(players.map(p=>[p.view.me.id,stable(p.view)])),action=answer(player,target);
 const duplicate=await Promise.all([request(player,action),request(player,action)]);assert.deepEqual(duplicate.map(r=>r.status).sort(),[200,400]);await readAll(players);
 assert.equal(player.view.secret.mostLikely.answerId,target);
 // Answering changes only this player's private answer. Role, task, task-change
 // controls, scores, timers, Court counters and every other view remain intact.
 for(const p of players){assertPrivate(p.view);if(p!==player)assert.deepEqual(stable(p.view),before.get(p.view.me.id));}
 const ownAfter=stable(player.view);ownAfter.secret.mostLikely.answerId=null;assert.deepEqual(ownAfter,before.get(player.view.me.id));
 await act(player,action,400);
}
async function assertLoginPersists(admin,player){
 const returned=await request(admin,{type:'login',invite:admin.view.inviteKey,passcode:player.passcode});assert.equal(returned.status,200);assert.equal(returned.data.view.me.id,player.view.me.id);assert.deepEqual(returned.data.view.secret,player.view.secret);
}

try{
 const large=await create(10,'Most Likely privacy and ties');await start(large);
 const a=large[0],team=killers(large),voters=innocents(large),question=structuredClone(voters[0].view.secret.mostLikely.question),late=await join(large,'Late arrival');
 await readAll(large);assert.equal(late.view.me.active,false);assert.equal(late.view.secret,null);
 for(const p of active(large)){assert.deepEqual(p.view.secret.mostLikely,{question,answerId:null});assertPrivate(p.view);}
 assertNoQuestion(late.view);
 const first=voters[0],firstAction=answer(first,team[0].view.me.id);
 for(const target of [first.view.me.id,late.view.me.id,'not-a-player',null])await act(first,{...firstAction,target},400);
 await act(first,{...firstAction,round:first.view.round-1},400);await act(first,{...firstAction,questionId:'not-this-question'},400);
 await act(late,firstAction,400);
 await act(a,{type:'pause'});await act(first,firstAction,400);await act(a,{type:'resume'});await readAll(large);
 await submitPrivately(large,first,team[0].view.me.id);
 await act(first,answer(first,voters[1].view.me.id),400);
 await assertLoginPersists(a,first);
 // Both roles answer. A Killer's duplicate submissions receive the same atomic
 // protection and reveal no completion metadata to the other players.
 await submitPrivately(large,team[0],first.view.me.id);await assertLoginPersists(a,team[0]);
 await act(team[1],answer(team[1],voters[1].view.me.id));await act(voters[1],answer(voters[1],team[1].view.me.id));await readAll(large);
 // Four distinct targets receive one answer each, including two answers cast
 // by Killers. Six active players leave the optional question unanswered.
 const targetIds=[team[0].view.me.id,first.view.me.id,voters[1].view.me.id,team[1].view.me.id];
 assert.equal(active(large).filter(p=>p.view.secret.mostLikely.answerId===null).length,6);
 // Shared task changes still work after answering and do not change anybody's
 // question or answer. Unanswered Killers can also use their usual controls.
 const savedQuestions=new Map(active(large).map(p=>[p.view.me.id,structuredClone(p.view.secret.mostLikely)]));
 const innocentViews=new Map([...voters,late].map(p=>[p.view.me.id,stable(p.view)])),oldMission=structuredClone(team[2].view.secret.mission);
 await act(team[2],{type:'requestMissionChange',round:team[2].view.round,missionId:oldMission.id,requestRevision:team[2].view.secret.missionChangeRevision});await readAll(large);
 for(const p of team.filter(p=>p!==team[2]))await act(p,{type:'respondMissionChange',round:p.view.round,missionId:oldMission.id,requestId:p.view.secret.missionChange.id,accept:true});
 await readAll(large);const finalMission=structuredClone(team[0].view.secret.mission);assert.notEqual(finalMission.id,oldMission.id);
 for(const p of team){assert.deepEqual(p.view.secret.mission,finalMission);assert.equal(p.view.secret.missionChangesRemaining,1);}
 for(const p of active(large))assert.deepEqual(p.view.secret.mostLikely,savedQuestions.get(p.view.me.id));
 for(const p of [...voters,late])assert.deepEqual(stable(p.view),innocentViews.get(p.view.me.id));
 assert.ok(large.every(p=>p.view.submittedCount===0&&p.view.myBallot===null&&p.view.players.every(player=>player.score===0)));
 await act(a,{type:'roundtable'});await readAll(large);assertQuestionClosed(large);assert.ok(large.every(p=>p.view.submittedCount===0&&p.view.players.filter(player=>player.active).every(player=>player.submitted===false)));
 for(const p of active(large))await act(p,{...firstAction,target:team[0].view.me.id},400);
 for(const p of team)assert.deepEqual(p.view.secret.mission,finalMission);
 await act(a,{type:'finishVoting'});await readAll(large);const expected=summary(question,large,targetIds);
 assert.equal(expected.winners.length,4);for(const p of large){assert.deepEqual(p.view.results.mostLikely,expected);assert.deepEqual(p.view.history[0].mostLikely,expected);assert.deepEqual(p.view.results.murderTask,finalMission);assert.ok(!JSON.stringify(p.view.results.mostLikely).includes('answers'));assert.ok(p.view.results.players.every(r=>r.delta===-2));}
 const history=structuredClone(a.view.history);await start(large);assert.deepEqual(a.view.history,history);
 const nextQuestion=active(large)[0].view.secret.mostLikely.question;assert.notEqual(nextQuestion.id,question.id);
 for(const p of active(large))assert.deepEqual(p.view.secret.mostLikely,{question:nextQuestion,answerId:null});
 await act(active(large)[0],firstAction,400);

 const small=await create(2,'Most Likely roster changes');await start(small);const admin=small[0];
 for(const p of small)assertNoQuestion(p.view);const third=await join(small,'Third player');await readAll(small);assert.ok(small.every(p=>p.view.activeCount===2));for(const p of small)assertNoQuestion(p.view);
 await act(small[1],{type:'mostLikelyAnswer',round:1,questionId:'unavailable',target:admin.view.me.id},400);
 await act(admin,{type:'roundtable'});await act(admin,{type:'finishVoting'});assert.equal(admin.view.results.mostLikely,undefined);await start(small);
 assert.ok(small.every(p=>p.view.activeCount===3));const q=structuredClone(admin.view.secret.mostLikely.question),who=small.find(p=>p!==third);
 for(const p of small)assert.deepEqual(p.view.secret.mostLikely,{question:q,answerId:null});
 await act(third,{type:'ready',ready:false});await act(who,answer(who,third.view.me.id));await act(admin,{type:'roundtable'});await readAll(small);assertQuestionClosed(small);await act(admin,{type:'finishVoting'});await readAll(small);
 assert.deepEqual(admin.view.results.mostLikely,{question:q,winners:[{id:third.view.me.id,name:third.view.me.name}]});const saved=structuredClone(admin.view.history);
 await start(small);assert.ok(small.every(p=>p.view.activeCount===2));for(const p of small)assertNoQuestion(p.view);assert.deepEqual(admin.view.history,saved);
 await act(admin,{type:'roundtable'});await act(admin,{type:'finishVoting'});assert.equal(admin.view.results.mostLikely,undefined);

 const racePlayers=await create(6,'Most Likely Court race');await start(racePlayers);const raceAdmin=racePlayers[0],responder=killers(racePlayers)[0],raceQuestion=structuredClone(responder.view.secret.mostLikely.question),target=innocents(racePlayers)[0].view.me.id,action=answer(responder,target);
 await act({...responder,view:{...responder.view,code:a.view.code}},action,401);
 const race=await Promise.all([request(raceAdmin,{type:'roundtable'}),request(responder,action)]);assert.equal(race[0].status,200);assert.ok([200,400].includes(race[1].status));await readAll(racePlayers);assertQuestionClosed(racePlayers);await act(responder,action,400);
 await act(raceAdmin,{type:'finishVoting'});await readAll(racePlayers);
 assert.deepEqual(raceAdmin.view.results.mostLikely,{question:raceQuestion,winners:race[1].status===200?[{id:target,name:raceAdmin.view.players.find(p=>p.id===target).name}]:[]});
 assert.ok(racePlayers.every(p=>p.view.results.players.find(r=>r.id===responder.view.me.id).delta===-2));
 console.log('PASS: one shared private question for both roles, Killer answers and targets, duplicate/concurrent protection for both roles, unchanged public views and Court counters, intact shared task controls, sign-in persistence, pause, four-way tie including Killer answers, no completion gate or question penalty, Court closure, history, 2→3→2 eligibility, cross-game authentication and Killer-answer-versus-Court race.');
}finally{
 for(const players of groups){try{const admin=players[0];await read(admin);if(admin.view.phase!=='ended')await act(admin,{type:'end'});}catch(error){process.exitCode=1;console.error('Could not clean up a disposable Most Likely test game:',error.message);}}
}
