import test from 'node:test';
import assert from 'node:assert/strict';
import {TAB_SESSION_KEY,DEVICE_SESSION_KEY,readPlayerSession,rememberPlayerSession,forgetPlayerSession,rememberedPlayerForGame,samePlayerSession} from '../lib/game/sessions.mjs';
const now=1_000_000;
function storage(){const data=new Map();return {getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key)};}
const session=(patch={})=>({code:'ABC234',token:'private-token-alex',passcode:'012345',playerId:'alex',gameName:'Evening game',inviteKey:'a'.repeat(64),expiresAt:now+700_000,...patch});
const stores=()=>({tab:storage(),remembered:storage()});
const save=(s,where)=>rememberPlayerSession(s,where,now);
const read=(where,query={})=>readPlayerSession(where,query,now);

test('a closed tab can reopen its game and sign in from device storage',()=>{
 const where=stores(),s=session();assert.deepEqual(save(s,where),{tabSaved:true,deviceSaved:true});where.tab=storage();
 assert.deepEqual(read(where,{inviteKey:s.inviteKey}),{...s,storageVersion:3});
 assert.equal(read(where).playerId,s.playerId);assert.equal(JSON.parse(where.tab.getItem(TAB_SESSION_KEY)).token,s.token);
});
test('remembering a player stores only sign-in details, never a revealed role or ballot',()=>{
 const where=stores();save({...session(),role:'traitor',secret:{mission:'private task'},revealed:true,ballot:{target:'Ben'},results:{score:4}},where);
 for(const target of [where.tab.getItem(TAB_SESSION_KEY),where.remembered.getItem(DEVICE_SESSION_KEY)])for(const key of ['traitor','private task','revealed','ballot','results'])assert.ok(!target.includes(key));
});
test('existing tab-only sign-ins migrate without changing their code or token',()=>{
 const where=stores(),old=session();delete old.expiresAt;delete old.playerId;where.tab.setItem(TAB_SESSION_KEY,JSON.stringify(old));
 assert.equal(read(where).passcode,old.passcode);where.tab=storage();assert.equal(read(where,{inviteKey:old.inviteKey}).token,old.token);
});
test('a shared device does not restore the previous player after a deliberate switch',()=>{
 const where=stores(),s=session();save(s,where);const legacy=JSON.stringify(s);
 forgetPlayerSession(s,where,{},now);assert.equal(where.tab.getItem(TAB_SESSION_KEY),null);assert.equal(read(where,{inviteKey:s.inviteKey}),null);
 where.tab.setItem(TAB_SESSION_KEY,legacy);assert.equal(read(where,{inviteKey:s.inviteKey}),null);
 const remembered=where.remembered.getItem(DEVICE_SESSION_KEY);for(const value of [s.token,s.passcode,s.playerId])assert.ok(!remembered.includes(value));
});
test('remembered games and tab identities remain isolated even when names are identical',()=>{
 const where=stores(),a=session(),b=session({code:'DEF567',token:'token-ben',passcode:'654321',playerId:'ben',inviteKey:'b'.repeat(64)});save(a,where);const tabA=where.tab;where.tab=storage();save(b,where);
 assert.equal(read({...where,tab:storage()}).code,b.code);assert.equal(read({...where,tab:tabA}).code,a.code);assert.equal(read({...where,tab:storage()}).code,a.code);
 assert.equal(read({...where,tab:storage()},{inviteKey:a.inviteKey}).token,a.token);
 assert.equal(read({...where,tab:storage()},{inviteKey:'c'.repeat(64)}),null);
 assert.equal(read({...where,tab:storage()},{code:'abc234'}).playerId,a.playerId);
});
test('switching one game leaves sign-ins for other games available',()=>{
 const where=stores(),a=session(),b=session({code:'DEF567',inviteKey:'b'.repeat(64)});save(a,where);save(b,where);forgetPlayerSession(b,where,{},now);
 assert.equal(read(where),null);assert.equal(read(where,{inviteKey:a.inviteKey}).code,a.code);assert.equal(rememberedPlayerForGame(where.remembered,b.code,now),null);
});
test('a stale tab cannot erase a different player who has since signed in to the same game',()=>{
 const where=stores(),a=session(),b=session({token:'ben-token',passcode:'456789',playerId:'ben'});save(a,where);const stale=where.tab;where.tab=storage();save(b,where);
 forgetPlayerSession(a,{...where,tab:stale},{},now);assert.equal(read(where).playerId,'ben');
 stale.setItem(TAB_SESSION_KEY,JSON.stringify({...a,storageVersion:3}));assert.equal(read({...where,tab:stale}).playerId,'ben');
});
test('an invalidated old token does not remove a newer session for the same player',()=>{
 const where=stores(),old=session(),fresh=session({token:'new-alex-token'});save(old,where);save(fresh,where);
 forgetPlayerSession(old,where,{exactToken:true},now);assert.equal(read(where).token,fresh.token);
 forgetPlayerSession(old,where,{},now);assert.equal(read(where),null);
});
test('starting a demo can clear the tab while keeping the real game remembered',()=>{
 const where=stores(),s=session();save(s,where);forgetPlayerSession(s,where,{keepRemembered:true},now);assert.equal(where.tab.getItem(TAB_SESSION_KEY),null);assert.equal(read({...where,tab:storage()}).token,s.token);
 assert.deepEqual(save({...s,demo:true},where),{tabSaved:false,deviceSaved:false});
});
test('expired game sessions are removed at the exact expiry boundary',()=>{
 const where=stores(),s=session({expiresAt:now+1});save(s,where);assert.equal(readPlayerSession(where,{},now).token,s.token);assert.equal(readPlayerSession(where,{},now+1),null);
 assert.equal(where.tab.getItem(TAB_SESSION_KEY),null);assert.deepEqual(JSON.parse(where.remembered.getItem(DEVICE_SESSION_KEY)).sessions,{});
});
for(const patch of [{code:'other'},{passcode:'12345'},{inviteKey:'wrong'},{expiresAt:'tomorrow'},{expiresAt:now},{token:null}])test(`invalid saved details are rejected: ${JSON.stringify(patch)}`,()=>{
 const where=stores();where.tab.setItem(TAB_SESSION_KEY,JSON.stringify(session(patch)));assert.equal(read(where),null);
});
test('corrupt or unavailable browser storage does not crash joining or signing out',()=>{
 const where=stores();where.tab.setItem(TAB_SESSION_KEY,'{');where.remembered.setItem(DEVICE_SESSION_KEY,'{');assert.equal(read(where),null);
 const blocked={getItem(){throw Error('Blocked');},setItem(){throw Error('Blocked');},removeItem(){throw Error('Blocked');}},fallback={tab:storage(),remembered:blocked};
 assert.deepEqual(save(session(),fallback),{tabSaved:true,deviceSaved:false});assert.equal(read(fallback).token,session().token);assert.doesNotThrow(()=>forgetPlayerSession(session(),fallback));assert.equal(read({tab:blocked,remembered:blocked}),null);
});
test('opening a different invitation does not delete the remembered game',()=>{
 const where=stores(),s=session();save(s,where);assert.equal(read(where,{inviteKey:'b'.repeat(64)}),null);forgetPlayerSession(null,where,{},now);assert.equal(rememberedPlayerForGame(where.remembered,s.code,now).token,s.token);
});
test('player matching uses the game and identity, not a coincidentally equal code in another game',()=>{
 assert.ok(samePlayerSession(session(),session({token:'different-valid-token'})));
 assert.ok(!samePlayerSession(session(),session({code:'DEF567'})));assert.ok(!samePlayerSession(session(),session({playerId:'ben'})));
});
