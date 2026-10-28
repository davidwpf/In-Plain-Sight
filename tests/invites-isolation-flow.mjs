import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
const origin=process.env.GAME_TEST_ORIGIN||'http://127.0.0.1:5173';
if(!['localhost','127.0.0.1','[::1]'].includes(new URL(origin).hostname))throw new Error('This test is local only.');
async function raw(body,s){const r=await fetch(`${origin}/api/game`,{method:'POST',headers:{'Content-Type':'application/json',Origin:origin,...(s?{Authorization:`Bearer ${s.token}`}:{})},body:JSON.stringify({...body,...(s?{code:body.code||s.view.code}:{})})});return{status:r.status,data:await r.json()};}
async function act(body,s){const r=await raw(body,s);assert.ok(r.status<400,JSON.stringify(r));return r.data;}
async function get(s,code=s.view.code){const r=await fetch(`${origin}/api/game?code=${code}`,{headers:{Authorization:`Bearer ${s.token}`}});return{status:r.status,data:await r.json()};}
async function preview(query){const r=await fetch(`${origin}/api/game?preview=1&${new URLSearchParams(query)}`);return{status:r.status,data:await r.json()};}
function sql(command){return JSON.parse(execFileSync(process.execPath,['--import','./scripts/sites-env.mjs','./node_modules/wrangler/bin/wrangler.js','d1','execute','DB','--local','--json','--config','dist/server/wrangler.json','--persist-to','.wrangler/state','--command',command],{encoding:'utf8'}));}
const admins=[];
try{
 for(const code of ['12345','1234567','abcdef',null,123456])assert.equal((await raw({type:'create',name:'Alex',gameName:'Invalid code',adminPasscode:code})).status,400);
 admins.push(...await Promise.all(Array.from({length:3},()=>act({type:'create',name:'Alex',gameName:'Saturday game',adminPasscode:'031415'}))));
 assert.equal(new Set(admins.map(s=>s.view.code)).size,3);assert.equal(new Set(admins.map(s=>s.view.inviteKey)).size,3);assert.ok(admins.every(s=>s.passcode==='031415'&&/^[a-f0-9]{64}$/.test(s.view.inviteKey)));
 const groups=await Promise.all(admins.map(async(a,i)=>[a,...await Promise.all(Array.from({length:[1,2,5][i]},(_,j)=>act({type:'join',code:a.view.code,invite:a.view.inviteKey,name:`Guest ${j+1}`})))]));
 for(const[a,b]of [[admins[0],admins[1]],[admins[1],admins[2]],[admins[2],admins[0]]]){
  const p=await preview({invite:a.view.inviteKey});assert.equal(p.status,200);assert.deepEqual(Object.keys(p.data).sort(),['code','expiresAt','name']);assert.equal(p.data.code,a.view.code);assert.equal(p.data.name,'Saturday game');
  assert.equal((await preview({code:a.view.code})).status,404);
  assert.equal((await raw({type:'join',code:a.view.code,name:'Intruder'})).status,404);
  assert.equal((await raw({type:'join',code:a.view.code,invite:b.view.inviteKey,name:'Intruder'})).status,404);
  assert.equal((await raw({type:'login',code:a.view.code,invite:b.view.inviteKey,passcode:a.passcode})).status,404);
  assert.equal((await get(a,b.view.code)).status,401);
  for(const type of ['start','pause','end'])assert.equal((await raw({type,code:b.view.code},a)).status,401);
  const returned=await act({type:'login',code:a.view.code,invite:a.view.inviteKey,passcode:'031415'});assert.equal(returned.view.me.id,a.view.me.id);assert.ok(returned.view.me.isAdmin);
 }
 await Promise.all(admins.map(a=>act({type:'start'},a)));
 const current=await Promise.all(groups.map(g=>Promise.all(g.map(async s=>(await get(s)).data))));
 for(const[i,views]of current.entries()){assert.equal(views.length,[2,3,6][i]);assert.ok(views.every(v=>v.activeCount===views.length&&v.round===1&&v.players.length===views.length));assert.deepEqual(new Set(views.map(v=>v.me.id)),new Set(groups[i].map(s=>s.view.me.id)));}
 await act({type:'pause'},admins[0]);assert.equal((await get(admins[0])).data.paused,true);assert.equal((await get(admins[1])).data.paused,false);await act({type:'resume'},admins[0]);
 await act({type:'roundtable'},admins[0]);await act({type:'finishVoting'},admins[0]);assert.equal((await get(admins[0])).data.history.length,1);assert.equal((await get(admins[1])).data.history.length,0);assert.equal((await get(admins[1])).data.phase,'playing');
 await act({type:'nextRound',round:1},admins[0]);assert.equal((await get(admins[0])).data.round,2);assert.equal((await get(admins[1])).data.round,1);
 await act({type:'end'},admins[0]);const ended=await preview({invite:admins[0].view.inviteKey});assert.equal(ended.status,200);assert.equal((await act({type:'login',code:admins[0].view.code,invite:admins[0].view.inviteKey,passcode:'031415'})).view.phase,'ended');
 const a=admins[1],b=admins[2];let wrong='999999';while(groups[1].some(s=>s.passcode===wrong))wrong=String((Number(wrong)+1)%1000000).padStart(6,'0');for(let i=0;i<8;i++)assert.equal((await raw({type:'login',code:a.view.code,invite:a.view.inviteKey,passcode:wrong})).status,401);
 assert.equal((await raw({type:'login',code:a.view.code,invite:a.view.inviteKey,passcode:a.passcode})).status,429);assert.equal((await act({type:'login',code:b.view.code,invite:b.view.inviteKey,passcode:b.passcode})).view.me.isAdmin,true);
 // Simulate a saved game from before long invitations; its existing link still works.
 const legacy=await act({type:'create',name:'Legacy admin',gameName:'Existing invitation'});admins.push(legacy);assert.match(legacy.view.code,/^[A-Z2-9]{6}$/);
 sql(`UPDATE games SET invite_hash=NULL,state=json_remove(state,'$.inviteKey'),version=version+1 WHERE code='${legacy.view.code}'`);
 assert.equal((await preview({code:legacy.view.code})).data.name,'Existing invitation');await act({type:'join',code:legacy.view.code,name:'Old link guest'});
 // Expiry denies access and deletes only the expired row, even on preview.
 const doomed=admins[0];assert.match(doomed.view.code,/^[A-Z2-9]{6}$/);
 sql(`UPDATE games SET expires_at=${Date.now()-1} WHERE code='${doomed.view.code}'`);
 assert.equal((await preview({invite:doomed.view.inviteKey})).status,404);
 const rows=sql(`SELECT code FROM games WHERE code IN ('${doomed.view.code}','${b.view.code}')`);assert.deepEqual(rows[0].results,[{code:b.view.code}]);assert.equal((await get(b)).status,200);
 console.log('PASS: simultaneous games with identical names and admin codes; distinct invites, players, sessions, roles, phases, scores, history and login limits; cross-game tokens and mismatched invites rejected; no short-code-only joins; custom leading-zero admin code; minimal invite preview; ended-game recovery; old invite compatibility; expired game physically deleted while live game survives.');
}finally{for(const a of admins)await raw({type:'end'},a).catch(()=>{});}
