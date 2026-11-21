import assert from 'node:assert/strict';
const origin=process.env.GAME_TEST_ORIGIN||'http://127.0.0.1:5173';
if(!['localhost','127.0.0.1','[::1]'].includes(new URL(origin).hostname))throw Error('This test only uses local disposable games.');
async function request(p,body){const r=await fetch(origin+'/api/game'+(body?'':'?code='+p.view.code),{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(p?{Authorization:'Bearer '+p.token}:{})},...(body?{body:JSON.stringify({code:p?.view.code,...body})}:{})});return {status:r.status,data:await r.json()};}
async function act(p,body){const r=await request(p,body);assert.equal(r.status,200,JSON.stringify(r.data));p.view=r.data;return p.view;}
async function read(p){const r=await request(p);assert.equal(r.status,200,JSON.stringify(r.data));p.view=r.data;}
const names=['Ben','Charlie','Isla','Jamie','Noah'];
async function create(count){const r=await request(null,{type:'create',name:'Alex',gameName:'Returning players test'});assert.equal(r.status,201,JSON.stringify(r.data));const players=[r.data],a=players[0];for(const name of names.slice(0,count-1)){const r=await request(a,{type:'join',name,invite:a.view.inviteKey});assert.equal(r.status,200);players.push(r.data);}return players;}
const groups=[];
try{
 for(const count of [2,3,6]){
  const players=await create(count);groups.push(players);const a=players[0];assert.ok(players.every(p=>/^\d{6}$/.test(p.passcode)));assert.equal(new Set(players.map(p=>p.passcode)).size,count);
  await act(a,{type:'start',round:0,expectedFinalRound:null,asFinal:false});await Promise.all(players.map(read));const team=players.filter(p=>p.view.secret.role==='traitor'),task=structuredClone(team[0]?.view.secret.mission??null);
  assert.ok(players.every(p=>p.view.results===null&&p.view.murderTask===undefined));
  await act(a,{type:'roundtable'});if(count===6){const victims=players.filter(p=>p.view.secret.role==='faithful');for(const [i,p] of team.entries())await act(p,{type:'ballot',target:victims[i].view.me.id,performed:true});}
  await act(a,{type:'finishVoting'});await Promise.all(players.map(read));assert.ok(players.every(p=>p.view.phase==='results'));assert.equal(a.view.results.murderedId,null);assert.deepEqual(a.view.results.murderTask,task);assert.deepEqual(a.view.history[0].murderTask,task);
  for(const p of [a,players[1]]){const r=await request(a,{type:'login',invite:a.view.inviteKey,passcode:p.passcode});assert.equal(r.status,200);assert.equal(r.data.view.me.id,p.view.me.id);assert.equal(r.data.view.me.isAdmin,p===a);assert.deepEqual(r.data.view.results.murderTask,task);}
  const first=structuredClone(a.view.results);await act(a,{type:'nextRound',round:1,expectedFinalRound:null,asFinal:false});await Promise.all(players.map(read));assert.deepEqual(a.view.history[0],first);
  const newTeam=players.filter(p=>p.view.secret.role==='traitor'),newTask=structuredClone(newTeam[0]?.view.secret.mission??null),victim=players.find(p=>p.view.secret.role==='faithful');
  await act(a,{type:'roundtable'});
  for(const p of players)await act(p,{type:'ballot',target:newTeam.includes(p)?victim.view.me.id:newTeam[0]?.view.me.id??null,...(newTeam.includes(p)?{performed:p===newTeam[0]}:newTeam.length?{suspectedAttempt:p===victim}:{})});
  await read(a);assert.equal(a.view.phase,'results');assert.deepEqual(a.view.results.murderTask,newTask);assert.deepEqual(a.view.history[0],first);if(newTeam.length){assert.equal(a.view.results.murderedId,victim.view.me.id);assert.deepEqual(a.view.results.murderMethod,newTask);}else assert.equal(a.view.results.murderTask,null);
  const p=players[1];await act(p,{type:'leave'});const returned=await request(a,{type:'login',invite:a.view.inviteKey,passcode:p.passcode});assert.equal(returned.status,200);assert.equal(returned.data.view.me.id,p.view.me.id);assert.equal(returned.data.view.me.nextActive,false);
 }
 for(const [a,b] of [[groups[0][0],groups[1][0]],[groups[1][0],groups[2][0]]])assert.equal((await request({...a,view:{...a.view,code:b.view.code}})).status,401);
 console.log('PASS: generated admin/player codes, returning identities and admin access, simultaneous-game isolation, task privacy, failed/attempted/successful murder task snapshots, historical wording, and returning after leaving.');
}finally{for(const players of groups){await read(players[0]);if(players[0].view.phase!=='ended')await act(players[0],{type:'end'});}}
