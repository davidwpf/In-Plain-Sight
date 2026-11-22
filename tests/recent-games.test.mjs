import test from 'node:test';
import assert from 'node:assert/strict';
import {RECENT_GAMES_KEY,MAX_RECENT_GAMES,recentGames,rememberRecentGame,forgetRecentGame,parseGameEntry} from '../lib/game/recent-games.mjs';
import {rememberPlayerSession,forgetPlayerSession,readPlayerSession,samePlayerSession} from '../lib/game/sessions.mjs';
const now=1000000,origin='https://game.example';
function storage(){const map=new Map();return {getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};}
const game=(patch={})=>({code:'ABC234',gameName:'Evening game',playerName:'Alex',expiresAt:now+1000,lastOpenedAt:now,...patch});
const session=(patch={})=>({...game(),playerId:'alex',passcode:'0123',token:'private-token',inviteKey:'a'.repeat(64),...patch});

test('recent cards contain game and player names but no credentials or roles',()=>{
  const s=storage();rememberRecentGame({...session(),secret:{role:'traitor'},role:'traitor',ballot:'Ben'},s,now);
  assert.deepEqual(recentGames(s,now),[game()]);
  const raw=s.getItem(RECENT_GAMES_KEY);for(const secret of ['0123','private-token','traitor','ballot','inviteKey','playerId'])assert.ok(!raw.includes(secret));
});
test('four-digit sign-ins survive reopening, while explicit switches retain only a recent card',()=>{
  const tab=storage(),remembered=storage(),s=session();rememberPlayerSession(s,{tab,remembered},now);
  assert.equal(readPlayerSession({tab:storage(),remembered},{code:s.code},now).playerName,'Alex');
  forgetPlayerSession(s,{tab,remembered},{},now);assert.equal(readPlayerSession({tab,remembered},{code:s.code},now),null);
  assert.deepEqual(recentGames(remembered,now),[game()]);
  const other=session({playerId:'ben',playerName:'Ben',token:'ben-token'});rememberPlayerSession(other,{tab,remembered},now+1);
  assert.equal(recentGames(remembered,now+1)[0].playerName,'Ben');assert.ok(!samePlayerSession(s,other));
});
test('same codes without player identity cannot restore the wrong four-digit player',()=>{
  const a={code:'ABC234',passcode:'1234',playerName:'Alex'},b={...a,playerName:'Ben'};
  assert.ok(!samePlayerSession(a,b));assert.ok(samePlayerSession(a,{...a,playerName:' ALEX '}));
  const remembered=storage(),tab=storage();rememberPlayerSession({...session(),playerName:''},{tab,remembered},now);assert.equal(readPlayerSession({tab,remembered},{},now),null);
});
test('cards expire exactly at game expiry and ended games can remain available until then',()=>{
  const s=storage();rememberRecentGame(game({phase:'ended'}),s,now);assert.equal(recentGames(s,now+999).length,1);
  assert.deepEqual(recentGames(s,now+1000),[]);assert.equal(s.getItem(RECENT_GAMES_KEY),'[]');
});
test('recent games are deduplicated, newest first, bounded, and isolated when removed',()=>{
  const s=storage();for(let i=0;i<MAX_RECENT_GAMES+3;i++)rememberRecentGame(game({code:'ABCD'+'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(i/32)]+'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[i%32],gameName:'Game '+i}),s,now+i);
  const list=recentGames(s,now+20);assert.equal(list.length,MAX_RECENT_GAMES);assert.equal(list[0].gameName,'Game 10');
  rememberRecentGame({...list[3],playerName:'Ben'},s,now+21);assert.equal(recentGames(s,now+21)[0].playerName,'Ben');
  const code=recentGames(s,now+21)[0].code;assert.equal(forgetRecentGame(code,s,now+21).length,MAX_RECENT_GAMES-1);
});
test('invalid, corrupt and blocked recent storage does not stop sign-in',()=>{
  const s=storage();for(const raw of ['{','null','{}',JSON.stringify([{...game(),code:'bad'},game({expiresAt:now})])]){s.setItem(RECENT_GAMES_KEY,raw);assert.deepEqual(recentGames(s,now),[]);}
  const blocked={getItem(){throw Error();},setItem(){throw Error();}};assert.doesNotThrow(()=>rememberRecentGame(session(),blocked,now));
  assert.deepEqual(recentGames(blocked,now),[]);
});
test('home-screen joining accepts game codes or this site’s complete invite links',()=>{
  assert.deepEqual(parseGameEntry(' ab c234 ',origin),{code:'ABC234',inviteKey:''});
  assert.deepEqual(parseGameEntry(origin+'/?invite='+'a'.repeat(64),origin),{code:'',inviteKey:'a'.repeat(64)});
  assert.deepEqual(parseGameEntry(origin+'/?game=abc234',origin),{code:'ABC234',inviteKey:''});
  for(const input of ['ABC123','1234','javascript:alert(1)','https://other.example/?invite='+'a'.repeat(64),origin+'/?invite=bad',origin+'/?game=ABC234&room=DEF567',origin+'/?invite='+'a'.repeat(64)+'&game=ABC234'])assert.throws(()=>parseGameEntry(input,origin),/game code/);
});
