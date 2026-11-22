import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanPlayerName,playerNameKey,validateChosenPlayerCode,validLoginCode,chosenLogin,findLoginPlayer} from '../lib/game/identity.mjs';
import {hashSecret} from '../lib/game/storage.mjs';
import {makeGame,addPlayer} from '../lib/game/engine.mjs';

test('chosen codes are exactly four digits, including leading zeros',()=>{
  for(const code of ['0000','0123','9999'])assert.equal(validateChosenPlayerCode(code),code);
  for(const code of ['123','12345','123456','12ab',' 1234',1234,null,undefined])assert.throws(()=>validateChosenPlayerCode(code),/four-digit/);
  for(const code of ['0000','123456'])assert.ok(validLoginCode(code));
  for(const code of ['12345',1234,null])assert.ok(!validLoginCode(code));
});
test('names match without case or accidental spaces, with a bounded display name',()=>{
  assert.equal(cleanPlayerName('  Alex   Smith\n '),'Alex Smith');
  assert.equal(cleanPlayerName('<Alex>'),'Alex');assert.equal(cleanPlayerName('x'.repeat(30)).length,24);
  assert.equal(playerNameKey('  ＫATE   Smith '),'kate smith');assert.equal(playerNameKey(null),'');
});
test('the same code belongs independently to two named players and separate games',async()=>{
  const g={authSalt:'game-a',players:[]};
  for(const name of ['Alex Smith','Ben']){const {passcode,...login}=await chosenLogin(g,name,'0123');assert.equal(passcode,'0123');g.players.push({id:name,name,...login});}
  assert.notEqual(g.players[0].loginHash,g.players[1].loginHash);
  assert.equal((await findLoginPlayer(g,' ALEX  SMITH ','0123')).id,'Alex Smith');
  assert.equal((await findLoginPlayer(g,'ben','0123')).id,'Ben');
  for(const [name,code] of [['Charlie','0123'],['Alex Smith','0124'],['','0123'],['Alex Smith','123']])assert.equal(await findLoginPlayer(g,name,code),null);
  const other={authSalt:'game-b',players:[]},login=await chosenLogin(other,'Ben','0123');assert.notEqual(login.loginHash,g.players[1].loginHash);
  assert.ok(!JSON.stringify(g).includes('0123'));
});
test('existing six-digit codes remain compatible and a supplied name must match their owner',async()=>{
  const g={authSalt:'legacy',players:[{id:'a',name:'Alex  Smith',loginHash:await hashSecret('legacy:012345')}]};
  assert.equal((await findLoginPlayer(g,undefined,'012345')).id,'a');
  assert.equal((await findLoginPlayer(g,' alex smith ','012345')).id,'a');
  assert.equal(await findLoginPlayer(g,'Ben','012345'),null);assert.equal(await findLoginPlayer(g,'Alex Smith','0123'),null);
  g.players.push({id:'b',name:'Ben',...(await chosenLogin(g,'Ben','0123'))});
  assert.equal((await findLoginPlayer(g,'Ben','0123')).id,'b');assert.equal((await findLoginPlayer(g,'Alex Smith','012345')).id,'a');
});
test('duplicate names are rejected after normalising case and whitespace',()=>{
  const g=makeGame('ABC234','Game',{id:'a',name:'Alex Smith'});
  for(const name of ['alex smith',' ALEX  SMITH ','Ａlex Smith'])assert.throws(()=>addPlayer(g,{id:name,name}),/already in the game/);
  addPlayer(g,{id:'b',name:'Alex S'});assert.equal(g.players.length,2);
});
