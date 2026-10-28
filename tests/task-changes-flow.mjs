import assert from 'node:assert/strict';
const origin=process.env.GAME_TEST_ORIGIN||'http://127.0.0.1:5173';
if(!['localhost','127.0.0.1','[::1]'].includes(new URL(origin).hostname))throw new Error('This test only runs against a local disposable database.');
async function request(body,player){
  const res=await fetch(`${origin}/api/game${body?'':`?code=${player.view.code}`}`,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(player?.token?{Authorization:`Bearer ${player.token}`}:{})},...(body?{body:JSON.stringify(body)}:{})});
  return{status:res.status,data:await res.json()};
}
async function action(player,body,status=200){const result=await request({code:player.view.code,...body},player);assert.equal(result.status,status,JSON.stringify(result.data));if(status===200)player.view=result.data;return result.data;}
async function read(player){const result=await request(null,player);assert.equal(result.status,200);player.view=result.data;return result.data;}
let admin;
try{
  const created=await request({type:'create',name:'Alex',gameName:'Task-change integration',adminPasscode:'031415'});assert.equal(created.status,201);admin=created.data;
  const players=[admin],invite=admin.view.inviteKey;
  async function join(name){const r=await request({type:'join',name,code:admin.view.code,invite});assert.equal(r.status,200);players.push(r.data);return r.data;}
  await join('Sam');await join('Jo');await action(admin,{type:'start'});await Promise.all(players.map(read));
  let killer=players.find(p=>p.view.secret?.role==='traitor'),innocent=players.find(p=>p.view.secret?.role==='faithful');
  const first=killer.view.secret.mission,round=killer.view.round;
  const change={type:'changeMission',round,missionId:first.id};
  await action(admin,{type:'pause'});assert.match((await action(killer,change,400)).error,/Resume/);await action(admin,{type:'resume'});
  assert.match((await action(innocent,change,400)).error,/Only a solo Killer/);
  const late=await join('Late player');assert.match((await action(late,change,400)).error,/Only a solo Killer/);
  const simultaneous=await Promise.all([request({code:admin.view.code,...change},killer),request({code:admin.view.code,...change},killer)]);
  assert.deepEqual(simultaneous.map(r=>r.status).sort(),[200,400]);
  await read(killer);assert.equal(killer.view.secret.missionChangesRemaining,1);const second=killer.view.secret.mission;
  assert.notEqual(second.id,first.id);assert.match(simultaneous.find(r=>r.status===400).data.error,/already changed/);
  const login=await request({type:'login',code:admin.view.code,invite,passcode:killer.passcode});assert.equal(login.status,200);assert.equal(login.data.view.me.id,killer.view.me.id);
  Object.assign(killer,login.data);assert.equal(killer.view.secret.missionChangesRemaining,1);
  await action(killer,{type:'changeMission',round,missionId:second.id});const finalTask=killer.view.secret.mission;
  assert.equal(new Set([first.id,second.id,finalTask.id]).size,3);assert.equal(killer.view.secret.missionChangesRemaining,0);
  assert.match((await action(killer,{type:'changeMission',round,missionId:finalTask.id},400)).error,/No change left\./);
  await read(innocent);assert.equal(innocent.view.secret.mission,undefined);assert.equal(innocent.view.secret.missionChangesRemaining,undefined);
  await action(admin,{type:'roundtable'});assert.match((await action(killer,{type:'changeMission',round,missionId:finalTask.id},400)).error,/before the roundtable/);
  await action(killer,{type:'ballot',target:innocent.view.me.id});
  for(const p of players.filter(p=>p!==killer&&p!==late))await action(p,{type:'ballot',target:killer.view.me.id,suspectedAttempt:p===innocent});
  await read(admin);assert.equal(admin.view.phase,'results');assert.deepEqual(admin.view.results.murderMethod,finalTask);
  await action(admin,{type:'nextRound',round});await Promise.all(players.map(read));
  killer=players.find(p=>p.view.secret?.role==='traitor');assert.equal(killer.view.secret.missionChangesRemaining,2);
  await join('Player five');await join('Player six');await action(admin,{type:'roundtable'});await action(admin,{type:'finishVoting'});await action(admin,{type:'nextRound',round:admin.view.round});
  await Promise.all(players.map(read));const team=players.filter(p=>p.view.secret?.role==='traitor');assert.equal(team.length,2);
  for(const p of team){assert.equal(p.view.secret.missionChangesRemaining,undefined);assert.match((await action(p,{type:'changeMission',round:p.view.round,missionId:p.view.secret.mission.id},400)).error,/Only a solo Killer/);}
  console.log('PASS: private solo task changes, paused/unauthorised rejection, simultaneous stale-request protection, sign-in persistence, exactly two replacements, final murder method, reset next round and multiple-Killer rejection.');
}finally{if(admin)await action(admin,{type:'end'}).catch(()=>{});}
