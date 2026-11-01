import assert from 'node:assert/strict';
const origin=process.env.GAME_TEST_ORIGIN||'http://127.0.0.1:5173';
if(!['localhost','127.0.0.1','[::1]'].includes(new URL(origin).hostname))throw new Error('This test only runs against a local disposable database.');
async function request(p,body){const r=await fetch(origin+'/api/game'+(body?'':`?code=${p.view.code}`),{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(p?.token?{Authorization:`Bearer ${p.token}`}:{})},...(body?{body:JSON.stringify({code:p?.view.code,...body})}:{})});return {status:r.status,data:await r.json()};}
async function act(p,body,status=200){const r=await request(p,body);assert.equal(r.status,status,JSON.stringify(r.data));if(status===200)p.view=r.data;return r.data;}
async function read(p){const r=await request(p);assert.equal(r.status,200);p.view=r.data;return r.data;}
async function create(name){const r=await request(null,{type:'create',name:'Alex',gameName:name,adminPasscode:'123456'});assert.equal(r.status,201);const a=r.data,players=[a];for(const name of ['Ben','Charlie']){const r=await request(a,{type:'join',name,invite:a.view.inviteKey});assert.equal(r.status,200);players.push(r.data);}await read(a);return players;}
const choice=(p,asFinal)=>({type:p.view.round?'nextRound':'start',round:p.view.round,expectedFinalRound:p.view.finalRound??null,asFinal});
async function complete(a){await act(a,{type:'roundtable'});await act(a,{type:'finishVoting'});}
async function rejectDirectStart(a){
 const before=await read(a),type=before.phase==='lobby'?'start':'nextRound';
 for(const body of [{type,round:before.round},{type,round:before.round,expectedFinalRound:before.finalRound??null}]){
  const rejected=await act(a,body,400);assert.match(rejected.error,/Choose Start.*Refresh the page/);
 }
 const after=await read(a);for(const key of ['round','phase','finalRound','deadline','players','results','history'])assert.deepEqual(after[key],before[key],key);
}
let players;
try{
 players=await create('Start-choice integration');const a=players[0],first=choice(a,false);
 await rejectDirectStart(a);
 const race=await Promise.all([request(a,first),request(a,{...first,asFinal:true})]);assert.deepEqual(race.map(r=>r.status).sort(),[200,400]);await read(a);assert.equal(a.view.round,1);assert.equal(a.view.finalRound,race[1].status===200?1:null);await complete(a);
 await rejectDirectStart(a);
 const next=choice(a,true);await act(players[1],next,400);const simultaneous=await Promise.all([request(a,next),request(a,{...next,asFinal:false})]);assert.deepEqual(simultaneous.map(r=>r.status).sort(),[200,400]);await read(a);assert.equal(a.view.round,2);assert.equal(a.view.finalRound,simultaneous[0].status===200?2:null);await complete(a);
 const pending=choice(a,true);await act(a,{type:'setFinalRound',round:2,expectedFinalRound:a.view.finalRound??null,enabled:a.view.finalRound===null});await act(a,pending,400);await read(a);await act(a,choice(a,false));assert.equal(a.view.round,3);assert.equal(a.view.finalRound,null);await complete(a);
 await act(a,choice(a,true));assert.equal(a.view.finalRound,4);await complete(a);await act(a,{type:'openDispute',round:4});await act(a,choice(a,false),400);for(const p of players.slice(0,2))await act(p,{type:'disputeVote',round:4,choice:'discard'});await read(a);
 await act(a,choice(a,true));assert.equal(a.view.finalRound,5);await complete(a);
 const last=await Promise.all([request(a,{type:'finishGame',round:5}),request(a,choice(a,false))]);assert.deepEqual(last.map(r=>r.status).sort(),[200,400]);await read(a);assert.ok(a.view.phase==='ended'||a.view.phase==='playing'&&a.view.round===6&&a.view.finalRound===null);
 console.log('PASS: atomic normal/final starts, competing choices, stale stored-plan protection, non-admin rejection, disputed-final replay and finish-versus-continue race.');
}finally{if(players){await read(players[0]);if(players[0].view.phase!=='ended')await act(players[0],{type:'end'});}}
if(process.env.GAME_START_CHOICE_FIXTURE){const players=await create('Friday game');await act(players[0],choice(players[0],false));await complete(players[0]);await Promise.all(players.map(read));const {writeFile}=await import('node:fs/promises');await writeFile(process.env.GAME_START_CHOICE_FIXTURE,JSON.stringify(players,null,2));console.log('Created a separate local UI fixture after one normal round.');}
