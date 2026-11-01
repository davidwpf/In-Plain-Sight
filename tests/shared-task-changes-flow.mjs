import assert from 'node:assert/strict';
const origin=process.env.GAME_TEST_ORIGIN||'http://127.0.0.1:5173';
if(!['localhost','127.0.0.1','[::1]'].includes(new URL(origin).hostname))throw new Error('This test only uses a local disposable database.');
async function request(p,body){const r=await fetch(origin+'/api/game'+(body?'':'?code='+p.view.code),{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(p?{Authorization:'Bearer '+p.token}:{})},...(body?{body:JSON.stringify({code:p?.view.code,...body})}:{})});return {status:r.status,data:await r.json()};}
async function act(p,body,status=200){const r=await request(p,body);assert.equal(r.status,status,JSON.stringify(r.data));if(status===200)p.view=r.data;return r.data;}
async function read(p){const r=await request(p);assert.equal(r.status,200);p.view=r.data;return r.data;}
const ask=p=>({type:'requestMissionChange',round:p.view.round,missionId:p.view.secret.mission.id,requestRevision:p.view.secret.missionChangeRevision});
const answer=(p,accept)=>({type:'respondMissionChange',round:p.view.round,missionId:p.view.secret.mission.id,requestId:p.view.secret.missionChange.id,accept});
const names=['Ben','Charlie','Isla','Jamie','Noah','Grace','Robin','Taylor','Alexandria Montgomery'];
async function create(count,name){const r=await request(null,{type:'create',name:'Alex',gameName:name,adminPasscode:'123456'});assert.equal(r.status,201);const players=[r.data],a=players[0];for(const name of names.slice(0,count-1)){const r=await request(a,{type:'join',name,invite:a.view.inviteKey});assert.equal(r.status,200);players.push(r.data);}await act(a,{type:'start',round:0,expectedFinalRound:null,asFinal:false});await Promise.all(players.map(read));return players;}
const killers=players=>players.filter(p=>p.view.secret?.role==='traitor');
const groups=[];
try{
 const large=await create(10,'Shared-task integration');groups.push(large);const a=large[0],team=killers(large),original=structuredClone(team[0].view.secret.mission),scores=a.view.players.map(p=>p.score);
 const simultaneous=await Promise.all(team.slice(0,2).map(p=>request(p,ask(p))));assert.deepEqual(simultaneous.map(r=>r.status).sort(),[200,400]);await Promise.all(large.map(read));
 const proposer=team.find(p=>p.view.secret.missionChange.requestedByMe),others=team.filter(p=>p!==proposer),oldAnswer=answer(others[0],true);
 for(const p of large.filter(p=>!team.includes(p)))assert.equal(p.view.secret.missionChange,undefined);
 await act(large.find(p=>!team.includes(p)),ask(proposer),400);await act(a,{type:'pause'});await act(others[0],answer(others[0],true),400);await act(a,{type:'resume'});
 await act(others[0],answer(others[0],true));await act(others[1],answer(others[1],false));await Promise.all(team.map(read));assert.deepEqual(team[0].view.secret.mission,original);assert.equal(team[0].view.secret.missionChangesRemaining,2);
 await act(others[1],ask(others[1]));await Promise.all(team.map(read));await act(others[0],oldAnswer,400);
 const pending=team.filter(p=>p.view.secret.missionChange.canRespond);const duplicate=await Promise.all([request(pending[0],answer(pending[0],true)),request(pending[0],answer(pending[0],true))]);assert.deepEqual(duplicate.map(r=>r.status).sort(),[200,400]);
 await act(pending[1],answer(pending[1],true));await Promise.all(team.map(read));const second=team[0].view.secret.mission.id;assert.notEqual(second,original.id);assert.ok(team.every(p=>p.view.secret.missionChangesRemaining===1));
 await act(team[0],ask(team[0]));await Promise.all(team.map(read));const acceptors=team.filter(p=>p.view.secret.missionChange.canRespond);const together=await Promise.all(acceptors.map(p=>request(p,answer(p,true))));assert.ok(together.every(r=>r.status===200));await Promise.all(team.map(read));const final=structuredClone(team[0].view.secret.mission);
 assert.equal(new Set([original.id,second,final.id]).size,3);assert.ok(team.every(p=>p.view.secret.mission.id===final.id&&p.view.secret.missionChangesRemaining===0));await act(team[0],ask(team[0]),400);assert.deepEqual(team[0].view.players.map(p=>p.score),scores);
 await act(a,{type:'roundtable'});await Promise.all(large.map(read));const victim=large.find(p=>p.view.secret.role==='faithful');
 for(const p of large)await act(p,{type:'ballot',target:team.includes(p)?victim.view.me.id:team[0].view.me.id,...(team.includes(p)?{performed:p===team[0]}:{suspectedAttempt:p===victim})});await read(a);assert.equal(a.view.phase,'results');assert.deepEqual(a.view.results.murderMethod,final);const history=structuredClone(a.view.history);
 await act(a,{type:'nextRound',round:1,expectedFinalRound:null,asFinal:false});await Promise.all(large.map(read));assert.deepEqual(a.view.history,history);assert.ok(killers(large).every(p=>p.view.secret.missionChangesRemaining===2&&p.view.secret.missionChange===null));
 const small=await create(6,'Court and approval race');groups.push(small);const admin=small[0],pair=killers(small);
 await act(pair[0],ask(pair[0]));await read(pair[1]);await act(pair[1],answer(pair[1],true));await Promise.all(pair.map(read));assert.ok(pair.every(p=>p.view.secret.missionChangesRemaining===1));
 await act(pair[1],ask(pair[1]));await read(pair[0]);const before=structuredClone(pair[0].view.secret.mission),approval=answer(pair[0],true);
 await act({...pair[0],view:{...pair[0].view,code:a.view.code}},approval,401);
 const race=await Promise.all([request(admin,{type:'roundtable'}),request(pair[0],approval)]);assert.equal(race[0].status,200);assert.ok([200,400].includes(race[1].status));await Promise.all(small.map(read));assert.equal(admin.view.phase,'voting');assert.equal(pair[0].view.secret.missionChange,null);assert.equal(pair[0].view.secret.missionChangesRemaining,race[1].status===200?0:1);assert.equal(pair[0].view.secret.mission.id===before.id,race[1].status!==200);
 await act(admin,{type:'finishVoting'});
 console.log('PASS: concurrent requests, locked/replayed responses, rejection without spending, all-three acceptance, two shared changes, private status, pauses, task snapshots in results/history, round reset, cross-game authentication and approval-versus-Court race.');
}finally{for(const players of groups){await read(players[0]);if(players[0].view.phase!=='ended')await act(players[0],{type:'end'});}}
if(process.env.GAME_SHARED_TASK_FIXTURES){const groups=[];for(const count of [6,10])groups.push({count,players:await create(count,`${count===6?'Evening':'Weekend'} game`)});const {writeFile}=await import('node:fs/promises');await writeFile(process.env.GAME_SHARED_TASK_FIXTURES,JSON.stringify(groups,null,2));console.log('Created separate local games for the two- and three-Killer UI checks.');}
