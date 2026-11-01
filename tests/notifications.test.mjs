import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {makeGame,addPlayer,startRound,applyAction} from '../lib/game/engine.mjs';
import {advanceDueGames,deliverNotifications,nextEventAt,notificationAction,pushKeys,roundAlert,saveGame,sendPush,validateSubscription} from '../lib/notifications/server.mjs';
import {deleteExpiredGames} from '../lib/game/storage.mjs';

const now=1800000000000;
const encode=value=>Buffer.from(value).toString('base64url');
function fixture(){
  const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys = ON');
  for(const name of ['0000_spicy_nemesis','0001_invites_and_expiry','0002_bizarre_apocalypse'])sql.exec(readFileSync(new URL(`../drizzle/${name}.sql`,import.meta.url),'utf8'));
  const db={prepare(query){const statement={params:[],bind(...params){return {...statement,params};},async run(){return {meta:{changes:Number(sql.prepare(query).run(...this.params).changes)}};},async first(){return sql.prepare(query).get(...this.params)||null;},async all(){return {results:sql.prepare(query).all(...this.params)};}};return statement;},async batch(statements){sql.exec('BEGIN');try{const result=[];for(const statement of statements)result.push(await statement.run());sql.exec('COMMIT');return result;}catch(e){sql.exec('ROLLBACK');throw e;}}};
  function game(code='ABC234',at=now){const g=makeGame(code,'Notification test',{id:'p0',name:'Admin'},at);addPlayer(g,{id:'p1',name:'Player 1'});startRound(g,at,n=>n-1);g.inviteKey='private-invite-must-stay-on-device';sql.prepare('INSERT INTO games(code,state,version,expires_at,next_event_at) VALUES(?,?,0,?,?)').run(code,JSON.stringify(g),now+7*86400000,nextEventAt(g));return g;}
  return {sql,db,game,row:code=>sql.prepare('SELECT * FROM games WHERE code=?').get(code)};
}
async function browserSubscription(suffix='device'){
  const pair=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']);
  const publicKey=new Uint8Array(await crypto.subtle.exportKey('raw',pair.publicKey)),auth=crypto.getRandomValues(new Uint8Array(16));
  return {subscription:{endpoint:`https://fcm.googleapis.com/fcm/send/${suffix}`,keys:{p256dh:encode(publicKey),auth:encode(auth)}},pair,publicKey,auth};
}
async function listen(f,g,id='p0',suffix=id){const {subscription}=await browserSubscription(suffix);await notificationAction(f.db,g,{id},{type:'enableNotifications',subscription},now);return subscription;}
async function open(f,g,at=now+1000){const row=f.row(g.code);applyAction(g,g.adminId,{type:'roundtable'},at);return await saveGame(f.db,row,g,at);}
async function decrypt(body,browser){
  const bytes=new Uint8Array(body),salt=bytes.slice(0,16),server=bytes.slice(21,21+bytes[20]),cipher=bytes.slice(21+bytes[20]);
  assert.equal(new DataView(bytes.buffer,bytes.byteOffset).getUint32(16),4096);
  const publicKey=await crypto.subtle.importKey('raw',server,{name:'ECDH',namedCurve:'P-256'},false,[]);
  const shared=await crypto.subtle.deriveBits({name:'ECDH',public:publicKey},browser.pair.privateKey,256);
  const hkdf=async(input,salt,info,bits)=>crypto.subtle.deriveBits({name:'HKDF',hash:'SHA-256',salt,info},await crypto.subtle.importKey('raw',input,'HKDF',false,['deriveBits']),bits);
  const info=Buffer.concat([Buffer.from('WebPush: info\0'),browser.publicKey,server]),ikm=await hkdf(shared,browser.auth,info,256);
  const key=await crypto.subtle.importKey('raw',await hkdf(ikm,salt,Buffer.from('Content-Encoding: aes128gcm\0'),128),'AES-GCM',false,['decrypt']);
  const nonce=await hkdf(ikm,salt,Buffer.from('Content-Encoding: nonce\0'),96),plain=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:nonce},key,cipher));
  let end=plain.length-1;while(plain[end]===0)end--;assert.equal(plain[end],2);return JSON.parse(new TextDecoder().decode(plain.slice(0,end)));
}
test('Web Push encrypts a generic alert and signs the correct push-service audience',async()=>{
  const f=fixture(),g=f.game(),browser=await browserSubscription(),keys=await pushKeys(f.db);let request;
  const status=await sendPush(browser.subscription,roundAlert(g,1),keys,async(url,options)=>{request={url,options};return new Response(null,{status:201});});
  assert.equal(status,201);assert.equal(request.url,browser.subscription.endpoint);assert.equal(request.options.redirect,'manual');assert.equal(request.options.headers['content-encoding'],'aes128gcm');
  const data=await decrypt(request.options.body,browser);assert.equal(data.title,'Court is in session');assert.equal(data.url,'/');
  for(const secret of [g.inviteKey,'Admin','Player 1','traitor','faithful','token','loginHash'])assert.ok(!JSON.stringify(data).includes(secret));
  const jwt=request.options.headers.authorization.match(/^vapid t=([^,]+), k=/)[1].split('.'),claims=JSON.parse(Buffer.from(jwt[1],'base64url'));
  assert.equal(claims.aud,'https://fcm.googleapis.com');assert.equal(claims.sub,'https://in-plain-sight.plain-sight-games.workers.dev');
  const publicKey=await crypto.subtle.importKey('raw',Buffer.from(keys.publicKey,'base64url'),{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
  assert.equal(await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},publicKey,Buffer.from(jwt[2],'base64url'),Buffer.from(jwt.slice(0,2).join('.'))),true);
  assert.deepEqual(await pushKeys(f.db),keys);f.sql.close();
});
test('subscription validation rejects arbitrary hosts, lookalikes, redirects and invalid keys',async()=>{
  const {subscription}=await browserSubscription();assert.equal((await validateSubscription(subscription)).endpoint,subscription.endpoint);
  for(const endpoint of ['http://fcm.googleapis.com/path','https://localhost/path','https://127.0.0.1/path','https://fcm.googleapis.com.evil.test/path','https://user@fcm.googleapis.com/path','https://fcm.googleapis.com:444/path','https://fcm.googleapis.com/path#fragment'])await assert.rejects(validateSubscription({...subscription,endpoint}));
  await assert.rejects(validateSubscription({...subscription,keys:{...subscription.keys,auth:'bad'}}));
  await assert.rejects(validateSubscription({...subscription,keys:{...subscription.keys,p256dh:encode(new Uint8Array(65))}}));
});
test('an early roundtable queues once, delivers once and ignores repeated phase checks',async()=>{
  const f=fixture(),g=f.game();await listen(f,g);const opened=await open(f,g);assert.equal(opened.notify,true);assert.equal(f.sql.prepare('SELECT count(*) AS n FROM push_events').get().n,1);
  let calls=0;const send=async()=>{calls++;return new Response(null,{status:201});};
  await deliverNotifications(f.db,now+2000,send);await deliverNotifications(f.db,now+3000,send);await saveGame(f.db,f.row(g.code),g,now+4000);await deliverNotifications(f.db,now+5000,send);
  assert.equal(calls,1);assert.equal(f.sql.prepare('SELECT notification_round FROM games').get().notification_round,1);f.sql.close();
});
test('timer opens voting without an open client; pause and resume move the deadline correctly',async()=>{
  const f=fixture(),g=f.game(),deadline=g.deadline;await listen(f,g);
  await advanceDueGames(f.db,deadline-1);assert.equal(JSON.parse(f.row(g.code).state).phase,'playing');
  const row=f.row(g.code);applyAction(g,g.adminId,{type:'pause'},now+1000);await saveGame(f.db,row,g,now+1000);
  assert.equal(f.row(g.code).next_event_at,null);await advanceDueGames(f.db,deadline+1000);assert.equal(JSON.parse(f.row(g.code).state).phase,'playing');
  const paused=f.row(g.code);applyAction(g,g.adminId,{type:'resume'},deadline+1000);await saveGame(f.db,paused,g,deadline+1000);
  await advanceDueGames(f.db,g.deadline);assert.equal(JSON.parse(f.row(g.code).state).phase,'voting');assert.equal(f.sql.prepare('SELECT count(*) AS n FROM push_events').get().n,1);f.sql.close();
});
test('failed optimistic updates cannot publish an uncommitted notification',async()=>{
  const f=fixture(),g=f.game(),stale=f.row(g.code);f.sql.prepare('UPDATE games SET version=1').run();applyAction(g,g.adminId,{type:'roundtable'},now+1000);
  assert.equal((await saveGame(f.db,stale,g,now+1000)).changed,false);assert.equal(f.sql.prepare('SELECT count(*) AS n FROM push_events').get().n,0);f.sql.close();
});
test('games and players are isolated; switching the device prevents the old player from receiving alerts',async()=>{
  const f=fixture(),a=f.game('ABC234'),b=f.game('XYZ234'),sub=await listen(f,a,'p0','shared');
  assert.equal((await notificationAction(f.db,b,{id:'p0'},{type:'notificationStatus',endpoint:sub.endpoint},now)).enabled,false);
  await notificationAction(f.db,b,{id:'p0'},{type:'disableNotifications',endpoint:sub.endpoint},now);
  assert.equal(f.sql.prepare('SELECT game_code FROM push_subscriptions').get().game_code,a.code);
  await notificationAction(f.db,a,{id:'p1'},{type:'enableNotifications',subscription:sub},now+1);
  await notificationAction(f.db,a,{id:'p0'},{type:'disableNotifications',endpoint:sub.endpoint},now+2);
  assert.equal(f.sql.prepare('SELECT player_id FROM push_subscriptions').get().player_id,'p1');
  await open(f,b);let calls=0;await deliverNotifications(f.db,now+2000,async()=>{calls++;return new Response(null,{status:201});});assert.equal(calls,0);
  await open(f,a);await deliverNotifications(f.db,now+3000,async()=>{calls++;return new Response(null,{status:201});});assert.equal(calls,1);f.sql.close();
});
test('finished rounds, already-submitted players and mid-round arrivals do not receive stale voting alerts',async()=>{
  const f=fixture(),g=f.game();await listen(f,g,'p0');addPlayer(g,{id:'late',name:'Late'});await listen(f,g,'late');await open(f,g);
  const row=f.row(g.code);applyAction(g,'p0',{type:'ballot',target:'p1',...(g.roles.p0==='traitor'?{performed:true}:{suspectedAttempt:false})},now+1000);await saveGame(f.db,row,g,now+1000);
  let calls=0;await deliverNotifications(f.db,now+2000,async()=>{calls++;return new Response(null,{status:201});});assert.equal(calls,0);
  f.sql.close();
  const second=fixture(),ended=second.game();await listen(second,ended);await open(second,ended);const previous=second.row(ended.code);applyAction(ended,'p0',{type:'end'},now+1000);await saveGame(second.db,previous,ended,now+1000);
  await deliverNotifications(second.db,now+2000,async()=>{calls++;return new Response(null,{status:201});});assert.equal(calls,0);second.sql.close();
});
test('transient delivery failures retry; expired subscriptions are removed and concurrent dispatchers cannot duplicate sends',async()=>{
  const f=fixture(),g=f.game();await listen(f,g);await open(f,g);let calls=0;
  const failed=async()=>{calls++;return new Response(null,{status:503});};await deliverNotifications(f.db,now+2000,failed);await deliverNotifications(f.db,now+3000,failed);assert.equal(calls,1);
  await Promise.all([deliverNotifications(f.db,now+62000,async()=>{calls++;return new Response(null,{status:410});}),deliverNotifications(f.db,now+62000,failed)]);
  assert.equal(calls,2);assert.equal(f.sql.prepare('SELECT count(*) AS n FROM push_subscriptions').get().n,0);f.sql.close();
});
test('expiry deletes notification subscriptions and queued events with the game',async()=>{
  const f=fixture(),g=f.game();await listen(f,g);await open(f,g);await pushKeys(f.db);await deleteExpiredGames(f.db,now+7*86400000);
  for(const table of ['games','push_subscriptions','push_events'])assert.equal(f.sql.prepare(`SELECT count(*) AS n FROM ${table}`).get().n,0);
  assert.equal(f.sql.prepare('SELECT count(*) AS n FROM push_config').get().n,1);f.sql.close();
});
test('migration backfills saved deadlines and does not create retroactive alerts for an existing vote',()=>{
  const sql=new DatabaseSync(':memory:');for(const name of ['0000_spicy_nemesis','0001_invites_and_expiry'])sql.exec(readFileSync(new URL(`../drizzle/${name}.sql`,import.meta.url),'utf8'));
  const insert=sql.prepare('INSERT INTO games(code,state,expires_at) VALUES(?,?,?)');
  insert.run('ABC234',JSON.stringify({phase:'playing',round:2,pausedAt:null,deadline:1234}),now+9999);insert.run('XYZ234',JSON.stringify({phase:'voting',round:7,pausedAt:null,voteDeadline:null}),now+9999);
  sql.exec(readFileSync(new URL('../drizzle/0002_bizarre_apocalypse.sql',import.meta.url),'utf8'));
  assert.equal(sql.prepare('SELECT next_event_at FROM games WHERE code=?').get('ABC234').next_event_at,1234);assert.equal(sql.prepare('SELECT notification_round FROM games WHERE code=?').get('XYZ234').notification_round,7);sql.close();
});
test('a test push is private to the subscriber and is rate limited for thirty seconds',async()=>{
  const f=fixture(),g=f.game(),sub=await listen(f,g);let calls=0;const body={type:'testNotification',endpoint:sub.endpoint},send=async()=>{calls++;return new Response(null,{status:201});};
  await assert.rejects(notificationAction(f.db,g,{id:'p1'},body,now,send));assert.equal(calls,0);
  assert.equal((await notificationAction(f.db,g,{id:'p0'},body,now,send)).sent,true);
  await assert.rejects(notificationAction(f.db,g,{id:'p0'},body,now+29999,send));assert.equal(calls,1);
  await notificationAction(f.db,g,{id:'p0'},body,now+30000,send);assert.equal(calls,2);f.sql.close();
});
test('enabling during a vote does not replay it; the following round still alerts',async()=>{
  const f=fixture(),g=f.game();await open(f,g);await listen(f,g);let calls=0;const send=async()=>{calls++;return new Response(null,{status:201});};
  await deliverNotifications(f.db,now+2000,send);assert.equal(calls,0);
  let row=f.row(g.code);applyAction(g,'p0',{type:'finishVoting'},now+3000);await saveGame(f.db,row,g,now+3000);
  row=f.row(g.code);applyAction(g,'p0',{type:'nextRound',round:g.round,expectedFinalRound:g.finalRound??null,asFinal:false},now+4000,n=>n-1);await saveGame(f.db,row,g,now+4000);
  await open(f,g,now+5000);await deliverNotifications(f.db,now+6000,send);assert.equal(calls,1);f.sql.close();
});
test('a paused roundtable waits for resume before sending and no longer waits after resume',async()=>{
  const f=fixture(),g=f.game();await listen(f,g);await open(f,g);let row=f.row(g.code);applyAction(g,'p0',{type:'pause'},now+1500);await saveGame(f.db,row,g,now+1500);
  let calls=0;const send=async()=>{calls++;return new Response(null,{status:201});};await deliverNotifications(f.db,now+2000,send);assert.equal(calls,0);
  row=f.row(g.code);applyAction(g,'p0',{type:'resume'},now+3000);await saveGame(f.db,row,g,now+3000);await deliverNotifications(f.db,now+62000,send);assert.equal(calls,1);f.sql.close();
});
test('two games reaching their timer together each alert only their own subscription',async()=>{
  const f=fixture(),a=f.game('ABC234'),b=f.game('XYZ234'),sa=await listen(f,a,'p0','game-a'),sb=await listen(f,b,'p0','game-b');
  await advanceDueGames(f.db,a.deadline);const urls=[];await deliverNotifications(f.db,a.deadline+1000,async url=>{urls.push(url);return new Response(null,{status:201});});
  assert.deepEqual(urls.sort(),[sa.endpoint,sb.endpoint].sort());assert.equal(JSON.parse(f.row(a.code).state).phase,'voting');assert.equal(JSON.parse(f.row(b.code).state).phase,'voting');f.sql.close();
});
test('test delivery failures show a useful message without exposing runtime details',async()=>{
  const f=fixture(),g=f.game(),sub=await listen(f,g);
  await assert.rejects(notificationAction(f.db,g,{id:'p0'},{type:'testNotification',endpoint:sub.endpoint},now,async()=>{throw new Error('Private runtime detail');}),error=>error.message==='The test could not be delivered. Check your connection and try again.');f.sql.close();
});

test('a dispute deadline settles and reverses points with every client closed, without a Court alert',async()=>{
  const f=fixture(),g=f.game();await open(f,g);let row=f.row(g.code);
  applyAction(g,'p0',{type:'finishVoting'},now+2000);await saveGame(f.db,row,g,now+2000);
  const original=g.players.map(p=>p.score);assert.deepEqual(original,[-2,-2]);
  row=f.row(g.code);applyAction(g,'p0',{type:'openDispute',round:1},now+3000);applyAction(g,'p0',{type:'disputeVote',round:1,choice:'discard'},now+4000);applyAction(g,'p1',{type:'disputeVote',round:1,choice:'keep'},now+4001);await saveGame(f.db,row,g,now+4001);
  // Both ballots already settle this tie. Neither a new Court event nor a
  // repeated scheduled invocation can reverse those points a second time.
  await advanceDueGames(f.db,now+200000);const saved=JSON.parse(f.row(g.code).state);assert.deepEqual(saved.players.map(p=>p.score),[0,0]);assert.equal(saved.results.review.adminTieBreak,'discard');assert.equal(f.row(g.code).next_event_at,null);assert.equal(f.sql.prepare('SELECT count(*) AS n FROM push_events').get().n,1);f.sql.close();
  const timed=fixture(),h=timed.game();addPlayer(h,{id:'p2',name:'Third'});addPlayer(h,{id:'p3',name:'Fourth'});addPlayer(h,{id:'p4',name:'Fifth'});
  // Start a fresh five-player round, with no real sleeping or clock patching.
  applyAction(h,'p0',{type:'roundtable'},now+1000);applyAction(h,'p0',{type:'finishVoting'},now+2000);applyAction(h,'p0',{type:'nextRound',round:1,expectedFinalRound:h.finalRound??null,asFinal:false},now+3000,n=>n-1);applyAction(h,'p0',{type:'roundtable'},now+4000);applyAction(h,'p0',{type:'finishVoting'},now+5000);
  applyAction(h,'p0',{type:'openDispute',round:2},now+6000);for(let i=0;i<4;i++)applyAction(h,`p${i}`,{type:'disputeVote',round:2,choice:i%2?'keep':'discard'},now+7000);
  await saveGame(timed.db,timed.row(h.code),h,now+7000);assert.equal(timed.row(h.code).next_event_at,h.dispute.deadline);
  await advanceDueGames(timed.db,h.dispute.deadline-1);assert.equal(JSON.parse(timed.row(h.code).state).dispute.status,'open');
  await advanceDueGames(timed.db,h.dispute.deadline);const ended=JSON.parse(timed.row(h.code).state);assert.equal(ended.dispute.status,'discarded');assert.deepEqual(ended.players.map(p=>p.score),[-2,-2,0,0,0]);assert.equal(timed.row(h.code).next_event_at,null);
  const stable=timed.row(h.code).state;await advanceDueGames(timed.db,h.dispute.deadline+60000);assert.equal(timed.row(h.code).state,stable);timed.sql.close();
});
