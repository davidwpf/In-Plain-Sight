import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {deleteExpiredGames} from '../lib/game/storage.mjs';
function fixture(){
 const sql=new DatabaseSync(':memory:');
 sql.exec(readFileSync(new URL('../drizzle/0000_spicy_nemesis.sql',import.meta.url),'utf8'));
 sql.prepare('INSERT INTO games(code,state,expires_at) VALUES(?,?,?)').run('LEGACY',JSON.stringify({players:[{name:'Alex'}]}),500);
 sql.exec(readFileSync(new URL('../drizzle/0001_invites_and_expiry.sql',import.meta.url),'utf8'));
 const database={prepare(query){return{bind(...params){return{async run(){const r=sql.prepare(query).run(...params);return{meta:{changes:Number(r.changes)}};}};}};}};
 return{sql,database};
}
test('expiry cleanup removes complete old records, including legacy games, and keeps live games',async()=>{
 const{sql,database}=fixture();
 const insert=sql.prepare('INSERT INTO games(code,state,expires_at,invite_hash) VALUES(?,?,?,?)');
 insert.run('OLD','{"players":[{"loginHash":"old-secret"}],"history":[{"round":1}]}',999,'old');
 insert.run('BOUNDARY','{"roles":{"a":"traitor"}}',1000,'boundary');
 insert.run('LIVE','{"phase":"results","players":[{"name":"Sam"}]}',1001,'live');
 assert.equal(await deleteExpiredGames(database,1000),3);
 assert.deepEqual(sql.prepare('SELECT code,state,expires_at,invite_hash FROM games').all().map(r=>({...r})),[{code:'LIVE',state:'{"phase":"results","players":[{"name":"Sam"}]}',expires_at:1001,invite_hash:'live'}]);
 assert.equal(await deleteExpiredGames(database,1000),0);
 assert.equal(await deleteExpiredGames(database,1001),1);assert.equal(sql.prepare('SELECT count(*) AS n FROM games').get().n,0);sql.close();
});
test('invite migration preserves existing games and prevents duplicate invite identifiers',()=>{
 const{sql}=fixture();assert.equal(sql.prepare('SELECT invite_hash FROM games WHERE code=?').get('LEGACY').invite_hash,null);
 sql.prepare('INSERT INTO games(code,state,expires_at,invite_hash) VALUES(?,?,?,?)').run('NEW','{}',900,'shared');
 assert.throws(()=>sql.prepare('INSERT INTO games(code,state,expires_at,invite_hash) VALUES(?,?,?,?)').run('OTHER','{}',900,'shared'),/UNIQUE/);
 assert.equal(sql.prepare('SELECT state FROM games WHERE code=?').get('LEGACY').state,'{"players":[{"name":"Alex"}]}');sql.close();
});
