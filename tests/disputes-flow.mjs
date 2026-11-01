import assert from 'node:assert/strict';
const origin=process.env.GAME_TEST_ORIGIN||'http://127.0.0.1:5173';
if(!['localhost','127.0.0.1','[::1]'].includes(new URL(origin).hostname))throw new Error('This test only runs against a local disposable database.');
async function request(player,body){
  const response=await fetch(`${origin}/api/game${body?'':`?code=${player.view.code}`}`,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(player?.token?{Authorization:`Bearer ${player.token}`}:{})},...(body?{body:JSON.stringify({code:player?.view.code,...body})}:{})});
  return {status:response.status,data:await response.json()};
}
async function action(player,body,status=200){const r=await request(player,body);assert.equal(r.status,status,JSON.stringify(r.data));if(status===200)player.view=r.data;return r.data;}
async function read(player){const r=await request(player);assert.equal(r.status,200);player.view=r.data;return r.data;}
async function create(count,name){
  const r=await request(null,{type:'create',name:'Alex',gameName:name,adminPasscode:'123456'});assert.equal(r.status,201);const a=r.data,players=[a];
  for(const name of ['Ben','Charlie','Isla','Jamie','Grace'].slice(0,count-1)){const r=await request(a,{type:'join',name,invite:a.view.inviteKey});assert.equal(r.status,200);players.push(r.data);}
  return players;
}
async function complete(players){
  const a=players[0];await action(a,{type:a.view.round?'nextRound':'start',...(a.view.round?{round:a.view.round}:{})});await Promise.all(players.map(read));
  const victim=players.find(p=>p.view.secret?.role==='faithful'),killer=players.find(p=>p.view.secret?.role==='traitor');await action(a,{type:'roundtable'});
  for(const p of players)await action(p,{type:'ballot',target:p.view.secret.role==='traitor'?victim.view.me.id:killer?.view.me.id??null,...(p.view.secret.role==='traitor'?{performed:true}:killer?{suspectedAttempt:p===victim}:{})});
  await Promise.all(players.map(read));assert.equal(a.view.phase,'results');
}
const groups=[];
try{
  const players=await create(6,'Concurrent dispute checks');groups.push(players);await complete(players);const a=players[0],scores=a.view.players.map(p=>p.score),saved=structuredClone(a.view.results);
  const opened=await Promise.all([request(players[1],{type:'openDispute',round:1}),request(players[2],{type:'openDispute',round:1})]);assert.deepEqual(opened.map(r=>r.status).sort(),[200,400]);
  await action(a,{type:'nextRound',round:1},400);await action(a,{type:'end'},400);
  await action(a,{type:'disputeVote',round:1,choice:'discard'});await action(players[1],{type:'disputeVote',round:1,choice:'discard'});
  const voted=await Promise.all([request(players[2],{type:'disputeVote',round:1,choice:'discard'}),request(players[3],{type:'disputeVote',round:1,choice:'discard'})]);assert.deepEqual(voted.map(r=>r.status),[200,200]);
  await read(a);assert.equal(a.view.results.review.status,'discarded');assert.deepEqual(a.view.players.map(p=>p.score),[0,0,0,0,0,0]);assert.deepEqual(a.view.results,a.view.history[0]);
  await action(players[4],{type:'disputeVote',round:1,choice:'discard'},400);await action(players[5],{type:'openDispute',round:1},400);await read(a);assert.deepEqual(a.view.players.map(p=>p.score),[0,0,0,0,0,0]);
  for(const p of a.view.results.players)assert.equal(p.originalDelta,saved.players.find(x=>x.id===p.id).delta);assert.ok(scores.some(p=>p!==0));
  const other=await create(2,'Isolated dispute checks');groups.push(other);await complete(other);const wrongToken={...other[0],token:a.token};await action(wrongToken,{type:'openDispute',round:1},401);
  await action(other[0],{type:'openDispute',round:1});const pair=await Promise.all([request(other[0],{type:'disputeVote',round:1,choice:'discard'}),request(other[1],{type:'disputeVote',round:1,choice:'keep'})]);assert.deepEqual(pair.map(r=>r.status),[200,200]);await read(other[0]);assert.equal(other[0].view.results.review.adminTieBreak,'discard');
  // Race a new deal against opening a dispute: only one may commit.
  const race=await create(3,'Start versus dispute checks');groups.push(race);await complete(race);
  const raced=await Promise.all([request(race[0],{type:'nextRound',round:1}),request(race[1],{type:'openDispute',round:1})]);assert.deepEqual(raced.map(r=>r.status).sort(),[200,400]);await read(race[0]);assert.ok(race[0].view.phase==='playing'&&race[0].view.round===2||race[0].view.phase==='results'&&race[0].view.dispute.status==='open');
  console.log('PASS: concurrent opening, parallel majority votes, exactly-once point reversal, locked decisions, two-player admin tie-break, cross-game authentication, and next-round/dispute race.');
}finally{
  for(const players of groups){const a=players[0];await read(a);if(a.view.dispute?.status==='open'){for(const p of players)await action(p,{type:'disputeVote',round:a.view.round,choice:'keep'}).catch(()=>{});}await action(a,{type:'end'}).catch(()=>{});}
}
// Optional disposable UI fixture. Only local test credentials go into work/.
if(process.env.GAME_DISPUTE_FIXTURE){
  const players=await create(6,'Friday game');await complete(players);await complete(players);
  const {writeFile}=await import('node:fs/promises');await writeFile(process.env.GAME_DISPUTE_FIXTURE,JSON.stringify(players,null,2));
  console.log('Created a separate local UI fixture with two scored rounds.');
}
