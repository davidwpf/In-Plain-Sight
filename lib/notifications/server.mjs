import {buildPushPayload} from '@block65/webcrypto-web-push';
import {hashSecret} from '../game/storage.mjs';
import {tick} from '../game/engine.mjs';

export const NOTIFICATION_CRON='* * * * *';
export const PUSH_SUBJECT='https://in-plain-sight.plain-sight-games.workers.dev';
const MAX_PUSHES=30,EVENT_LIFETIME=10*60*1000;
const b64=bytes=>btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
export function decodeKey(value,length){
  if(typeof value!=='string'||!/^[A-Za-z0-9_-]+={0,2}$/.test(value))throw new Error('Invalid notification subscription.');
  const bytes=Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
  if(bytes.length!==length)throw new Error('Invalid notification subscription.');return bytes;
}
export async function validateSubscription(value){
  if(!value||typeof value.endpoint!=='string'||value.endpoint.length>2048)throw new Error('Invalid notification subscription.');
  const url=new URL(value.endpoint),host=url.hostname;
  // Client endpoints must not turn this into an arbitrary URL fetcher.
  const allowed=host==='fcm.googleapis.com'||host==='updates.push.services.mozilla.com'||host==='push.services.mozilla.com'||host==='web.push.apple.com'||/^[a-z0-9-]+\.notify\.windows\.com$/.test(host);
  if(url.protocol!=='https:'||url.port||url.username||url.password||url.hash||!allowed)throw new Error('This browser’s notification service is not supported. Try Safari, Chrome, Firefox or Edge.');
  const publicKey=decodeKey(value.keys?.p256dh,65);decodeKey(value.keys?.auth,16);
  if(publicKey[0]!==4)throw new Error('Invalid notification subscription.');
  await crypto.subtle.importKey('raw',publicKey,{name:'ECDH',namedCurve:'P-256'},false,[]);
  return {endpoint:url.href,expirationTime:null,keys:{p256dh:value.keys.p256dh,auth:value.keys.auth}};
}
export async function pushKeys(database){
  let row=await database.prepare('SELECT public_key, private_key FROM push_config WHERE id = 1').first();
  if(!row){
    const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
    const publicKey=b64(new Uint8Array(await crypto.subtle.exportKey('raw',pair.publicKey))),privateKey=(await crypto.subtle.exportKey('jwk',pair.privateKey)).d;
    // One server-only identity survives redeployments. Its private key never
    // enters an API response, game state, client bundle or source control.
    await database.prepare('INSERT OR IGNORE INTO push_config(id, public_key, private_key) VALUES (1, ?, ?)').bind(publicKey,privateKey).run();
    row=await database.prepare('SELECT public_key, private_key FROM push_config WHERE id = 1').first();
  }
  return {publicKey:row.public_key,privateKey:row.private_key,subject:PUSH_SUBJECT};
}
export function nextEventAt(g){return g.pausedAt!==null?null:g.phase==='playing'?g.deadline:g.phase==='voting'?g.voteDeadline:null;}
export async function saveGame(database,row,g,now=Date.now()){
  const state=JSON.stringify(g),notify=g.phase==='voting'&&g.round>(row.notification_round??0);
  const statements=[database.prepare('UPDATE games SET state = ?, version = version + 1, next_event_at = ?, notification_round = ? WHERE code = ? AND version = ? AND expires_at > ?').bind(state,nextEventAt(g),notify?g.round:(row.notification_round??0),row.code,row.version,now)];
  if(notify)statements.push(database.prepare('INSERT OR IGNORE INTO push_events(game_code, round, created_at, next_attempt_at) SELECT code, ?, ?, ? FROM games WHERE code = ? AND version = ? AND state = ? AND expires_at > ?').bind(g.round,now,now,row.code,row.version+1,state,now));
  const results=await database.batch(statements);
  return {changed:results[0].meta.changes===1,notify:notify&&results[0].meta.changes===1};
}
export async function advanceDueGames(database,now=Date.now()){
  const {results}=await database.prepare('SELECT code, state, version, expires_at, notification_round FROM games WHERE next_event_at <= ? AND expires_at > ? ORDER BY next_event_at LIMIT 10').bind(now,now).all();
  for(const row of results){if(row.expires_at<=now)continue;const g=JSON.parse(row.state);if(g.schemaVersion!==2)continue;tick(g,now);await saveGame(database,row,g,now);}
}
export function roundAlert(g,round){return {type:'roundtable',game:g.code,round,title:'Roundtable is open',body:'The round has ended. Open In Plain Sight to vote.',url:'/',tag:`roundtable-${g.code}-${round}`};}
export async function sendPush(subscription,data,keys,send=fetch){
  const payload=await buildPushPayload({data,options:{ttl:300,urgency:'high'}},subscription,keys);
  // Workers supports manual/follow, not the browser's "error" redirect mode.
  // Manual leaves every 3xx unsuccessful and never contacts its destination.
  const response=await send(subscription.endpoint,{...payload,redirect:'manual',signal:AbortSignal.timeout(3000)});
  await response.body?.cancel();return response.status;
}
export async function deliverNotifications(database,now=Date.now(),send=fetch){
  const {results:events}=await database.prepare('SELECT game_code, round, created_at FROM push_events WHERE next_attempt_at <= ? AND locked_until <= ? ORDER BY next_attempt_at LIMIT 3').bind(now,now).all();
  if(!events.length)return {sent:0};
  const keys=await pushKeys(database);let remaining=MAX_PUSHES,sent=0;
  for(const event of events){
    if(!remaining)break;
    const claim=await database.prepare('UPDATE push_events SET locked_until = ? WHERE game_code = ? AND round = ? AND locked_until <= ?').bind(now+60000,event.game_code,event.round,now).run();
    if(claim.meta.changes!==1)continue;
    const row=await database.prepare('SELECT state, expires_at FROM games WHERE code = ?').bind(event.game_code).first();
    const g=row?JSON.parse(row.state):null;
    if(!g||row.expires_at<=now||g.phase!=='voting'||g.round!==event.round||now-event.created_at>EVENT_LIFETIME){await database.prepare('DELETE FROM push_events WHERE game_code = ? AND round = ?').bind(event.game_code,event.round).run();continue;}
    if(g.pausedAt!==null){await database.prepare('UPDATE push_events SET locked_until = 0, next_attempt_at = ? WHERE game_code = ? AND round = ?').bind(now+60000,event.game_code,event.round).run();continue;}
    const {results:subscriptions}=await database.prepare('SELECT * FROM push_subscriptions WHERE game_code = ? AND last_round < ? ORDER BY updated_at LIMIT ?').bind(g.code,event.round,remaining).all();
    remaining-=subscriptions.length;const writes=[];
    // Five connections and thirty external requests leave Free-plan headroom.
    for(let i=0;i<subscriptions.length;i+=5){
      await Promise.all(subscriptions.slice(i,i+5).map(async sub=>{
        let status=204;
        if(g.active.includes(sub.player_id)&&!g.ballots[sub.player_id]){
          try{status=await sendPush(JSON.parse(sub.subscription),roundAlert(g,event.round),keys,send);}catch{status=503;}
        }
        if(status===404||status===410)writes.push(database.prepare('DELETE FROM push_subscriptions WHERE endpoint_hash = ? AND game_code = ? AND player_id = ?').bind(sub.endpoint_hash,g.code,sub.player_id));
        else if(status>=200&&status<300){sent++;writes.push(database.prepare('UPDATE push_subscriptions SET last_round = MAX(last_round, ?) WHERE endpoint_hash = ? AND game_code = ? AND player_id = ?').bind(event.round,sub.endpoint_hash,g.code,sub.player_id));}
      }));
    }
    if(writes.length)await database.batch(writes);
    const pending=await database.prepare('SELECT endpoint_hash FROM push_subscriptions WHERE game_code = ? AND last_round < ? LIMIT 1').bind(g.code,event.round).first();
    if(pending)await database.prepare('UPDATE push_events SET locked_until = 0, next_attempt_at = ? WHERE game_code = ? AND round = ?').bind(now+60000,g.code,event.round).run();
    else await database.prepare('DELETE FROM push_events WHERE game_code = ? AND round = ?').bind(g.code,event.round).run();
  }
  return {sent};
}
export async function notificationAction(database,g,p,body,now=Date.now(),send=fetch){
  const endpoint=body.subscription?.endpoint??body.endpoint;
  if(typeof endpoint!=='string'||endpoint.length>2048)throw new Error('Invalid notification subscription.');
  const digest=await hashSecret(endpoint);
  if(body.type==='notificationStatus'){
    const sub=await database.prepare('SELECT endpoint_hash FROM push_subscriptions WHERE endpoint_hash = ? AND game_code = ? AND player_id = ?').bind(digest,g.code,p.id).first();return {enabled:!!sub};
  }
  if(body.type==='disableNotifications'){
    await database.prepare('DELETE FROM push_subscriptions WHERE endpoint_hash = ? AND game_code = ? AND player_id = ?').bind(digest,g.code,p.id).run();return {enabled:false};
  }
  if(g.phase==='ended')throw new Error('This game has ended.');
  if(body.type==='enableNotifications'){
    const subscription=await validateSubscription(body.subscription);
    await database.batch([database.prepare('INSERT INTO push_subscriptions(endpoint_hash, game_code, player_id, subscription, last_round, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(endpoint_hash) DO UPDATE SET game_code = excluded.game_code, player_id = excluded.player_id, subscription = excluded.subscription, last_round = excluded.last_round, updated_at = excluded.updated_at').bind(digest,g.code,p.id,JSON.stringify(subscription),g.phase==='playing'?g.round-1:g.round,now),database.prepare('DELETE FROM push_subscriptions WHERE game_code = ? AND player_id = ? AND endpoint_hash NOT IN (SELECT endpoint_hash FROM push_subscriptions WHERE game_code = ? AND player_id = ? ORDER BY updated_at DESC LIMIT 3)').bind(g.code,p.id,g.code,p.id)]);return {enabled:true};
  }
  if(body.type==='testNotification'){
    const row=await database.prepare('SELECT subscription FROM push_subscriptions WHERE endpoint_hash = ? AND game_code = ? AND player_id = ? AND last_test_at <= ?').bind(digest,g.code,p.id,now-30000).first();
    if(!row)throw new Error('Enable notifications first, or wait 30 seconds before another test.');
    const claim=await database.prepare('UPDATE push_subscriptions SET last_test_at = ? WHERE endpoint_hash = ? AND game_code = ? AND player_id = ? AND last_test_at <= ?').bind(now,digest,g.code,p.id,now-30000).run();
    if(claim.meta.changes!==1)throw new Error('Wait 30 seconds before another test.');
    let status;try{status=await sendPush(JSON.parse(row.subscription),{type:'test',title:'Notifications are working',body:'You’ll be notified when the roundtable opens.',url:'/',tag:'in-plain-sight-test'},await pushKeys(database),send);}catch{throw new Error('The test could not be delivered. Check your connection and try again.');}
    if(status===404||status===410)await database.prepare('DELETE FROM push_subscriptions WHERE endpoint_hash = ? AND game_code = ? AND player_id = ?').bind(digest,g.code,p.id).run();
    if(status<200||status>=300)throw new Error('The test could not be delivered. Try turning notifications off and on again.');
    return {sent:true};
  }
  throw new Error('Unknown notification action.');
}
