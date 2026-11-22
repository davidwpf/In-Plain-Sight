import assert from 'node:assert/strict';
const base=new URL(process.env.GAME_TEST_ORIGIN||'http://127.0.0.1:5173');
if(!['localhost','127.0.0.1','[::1]'].includes(base.hostname))throw Error('This test only uses local disposable games.');
const origin=base.origin,groups=[];
async function request(player,body){const r=await fetch(origin+'/api/game'+(body?'':'?code='+player.view.code),{method:body?'POST':'GET',headers:{'Content-Type':'application/json',Origin:origin,...(player?{Authorization:'Bearer '+player.token}:{})},...(body?{body:JSON.stringify({code:player?.view.code,...body})}:{})});return {status:r.status,data:await r.json()};}
async function act(player,body,status=200){const r=await request(player,body);assert.equal(r.status,status,JSON.stringify(r.data));if(status===200&&player)player.view=r.data;return r.data;}
async function read(player){const r=await request(player);assert.equal(r.status,200,JSON.stringify(r.data));player.view=r.data;return r.data;}
async function create(name='Alex Smith',pin='0123'){const r=await request(null,{type:'create',name,gameName:'Same game name',...(pin===undefined?{}:{passcode:pin})});assert.equal(r.status,201,JSON.stringify(r.data));const players=[r.data];groups.push(players);return players;}
async function join(players,name,pin){const r=await request(players[0],{type:'join',access:'code',name,passcode:pin});assert.equal(r.status,200,JSON.stringify(r.data));players.push(r.data);return r.data;}
async function signIn(player,name=player.view.me.name,pin=player.passcode){const r=await request(player,{type:'login',access:'code',name,passcode:pin});assert.equal(r.status,200,JSON.stringify(r.data));assert.equal(r.data.view.me.id,player.view.me.id);player.token=r.data.token;player.view=r.data.view;return r.data;}
async function preview(code){const r=await fetch(origin+'/api/game?'+new URLSearchParams({preview:'1',access:'code',code}));return {status:r.status,data:await r.json()};}
try{
 for(const passcode of ['123','12345','123456','12ab',1234,null])assert.equal((await request(null,{type:'create',name:'Invalid',gameName:'Invalid',passcode})).status,400);
 const players=await create(),a=players[0];assert.equal(a.passcode,'0123');assert.ok(a.view.me.isAdmin);
 const found=await preview(a.view.code.toLowerCase());assert.equal(found.status,200);assert.equal(found.data.name,a.view.name);assert.deepEqual(Object.keys(found.data).sort(),['code','expiresAt','name']);
 await join(players,'Ben','0123');await join(players,'Charlie','0123');await join(players,'Isla','9999');await join(players,'Jamie','0000');await join(players,'Ｋate','4567');
 assert.equal((await request(a,{type:'join',access:'code',name:'  aLeX   sMiTh ',passcode:'4321'})).status,400);
 assert.equal((await request(a,{type:'join',access:'code',name:'Kate',passcode:'4321'})).status,400);
 assert.equal((await request(a,{type:'join',access:'code',name:'Bad pin',passcode:'12345'})).status,400);
 for(const p of players)await signIn(p,p===a?' ALEX   SMITH ':p.view.me.name.toLowerCase());
 assert.equal((await signIn(players[5],'kate')).view.me.name,'Ｋate');
 for(const [name,pin] of [['Nobody','0123'],['','0123'],['Alex Smith','0124'],['Ben','9999']]){assert.equal((await request(a,{type:'login',access:'code',name,passcode:pin})).status,401);await signIn(a);}
 const otherPlayers=await create(),other=otherPlayers[0];assert.notEqual(other.view.code,a.view.code);assert.equal(other.passcode,a.passcode);
 assert.equal((await request({...a,view:{...a.view,code:other.view.code}})).status,401);
 assert.equal((await request(a,{type:'login',access:'code',invite:other.view.inviteKey,name:a.view.me.name,passcode:a.passcode})).status,404);
 assert.equal((await request(a,{type:'join',access:'code',invite:other.view.inviteKey,name:'Wrong invite',passcode:'1234'})).status,404);
 const obsolete=a.token;for(let i=0;i<6;i++)await signIn(a);assert.equal((await request({...a,token:obsolete})).status,401);await signIn(a);assert.equal((await request(a)).status,200);
 await act(a,{type:'start',round:0,expectedFinalRound:null,asFinal:false});await Promise.all(players.map(read));
 const team=players.filter(p=>p.view.secret.role==='traitor'),victim=players.find(p=>p.view.secret.role==='faithful');
 for(const p of players){assert.equal(p.view.secret.mostLikely.question.id,a.view.secret.mostLikely.question.id);for(const row of p.view.players){assert.equal(row.loginVersion,undefined);assert.equal(row.loginHash,undefined);assert.equal(row.passcode,undefined);}}
 const killer=team[0];await act(killer,{type:'mostLikelyAnswer',round:1,questionId:killer.view.secret.mostLikely.question.id,target:victim.view.me.id});
 const before=structuredClone(killer.view.secret);await signIn(killer);assert.deepEqual(killer.view.secret,before);
 await act(a,{type:'roundtable'});await Promise.all(players.map(read));
 const first=players[1];await act(first,{type:'ballot',target:first.view.secret.role==='traitor'?victim.view.me.id:team[0].view.me.id,...(first.view.secret.role==='traitor'?{performed:true}:{suspectedAttempt:first===victim})});
 const locked=structuredClone(first.view.myBallot);await signIn(first);assert.deepEqual(first.view.myBallot,locked);
 for(const p of players.filter(p=>p!==first))await act(p,{type:'ballot',target:p.view.secret.role==='traitor'?victim.view.me.id:team[0].view.me.id,...(p.view.secret.role==='traitor'?{performed:true}:{suspectedAttempt:p===victim})});
 await read(a);assert.equal(a.view.phase,'results');assert.equal(a.view.results.mostLikely.winners[0].id,victim.view.me.id);
 const result=structuredClone(a.view.results);await signIn(a);assert.deepEqual(a.view.results,result);
 const legacyResult=await request(null,{type:'create',name:'Legacy admin',gameName:'Old client'});assert.equal(legacyResult.status,201);const legacy=legacyResult.data;groups.push([legacy]);assert.match(legacy.passcode,/^\d{6}$/);
 const old=await request(legacy,{type:'login',invite:legacy.view.inviteKey,passcode:legacy.passcode});assert.equal(old.status,200);assert.equal(old.data.view.me.id,legacy.view.me.id);legacy.token=old.data.token;
 assert.equal((await request(legacy,{type:'login',access:'code',name:'Somebody else',passcode:legacy.passcode})).status,401);await signIn(legacy);
 const mixed=await request(legacy,{type:'join',access:'code',name:'New player',passcode:'0123'});assert.equal(mixed.status,200);assert.equal(mixed.data.passcode,'0123');await signIn(mixed.data);
 const limitPlayers=await create('Rate limit','5678'),limited=limitPlayers[0];
 for(let i=0;i<8;i++)assert.equal((await request(limited,{type:'login',access:'code',name:'Rate limit',passcode:'0000'})).status,401);
 assert.equal((await request(limited,{type:'login',access:'code',name:'Rate limit',passcode:'5678'})).status,429);await signIn(other);
 assert.equal((await read(limited)).me.isAdmin,true);
 console.log('PASS: chosen four-digit codes including leading zeros and duplicate codes, name normalisation and uniqueness, code-only game discovery, wrong-invite rejection, private authentication, cross-game isolation, stale-token renewal credentials, legacy six-digit compatibility, mixed accounts, gameplay persistence, immutable questions and Court ballots, and throttled failed logins.');
}finally{
 for(const players of groups){try{const a=players[0];await read(a);if(a.view.phase!=='ended')await act(a,{type:'end'});}catch(e){process.exitCode=1;console.error('Disposable game cleanup failed:',e.message);}}
}
