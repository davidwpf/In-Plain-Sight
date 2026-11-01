import assert from 'node:assert/strict';
const origin=process.env.GAME_TEST_ORIGIN||'http://127.0.0.1:5173';
if(!['localhost','127.0.0.1','[::1]'].includes(new URL(origin).hostname))throw new Error('This test only runs against a local disposable database.');
async function request(player,body){const r=await fetch(`${origin}/api/game${body?'':`?code=${player.view.code}`}`,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(player?.token?{Authorization:`Bearer ${player.token}`}:{})},...(body?{body:JSON.stringify({code:player?.view.code,...body})}:{})});return {status:r.status,data:await r.json()};}
async function action(p,body,status=200){const r=await request(p,body);assert.equal(r.status,status,JSON.stringify(r.data));if(status===200)p.view=r.data;return r.data;}
async function read(p){const r=await request(p);assert.equal(r.status,200);p.view=r.data;return r.data;}
async function create(count,name){const r=await request(null,{type:'create',name:'Alex',gameName:name,adminPasscode:'123456'});assert.equal(r.status,201);const players=[r.data];for(const name of ['Ben','Charlie','Isla','Jamie','Alexandria Montgomery'].slice(0,count-1))await join(players,name);return players;}
async function join(players,name){const r=await request(players[0],{type:'join',name,invite:players[0].view.inviteKey});assert.equal(r.status,200);players.push(r.data);return r.data;}
const finalPlan=(p,enabled)=>({type:'setFinalRound',round:p.view.round,expectedFinalRound:p.view.finalRound??null,enabled});
async function start(players){const a=players[0];await action(a,{type:a.view.round?'nextRound':'start',...(a.view.round?{round:a.view.round}:{})});await Promise.all(players.map(read));}
async function complete(players){
 const a=players[0];await read(a);if(a.view.phase==='playing')await action(a,{type:'roundtable'});await Promise.all(players.map(read));
 const active=players.filter(p=>p.view.me.active),killer=active.find(p=>p.view.secret.role==='traitor'),victim=active.find(p=>p.view.secret.role==='faithful');
 for(const p of active)await action(p,{type:'ballot',target:p.view.secret.role==='traitor'?victim.view.me.id:killer?.view.me.id??null,...(p.view.secret.role==='traitor'?{performed:true}:killer?{suspectedAttempt:p===victim}:{})});await Promise.all(players.map(read));assert.equal(a.view.phase,'results');
}
const groups=[];
try{
 const players=await create(3,'Final-round integration');groups.push(players);const a=players[0];await start(players);await complete(players);
 const original=a.view.players.map(p=>({id:p.id,score:p.score}));assert.ok(a.view.players.every(p=>p.roundsPlayed===1));
 const plan=finalPlan(a,true);const marked=await Promise.all([request(a,plan),request(a,plan)]);assert.deepEqual(marked.map(r=>r.status).sort(),[200,400]);await read(a);assert.equal(a.view.finalRound,2);
 await action(players[1],finalPlan(a,false),400);await action(players[1],{type:'ready',ready:false});const late=await join(players,'Taylor');await start(players);assert.equal(a.view.finalRound,2);assert.equal(late.view.me.roundsPlayed,0);await complete(players);
 await action(a,{type:'openDispute',round:2});await action(a,{type:'finishGame',round:2},400);
 const voters=players.filter(p=>p.view.me.active);for(const p of voters.slice(0,2))await action(p,{type:'disputeVote',round:2,choice:'discard'});
 await read(a);assert.equal(a.view.results.review.status,'discarded');assert.equal(a.view.finishSummary.completedRounds,1);assert.equal(a.view.players.find(p=>p.id===late.view.me.id).roundsPlayed,0);
 for(const old of original)assert.equal(a.view.players.find(p=>p.id===old.id).score,old.score);
 await start(players);assert.equal(a.view.round,3);assert.equal(a.view.finalRound,3);await complete(players);
 const finishOrContinue=await Promise.all([request(a,{type:'finishGame',round:3}),request(a,finalPlan(a,false))]);assert.deepEqual(finishOrContinue.map(r=>r.status).sort(),[200,400]);await read(a);assert.ok(a.view.phase==='ended'||a.view.finalRound===null);
 const pair=await create(2,'Confirm-once integration');groups.push(pair);await action(pair[0],finalPlan(pair[0],true));await start(pair);await complete(pair);const confirmed=await Promise.all([request(pair[0],{type:'finishGame',round:1}),request(pair[0],{type:'finishGame',round:1})]);assert.deepEqual(confirmed.map(r=>r.status).sort(),[200,400]);await read(pair[0]);assert.equal(pair[0].view.phase,'ended');assert.equal(pair[0].view.finishSummary.completedRounds,1);
 const crossGame={...pair[0],token:a.token};await action(crossGame,{type:'setFinalRound',round:1,expectedFinalRound:1,enabled:false},401);
 console.log('PASS: concurrent final-round plans, late arrival and sit-out counts, disputed-final rollback, final replay, confirmation/continue race, duplicate finish protection and cross-game isolation.');
}finally{
 for(const players of groups){const a=players[0];await read(a);if(a.view.phase!=='ended')await action(a,{type:'end'}).catch(()=>{});}
}
if(process.env.GAME_FINAL_FIXTURE){const players=await create(6,'Weekend game');await start(players);await complete(players);const {writeFile}=await import('node:fs/promises');await writeFile(process.env.GAME_FINAL_FIXTURE,JSON.stringify(players,null,2));console.log('Created a separate local UI fixture after one scored round.');}
