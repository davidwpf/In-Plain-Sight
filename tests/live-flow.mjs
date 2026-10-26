import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
const origin=process.env.GAME_TEST_ORIGIN||'http://127.0.0.1:5173';
if(!['localhost','127.0.0.1','[::1]'].includes(new URL(origin).hostname))throw new Error('This test only runs against a local preview.');
async function raw(body,session){const res=await fetch(`${origin}/api/game`,{method:'POST',headers:{'Content-Type':'application/json',Origin:origin,...(session?{Authorization:`Bearer ${session.token}`}:{})},body:JSON.stringify({...body,...(session?{code:session.view.code}:{})})});return {status:res.status,data:await res.json()};}
async function request(body,session){const {status,data}=await raw(body,session);if(status>=400)throw new Error(`${status}: ${data.error}`);return data;}
async function view(s){const res=await fetch(`${origin}/api/game?code=${s.view.code}`,{headers:{Authorization:`Bearer ${s.token}`}});assert.equal(res.status,200);return res.json();}
function advanceLocalDeadline(gameCode){assert.match(gameCode,/^[A-Z2-9]{6}$/);const command=`UPDATE games SET state = json_set(state, '$.deadline', ${Date.now()-1000}), version = version + 1 WHERE code = '${gameCode}'`;
  execFileSync(process.execPath,['--import','./scripts/sites-env.mjs','./node_modules/wrangler/bin/wrangler.js','d1','execute','DB','--local','--config','dist/server/wrangler.json','--persist-to','.wrangler/state','--command',command],{stdio:'pipe'});
}
assert.equal((await raw({type:'create',name:'Test Admin',gameName:'Invalid duration',roundMinutes:45})).status,400);
const admin=await request({type:'create',name:'Test Admin',gameName:'Shared-device integration test',roundMinutes:90});const sessions=[admin];
assert.equal(admin.view.roundMinutes,90);
assert.match(admin.passcode,/^\d{6}$/);assert.ok(admin.view.me.isAdmin);
const joined=await Promise.all(Array.from({length:9},(_,i)=>request({type:'join',code:admin.view.code,name:`Guest ${i+1}`})));sessions.push(...joined);
assert.equal(new Set(sessions.map(s=>s.passcode)).size,10);assert.equal((await view(admin)).players.length,10);
await assert.rejects(()=>request({type:'start'},sessions[1]),/Only the admin/);
for(const s of sessions){const logged=await request({type:'login',code:s.view.code,passcode:s.passcode});assert.equal(logged.view.me.id,s.view.me.id);assert.equal(logged.view.me.isAdmin,s===admin);}
const bad=await raw({type:'login',code:admin.view.code,passcode:'not-a-code'});assert.equal(bad.status,400);
await request({type:'start'},admin);
const initial=await Promise.all(sessions.map(view));const traitors=sessions.filter((_,i)=>initial[i].secret.role==='traitor'),faithful=sessions.filter((_,i)=>initial[i].secret.role==='faithful');assert.equal(traitors.length,3);
assert.ok(initial[0].deadline>Date.now()+89*60000);assert.ok(initial[0].deadline<=Date.now()+90*60000);
for(const v of initial){for(const p of v.players){assert.equal(p.role,undefined);assert.equal(p.passcode,undefined);assert.equal(p.loginHash,undefined);}const text=JSON.stringify(v);for(const secret of ['tokenHashes','loginHash','authSalt','loginAttempts','"ballots"'])assert.ok(!text.includes(secret));assert.equal(v.murderedId,undefined);assert.equal(v.results,null);}
assert.deepEqual(initial.find(v=>v.me.id===traitors[0].view.me.id).secret.mission,initial.find(v=>v.me.id===traitors[1].view.me.id).secret.mission);
const firstSecret=initial.find(v=>v.me.id===traitors[0].view.me.id).secret;
assert.deepEqual(firstSecret.signal,initial.find(v=>v.me.id===traitors[1].view.me.id).secret.signal);assert.equal(firstSecret.signal.reply,undefined);
const seenSignals=new Set([firstSecret.signal.id]),seenTasks=new Set([firstSecret.mission.id]);
for(const v of initial)assert.equal(v.usedTaskIds,undefined);
await assert.rejects(()=>request({type:'roundtable'},sessions[1]),/Only the admin/);
await request({type:'pause'},admin);await assert.rejects(()=>request({type:'roundtable'},admin),/Resume/);await request({type:'resume'},admin);
await request({type:'roundtable'},admin);const early=await view(admin);assert.equal(early.phase,'voting');assert.equal(early.round,1);assert.equal(early.deadline,null);assert.equal(early.voteDeadline,null);assert.equal(early.results,null);
await request({type:'pause'},admin);const paused=await view(admin);assert.equal(paused.paused,true);
await assert.rejects(()=>request({type:'ballot',target:traitors[0].view.me.id},faithful[0]),/paused/);
const late=await request({type:'join',code:admin.view.code,name:'Late Guest'});assert.equal(late.view.secret,null);assert.equal(late.view.me.active,false);assert.equal(late.view.phase,'voting');assert.equal(late.view.paused,true);
const returnedAdmin=await request({type:'login',code:admin.view.code,passcode:admin.passcode});assert.equal(returnedAdmin.view.me.isAdmin,true);
await request({type:'resume'},admin);
await assert.rejects(()=>request({type:'ballot',target:traitors[0].view.me.id},late),/next round/);
const victim=faithful[0].view.me.id,attempted=faithful[1].view.me.id,caught=traitors[2].view.me.id;
assert.equal((await raw({type:'ballot',target:victim},traitors[0])).status,400);
assert.equal((await view(traitors[0])).myBallot,null);
await request({type:'ballot',target:victim,performed:true},traitors[0]);await request({type:'ballot',target:victim,performed:false},traitors[1]);await request({type:'ballot',target:attempted,performed:true},traitors[2]);
const hidden=await view(faithful[0]);assert.equal(hidden.results,null);assert.equal(hidden.murderedId,undefined);assert.equal(hidden.myBallot,null);assert.equal(hidden.voteDeadline,null);for(const p of hidden.players){assert.equal(p.submitted,p.active?traitors.some(s=>s.view.me.id===p.id):undefined);assert.equal(p.performed,undefined);}
await request({type:'ballot',target:caught},faithful[0]);await request({type:'ballot',target:caught},faithful[1]);const half=await view(admin);assert.equal(half.submittedCount,5);assert.ok(half.voteDeadline>Date.now()+290000);
await Promise.all(faithful.slice(2).map(s=>request({type:'ballot',target:caught},s)));
const result=await view(admin);assert.equal(result.phase,'results');assert.equal(result.history.length,1);assert.equal(result.results.submittedCount,10);assert.equal(result.results.murderedId,victim);assert.equal(result.results.attempts[0].targetId,attempted);
assert.deepEqual(result.results.murderMethod,initial.find(v=>v.me.id===traitors[0].view.me.id).secret.mission);
assert.equal(result.results.rulesVersion,3);assert.equal(result.results.players.find(p=>p.id===traitors[0].view.me.id).delta,4);assert.equal(result.results.players.find(p=>p.id===traitors[1].view.me.id).delta,0);assert.equal(result.results.players.find(p=>p.id===caught).delta,-2);
assert.deepEqual(new Set(result.results.murdererIds),new Set([traitors[0].view.me.id]));
const named=result.results.murdererIds.map(id=>result.players.find(p=>p.id===id).name);assert.equal(result.results.players.find(p=>p.id===victim).blurb,`You were murdered. ${named[0]} killed you.`);
const lateResult=await view(late);assert.equal(lateResult.me.active,false);assert.equal(lateResult.secret,null);
const reread=await view(admin);assert.deepEqual(reread.players.map(p=>p.score),result.players.map(p=>p.score));
await request({type:'ready',ready:false},faithful.at(-1));advanceLocalDeadline(admin.view.code);const next=await view(late);assert.equal(next.phase,'playing');assert.equal(next.round,2);assert.equal(next.me.active,true);assert.ok(next.secret);assert.equal(next.activeCount,10);assert.equal(next.traitorCount,3);assert.equal(next.submittedCount,0);assert.equal(next.history.length,1);
const restored=await request({type:'login',code:faithful[0].view.code,passcode:faithful[0].passcode});assert.equal(restored.view.me.id,faithful[0].view.me.id);assert.equal(restored.view.me.score,4);
// Exercise fresh persisted assignments through three completed rounds, including the late arrival.
for(const round of [2,3]){
  const current=await Promise.all([...sessions,late].map(async s=>({session:s,view:await view(s)})));
  const active=current.filter(p=>p.view.me.active),team=active.filter(p=>p.view.secret.role==='traitor'),others=active.filter(p=>p.view.secret.role==='faithful');
  assert.equal(active.length,10);assert.equal(team.length,3);assert.ok(active.every(p=>p.view.round===round));
  const secret=team[0].view.secret;assert.ok(!seenSignals.has(secret.signal.id));assert.ok(!seenTasks.has(secret.mission.id));seenSignals.add(secret.signal.id);seenTasks.add(secret.mission.id);
  for(const p of team){assert.deepEqual(p.view.secret.signal,secret.signal);assert.deepEqual(p.view.secret.mission,secret.mission);}
  await request({type:'roundtable'},admin);
  await Promise.all(active.map(p=>request({type:'ballot',target:p.view.secret.role==='traitor'?(round===3&&p.view.me.id===team[2].view.me.id?team[0].view.me.id:others[0].view.me.id):team[0].view.me.id,...(p.view.secret.role==='traitor'?{performed:true}:{})},p.session)));
  const completed=await view(admin);assert.equal(completed.phase,'results');assert.equal(completed.history.length,round);
  for(const p of active)assert.equal(completed.results.players.find(r=>r.id===p.view.me.id).role,p.view.secret.role);
  if(round===3){
    const player=id=>completed.results.players.find(p=>p.id===id);
    assert.equal(player(team[0].view.me.id).delta,0);assert.equal(player(team[0].view.me.id).penalties.traitorTarget,-1);
    assert.equal(player(team[1].view.me.id).delta,4);
    assert.equal(player(team[2].view.me.id).delta,-2);assert.equal(player(team[2].view.me.id).penalties.mistakenAttack,-2);
    assert.equal(completed.results.murderedId,others[0].view.me.id);
  }
  assert.deepEqual(completed.history[0],result.results);
  advanceLocalDeadline(admin.view.code);const dealt=await view(late);
  assert.equal(dealt.phase,'playing');assert.equal(dealt.round,round+1);assert.equal(dealt.submittedCount,0);assert.equal(dealt.results,null);
}
// Close a stalled vote before halfway; only the admin may do so, and never while paused.
const fourth=await Promise.all([...sessions,late].map(async s=>({session:s,view:await view(s)})));
const voter=fourth.find(p=>p.view.me.active&&p.view.secret.role==='faithful'),suspect=fourth.find(p=>p.view.me.active&&p.view.secret.role==='traitor');
await request({type:'roundtable'},admin);
await request({type:'ballot',target:suspect.view.me.id},voter.session);
assert.equal((await view(admin)).voteDeadline,null);
await assert.rejects(()=>request({type:'finishVoting'},sessions[1]),/Only the admin/);
await request({type:'pause'},admin);await assert.rejects(()=>request({type:'finishVoting'},admin),/Resume/);await request({type:'resume'},admin);
const finished=await request({type:'finishVoting'},admin);assert.equal(finished.phase,'results');assert.equal(finished.results.submittedCount,1);assert.equal(finished.history.length,4);
assert.equal(finished.results.players.find(p=>p.id===voter.view.me.id).delta,4);
for(const p of finished.results.players.filter(p=>p.role==='faithful'&&!p.submitted))assert.equal(p.delta,-2);
const repeated=await request({type:'finishVoting'},admin);assert.equal(repeated.history.length,4);assert.deepEqual(repeated.players.map(p=>p.score),finished.players.map(p=>p.score));
await request({type:'end'},admin);assert.equal((await view(late)).phase,'ended');
let wrong=String((Number(admin.passcode)+1)%1000000).padStart(6,'0');while(sessions.some(s=>s.passcode===wrong)||late.passcode===wrong)wrong=String((Number(wrong)+1)%1000000).padStart(6,'0');
for(let i=0;i<8;i++)assert.equal((await raw({type:'login',code:admin.view.code,passcode:wrong})).status,401);assert.equal((await raw({type:'login',code:admin.view.code,passcode:wrong})).status,429);
assert.equal((await view(admin)).phase,'ended');
console.log('PASS: ten independent players, private-code recovery, admin permissions, simultaneous joins and submissions, 90-minute rounds, paused voting, secret majority reports, recorded murder methods, revised scoring, actual mistaken attacks and once-only target penalties, exact reveal wording, late arrivals, fresh assignments across three completed rounds, confirmed early vote closure with missing submissions, persistent history and login throttling.');
console.log(`Disposable local test Game: ${admin.view.code}`);
