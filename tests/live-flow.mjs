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
const admin=await request({type:'create',name:'Test Admin',gameName:'Shared-device integration test'});const sessions=[admin];
assert.match(admin.passcode,/^\d{6}$/);assert.ok(admin.view.me.isAdmin);
const joined=await Promise.all(Array.from({length:9},(_,i)=>request({type:'join',code:admin.view.code,name:`Guest ${i+1}`})));sessions.push(...joined);
assert.equal(new Set(sessions.map(s=>s.passcode)).size,10);assert.equal((await view(admin)).players.length,10);
await assert.rejects(()=>request({type:'start'},sessions[1]),/Only the admin/);
for(const s of sessions){const logged=await request({type:'login',code:s.view.code,passcode:s.passcode});assert.equal(logged.view.me.id,s.view.me.id);assert.equal(logged.view.me.isAdmin,s===admin);}
const bad=await raw({type:'login',code:admin.view.code,passcode:'not-a-code'});assert.equal(bad.status,400);
await request({type:'start'},admin);
const initial=await Promise.all(sessions.map(view));const traitors=sessions.filter((_,i)=>initial[i].secret.role==='traitor'),faithful=sessions.filter((_,i)=>initial[i].secret.role==='faithful');assert.equal(traitors.length,3);
for(const v of initial){for(const p of v.players){assert.equal(p.role,undefined);assert.equal(p.passcode,undefined);assert.equal(p.loginHash,undefined);}const text=JSON.stringify(v);for(const secret of ['tokenHashes','loginHash','authSalt','loginAttempts','"ballots"'])assert.ok(!text.includes(secret));assert.equal(v.murderedId,undefined);assert.equal(v.results,null);}
assert.deepEqual(initial.find(v=>v.me.id===traitors[0].view.me.id).secret.mission,initial.find(v=>v.me.id===traitors[1].view.me.id).secret.mission);
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
await request({type:'ballot',target:victim},traitors[0]);await request({type:'ballot',target:victim},traitors[1]);await request({type:'ballot',target:attempted},traitors[2]);
const hidden=await view(faithful[0]);assert.equal(hidden.results,null);assert.equal(hidden.murderedId,undefined);assert.equal(hidden.myBallot,null);assert.equal(hidden.voteDeadline,null);
await request({type:'ballot',target:caught},faithful[0]);await request({type:'ballot',target:caught},faithful[1]);const half=await view(admin);assert.equal(half.submittedCount,5);assert.ok(half.voteDeadline>Date.now()+590000);
await Promise.all(faithful.slice(2).map(s=>request({type:'ballot',target:caught},s)));
const result=await view(admin);assert.equal(result.phase,'results');assert.equal(result.history.length,1);assert.equal(result.results.submittedCount,10);assert.equal(result.results.murderedId,victim);assert.equal(result.results.attempts[0].targetId,attempted);
for(const s of traitors.slice(0,2))assert.equal(result.results.players.find(p=>p.id===s.view.me.id).delta,2);assert.equal(result.results.players.find(p=>p.id===caught).delta,-3);
const named=traitors.slice(0,2).map(s=>s.view.me.name);assert.equal(result.results.players.find(p=>p.id===victim).blurb,`You were murdered. ${named.join(' and ')} both killed you.`);
const lateResult=await view(late);assert.equal(lateResult.me.active,false);assert.equal(lateResult.secret,null);
const reread=await view(admin);assert.deepEqual(reread.players.map(p=>p.score),result.players.map(p=>p.score));
await request({type:'ready',ready:false},faithful.at(-1));advanceLocalDeadline(admin.view.code);const next=await view(late);assert.equal(next.phase,'playing');assert.equal(next.round,2);assert.equal(next.me.active,true);assert.ok(next.secret);assert.equal(next.activeCount,10);assert.equal(next.traitorCount,3);assert.equal(next.submittedCount,0);assert.equal(next.history.length,1);
const restored=await request({type:'login',code:faithful[0].view.code,passcode:faithful[0].passcode});assert.equal(restored.view.me.id,faithful[0].view.me.id);assert.equal(restored.view.me.score,3);
await request({type:'end'},admin);assert.equal((await view(late)).phase,'ended');
let wrong=String((Number(admin.passcode)+1)%1000000).padStart(6,'0');while(sessions.some(s=>s.passcode===wrong)||late.passcode===wrong)wrong=String((Number(wrong)+1)%1000000).padStart(6,'0');
for(let i=0;i<8;i++)assert.equal((await raw({type:'login',code:admin.view.code,passcode:wrong})).status,401);assert.equal((await raw({type:'login',code:admin.view.code,passcode:wrong})).status,429);
assert.equal((await view(admin)).phase,'ended');
console.log('PASS: ten independent players, private-code recovery, admin permissions, simultaneous joins and submissions, paused voting, secret majority reports, minority scoring, exact reveal wording, late arrivals after the break, persistent scores and login throttling.');
console.log(`Disposable local test Game: ${admin.view.code}`);
