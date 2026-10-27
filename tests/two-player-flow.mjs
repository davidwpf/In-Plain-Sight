import assert from 'node:assert/strict';
const origin=process.env.GAME_TEST_ORIGIN||'http://127.0.0.1:5173';
if(!['localhost','127.0.0.1','[::1]'].includes(new URL(origin).hostname))throw new Error('This integration test is local only.');
async function raw(body,s){const r=await fetch(`${origin}/api/game`,{method:'POST',headers:{'Content-Type':'application/json',Origin:origin,...(s?{Authorization:`Bearer ${s.token}`}:{})},body:JSON.stringify({...body,...(s?{code:s.view.code}:{})})});return{status:r.status,data:await r.json()};}
async function action(body,s){const r=await raw(body,s);assert.ok(r.status<400,JSON.stringify(r));return r.data;}
async function view(s){const r=await fetch(`${origin}/api/game?code=${s.view.code}`,{headers:{Authorization:`Bearer ${s.token}`}});assert.equal(r.status,200);return r.json();}
async function advance(){const current=await view(admin);await action({type:'nextRound',round:current.round},admin);}
const admin=await action({type:'create',name:'Alex',gameName:'Two-player integration'});let ended=false;
try{
 const other=await action({type:'join',code:admin.view.code,name:'Sam'}),sessions=[admin,other];
 assert.equal(other.view.roundMinutes,60);assert.equal(other.view.readyCount,2);assert.equal(other.view.nextTraitorCount,null);
 await action({type:'start'},admin);
 let activeViews=await Promise.all(sessions.map(view));assert.ok(activeViews.every(v=>v.roundMode==='two-player'&&v.activeCount===2&&v.traitorCount===null));
 assert.ok(activeViews[0].deadline>Date.now()+59*60000);assert.ok(activeViews[0].deadline<=Date.now()+60*60000);
 const roles=activeViews.map(v=>v.secret.role),killers=roles.filter(r=>r==='traitor').length;assert.ok(killers<=1);
 const late=await action({type:'join',code:admin.view.code,name:'Taylor'});sessions.push(late);
 assert.equal(late.view.me.active,false);assert.equal(late.view.secret,null);assert.equal(late.view.activeCount,2);assert.equal(late.view.roundMode,'two-player');assert.equal(late.view.traitorCount,null);assert.equal(late.view.nextTraitorCount,1);
 await action({type:'roundtable'},admin);await action({type:'pause'},admin);
 const innocentIndex=roles.findIndex(r=>r==='faithful');assert.equal((await raw({type:'ballot',target:null,suspectedAttempt:false},sessions[innocentIndex])).status,400);await action({type:'resume'},admin);
 const victim=activeViews[innocentIndex].me.id;
 for(let i=0;i<2;i++)await action({type:'ballot',target:roles[i]==='traitor'?victim:null,...(roles[i]==='traitor'?{}:{suspectedAttempt:false})},sessions[i]);
 let completed=await view(admin);assert.equal(completed.phase,'results');assert.equal(completed.results.mode,'two-player');assert.equal(completed.results.submittedCount,2);assert.equal(completed.results.rulesVersion,6);
 for(let i=0;i<2;i++){const p=completed.results.players.find(p=>p.id===activeViews[i].me.id);assert.equal(p.delta,roles[i]==='traitor'?6:killers?-1:2);}
 const firstResult=structuredClone(completed.results),scores=completed.players.map(p=>p.score);assert.equal(completed.deadline,null);assert.equal((await raw({type:'nextRound',round:completed.round},other)).status,400);const starts=await Promise.all([raw({type:'nextRound',round:completed.round},admin),raw({type:'nextRound',round:completed.round},admin)]);assert.deepEqual(starts.map(r=>r.status).sort(),[200,400]);assert.equal((await raw({type:'nextRound',round:completed.round},admin)).status,400);
 let groupViews=await Promise.all(sessions.map(view));assert.ok(groupViews.every(v=>v.roundMode==='group'&&v.activeCount===3&&v.traitorCount===1&&v.round===2));assert.deepEqual(groupViews[0].history[0],firstResult);assert.deepEqual(groupViews[0].players.map(p=>p.score),scores);
 await action({type:'leave'},late);assert.equal((await view(late)).me.nextActive,false);assert.equal((await view(late)).me.active,true);
 await action({type:'roundtable'},admin);
 const groupInnocent=groupViews.findIndex(v=>v.secret.role==='faithful'),groupKiller=groupViews.findIndex(v=>v.secret.role==='traitor');
 assert.equal((await raw({type:'ballot',target:null,suspectedAttempt:false},sessions[groupInnocent])).status,400);
 for(let i=0;i<3;i++)await action({type:'ballot',target:groupViews[i].secret.role==='traitor'?null:groupViews[groupKiller].me.id,...(groupViews[i].secret.role==='traitor'?{}:{suspectedAttempt:false})},sessions[i]);
 completed=await view(admin);assert.equal(completed.results.mode,'group');assert.equal(completed.history.length,2);await advance();
 let pair=await view(admin);assert.equal(pair.roundMode,'two-player');assert.equal(pair.activeCount,2);assert.equal(pair.traitorCount,null);assert.equal((await view(late)).secret,null);
 const returned=await action({type:'login',code:late.view.code,passcode:late.passcode});assert.equal(returned.view.me.nextActive,false);assert.equal(returned.view.me.id,late.view.me.id);
 await action({type:'ready',ready:true},returned);assert.equal((await view(admin)).activeCount,2);
 await action({type:'roundtable'},admin);await action({type:'finishVoting'},admin);await advance();
 assert.equal((await view(returned)).activeCount,3);assert.ok((await view(returned)).secret);
 await action({type:'leave'},admin);await action({type:'roundtable'},admin);await action({type:'finishVoting'},admin);await advance();
 const spectator=await view(admin);assert.equal(spectator.me.isAdmin,true);assert.equal(spectator.me.active,false);assert.equal(spectator.secret,null);assert.equal(spectator.traitorCount,null);assert.equal(spectator.activeCount,2);
 await action({type:'leave'},returned);await action({type:'roundtable'},admin);await action({type:'finishVoting'},admin);
 const held=await view(other);assert.equal(held.phase,'results');assert.equal(held.readyCount,1);assert.equal(held.roundMinutes,60);assert.equal((await raw({type:'nextRound',round:held.round},admin)).status,400);
 const newPlayer=await action({type:'join',code:admin.view.code,name:'Robin'});assert.equal(newPlayer.view.readyCount,2);
 const adminReturn=await action({type:'login',code:admin.view.code,passcode:admin.passcode});assert.equal(adminReturn.view.me.isAdmin,true);assert.equal(adminReturn.view.me.nextActive,false);
 await action({type:'nextRound',round:held.round},adminReturn);const restarted=await view(newPlayer);assert.equal(restarted.roundMode,'two-player');assert.equal(restarted.activeCount,2);assert.ok(restarted.secret);assert.deepEqual(restarted.history[0],firstResult);
 await action({type:'end'},adminReturn);ended=true;
 console.log('PASS: persisted two-player start with 60-minute default, hidden counts, No killer voting and scoring, joins during play, 2→3→2→3→2 transitions, leave and private-code return, sitting-out admin control, fewer-than-two results hold and admin start after a new player joins; completed history preserved.');
}finally{if(!ended)await action({type:'end'},admin).catch(()=>{});}
