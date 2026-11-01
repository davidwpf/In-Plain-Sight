import test from 'node:test';
import assert from 'node:assert/strict';
import {makeGame,addPlayer,applyAction,publicView,tick} from '../lib/game/engine.mjs';
import {gameStandings,gameFinishSummary} from '../lib/game/standings.mjs';
const now=1800000000000;
function game(count=3){const g=makeGame('ABC234','The finish',{id:'p0',name:'Alex'},now);for(let i=1;i<count;i++)addPlayer(g,{id:`p${i}`,name:`Player ${i}`});return g;}
const mark=(g,enabled=true,id='p0',at=now+1)=>applyAction(g,id,{type:'setFinalRound',round:g.round,expectedFinalRound:g.finalRound??null,enabled},at);
const start=g=>applyAction(g,'p0',{type:g.round?'nextRound':'start',...(g.round?{round:g.round}:{})},now+10,n=>n-1);
const complete=g=>{applyAction(g,'p0',{type:'roundtable'},now+20);applyAction(g,'p0',{type:'finishVoting'},now+21);};
const restore=g=>JSON.parse(JSON.stringify(g));

test('the admin can mark the first round as final before anyone joins',()=>{
 const g=game(1);mark(g);assert.equal(g.finalRound,1);assert.equal(publicView(g,'p0').finalRound,1);addPlayer(g,{id:'p1',name:'Sam'});start(g);assert.equal(g.round,1);assert.equal(g.finalRound,1);assert.equal(g.phase,'playing');
});
for(const phase of ['playing','voting','results'])test(`the admin can mark the next round as final during ${phase}`,()=>{
 const g=game();start(g);if(phase!=='playing')applyAction(g,'p0',{type:'roundtable'},now+20);if(phase==='results')applyAction(g,'p0',{type:'finishVoting'},now+21);const old=restore(g);mark(g);assert.equal(g.finalRound,2);assert.equal(g.phase,phase);assert.deepEqual(g.roles,old.roles);assert.deepEqual(g.ballots,old.ballots);assert.deepEqual(g.history,old.history);assert.equal(g.deadline,old.deadline);
});
test('only the current admin can mark or cancel, and handover keeps the existing plan',()=>{
 const g=game();assert.throws(()=>mark(g,true,'p1'),/Only the admin/);mark(g);applyAction(g,'p0',{type:'ready',ready:false,newAdminId:'p1'},now+2);assert.equal(g.finalRound,1);assert.throws(()=>mark(g,false),/Only the admin/);mark(g,false,'p1');assert.equal(g.finalRound,null);
});
test('choosing Keep playing does not deal roles, alter points or end a round',()=>{
 const g=game();mark(g);start(g);complete(g);const before=restore(g);mark(g,false);assert.equal(g.finalRound,null);assert.equal(g.phase,'results');assert.deepEqual(g.history,before.history);assert.deepEqual(g.players,before.players);start(g);assert.equal(g.round,2);
});
test('final results wait for explicit confirmation and cannot start another round accidentally',()=>{
 const g=game();mark(g);start(g);complete(g);const before=restore(g);tick(g,now+86400000);assert.deepEqual(g,before);assert.throws(()=>start(g),/final round/);assert.equal(g.phase,'results');applyAction(g,'p0',{type:'finishGame',round:1},now+30);assert.equal(g.phase,'ended');assert.deepEqual(g.players,before.players);assert.deepEqual(g.history,before.history);assert.equal(publicView(g,'p0').finishSummary.completedRounds,1);
});
test('confirmation is restricted to an admin looking at the same final-round results',()=>{
 const g=game();mark(g);start(g);assert.throws(()=>applyAction(g,'p0',{type:'finishGame',round:1}),/results have changed/);complete(g);
 assert.throws(()=>applyAction(g,'p1',{type:'finishGame',round:1}),/Only the admin/);
 for(const round of [null,undefined,'1',0,2])assert.throws(()=>applyAction(g,'p0',{type:'finishGame',round}),/results have changed/);
 mark(g,false);assert.throws(()=>applyAction(g,'p0',{type:'finishGame',round:1}),/results have changed/);start(g);assert.throws(()=>applyAction(g,'p0',{type:'finishGame',round:1}),/results have changed/);
});
test('stale, duplicate and malformed final-round requests cannot change a plan',()=>{
 const g=game();const action={type:'setFinalRound',round:0,expectedFinalRound:null,enabled:true};applyAction(g,'p0',action,now);const before=restore(g);assert.throws(()=>applyAction(g,'p0',action,now),/choice has changed/);assert.deepEqual(g,before);
 for(const enabled of [undefined,1,null,'true',{}])assert.throws(()=>applyAction(g,'p0',{...action,expectedFinalRound:1,enabled}),/Choose whether/);
 start(g);assert.throws(()=>applyAction(g,'p0',{type:'setFinalRound',round:0,expectedFinalRound:1,enabled:false}),/choice has changed/);
});
test('an open final-round dispute blocks confirmation until its decision is settled',()=>{
 const g=game();mark(g);start(g);complete(g);applyAction(g,'p1',{type:'openDispute',round:1},now+30);assert.throws(()=>applyAction(g,'p0',{type:'finishGame',round:1},now+31),/dispute vote/);
 for(const id of ['p0','p1'])applyAction(g,id,{type:'disputeVote',round:1,choice:'keep'},now+32);applyAction(g,'p0',{type:'finishGame',round:1},now+33);assert.equal(g.phase,'ended');assert.equal(g.results.review.status,'kept');
});
test('discarding a final round offers a fresh final deal and preserves earlier totals',()=>{
 let g=game();start(g);complete(g);mark(g);start(g);complete(g);const earlier=restore(g.history[0]);applyAction(g,'p1',{type:'openDispute',round:2},now+30);for(const id of ['p0','p1'])applyAction(g,id,{type:'disputeVote',round:2,choice:'discard'},now+31);
 assert.equal(publicView(g,'p0').finishSummary.completedRounds,1);assert.throws(()=>applyAction(g,'p0',{type:'finishGame',round:2},now+32),/discarded/);g=restore(g);start(g);assert.equal(g.round,3);assert.equal(g.finalRound,3);assert.deepEqual(g.history[0],earlier);assert.equal(g.dispute,null);
});
test('a failed replay does not move the final-round flag or alter scores',()=>{
 const g=game();mark(g);start(g);complete(g);applyAction(g,'p0',{type:'openDispute',round:1},now+30);for(const id of ['p0','p1'])applyAction(g,id,{type:'disputeVote',round:1,choice:'discard'},now+31);applyAction(g,'p1',{type:'ready',ready:false},now+32);applyAction(g,'p2',{type:'ready',ready:false},now+32);const before=restore(g);assert.throws(()=>start(g),/At least two/);assert.deepEqual(g,before);
});
test('the group can still end early, including during a discarded final round',()=>{
 for(const phase of ['lobby','playing','voting','results']){const g=game();mark(g);if(phase!=='lobby')start(g);if(phase==='voting')applyAction(g,'p0',{type:'roundtable'},now+20);if(phase==='results')complete(g);applyAction(g,'p0',{type:'end'},now+40);assert.equal(g.phase,'ended');assert.equal(publicView(g,'p0').finishSummary.completedRounds,phase==='results'?1:0);}
});
test('saved games without a final-round flag retain their normal flow and derive round counts',()=>{
 const g=game();delete g.finalRound;start(g);complete(g);const v=publicView(g,'p0');assert.equal(v.finalRound,null);assert.equal(v.me.roundsPlayed,1);assert.equal(v.players[1].roundsPlayed,1);start(g);assert.equal(g.round,2);applyAction(g,'p0',{type:'end'},now+40);assert.equal(publicView(g,'p0').finishSummary.completedRounds,1);
});
test('an already ended game cannot be marked, cancelled, confirmed twice or reopened',()=>{
 const g=game();mark(g);start(g);complete(g);applyAction(g,'p0',{type:'finishGame',round:1},now+30);const before=restore(g);assert.throws(()=>mark(g,false),/ended/);assert.throws(()=>applyAction(g,'p0',{type:'finishGame',round:1}),/results have changed/);assert.throws(()=>start(g),/after the results/);assert.deepEqual(g,before);
});
test('a late arrival and a sit-out can join a final round under the correct two-player or group rules',()=>{
 const g=game(2);start(g);complete(g);mark(g);addPlayer(g,{id:'late',name:'Taylor'});applyAction(g,'p1',{type:'ready',ready:false},now+22);start(g);assert.deepEqual(g.active,['p0','late']);assert.equal(g.finalRound,2);assert.equal(publicView(g,'late').roundMode,'two-player');assert.equal(publicView(g,'late').me.roundsPlayed,0);complete(g);assert.equal(publicView(g,'late').me.roundsPlayed,1);assert.equal(publicView(g,'p1').me.roundsPlayed,1);
});

const players=[{id:'a',name:'Alex',score:18},{id:'b',name:'Ben',score:18},{id:'c',name:'Charlie',score:4},{id:'late',name:'Taylor',score:0}];
function history(){return [
 {round:1,rulesVersion:6,murderedId:'b',murdererIds:['a'],players:[{id:'a',role:'traitor',submitted:true,killed:true},{id:'b',role:'faithful',submitted:true,votedFor:'a',awareness:{answer:true,taskCompleted:true,points:1}},{id:'c',role:'faithful',submitted:false}]},
 {round:2,rulesVersion:6,murderedId:null,murdererIds:[],players:[{id:'a',role:'faithful',submitted:true,votedFor:'c',awareness:{answer:true,taskCompleted:true,points:1}},{id:'b',role:'traitor',submitted:true,performed:true,reportedVictim:'a',killed:false},{id:'c',role:'faithful',submitted:true,votedFor:'b',awareness:{answer:true,taskCompleted:false,points:-1}}]},
 {round:3,rulesVersion:6,murderedId:'c',murdererIds:['b'],players:[{id:'a',role:'traitor',submitted:true,accomplice:true,killed:false},{id:'b',role:'traitor',submitted:true,killed:true},{id:'c',role:'faithful',submitted:true,votedFor:'a',awareness:{answer:false,taskCompleted:true,points:-1}}]},
 {round:4,review:{status:'discarded'},murderedId:'a',murdererIds:['b'],players:[{id:'a',role:'faithful',submitted:true,votedFor:'b',awareness:{answer:true,taskCompleted:true,points:1}},{id:'b',role:'traitor',killed:true,submitted:true}]}
];}
test('rounds played comes from completed counted rosters, not votes, current readiness or joins',()=>{
 const standings=gameStandings(players,history());assert.deepEqual(standings.map(p=>[p.id,p.roundsPlayed]),[['a',3],['b',3],['c',3],['late',0]]);assert.deepEqual(standings.map(p=>p.score),[18,18,4,0]);assert.deepEqual(standings.map(p=>p.rank),[1,1,3,null]);
});
test('award counts distinguish successful performers, accomplices, attempts and correct accusations',()=>{
 const standings=gameStandings(players,history()),a=standings.find(p=>p.id==='a'),b=standings.find(p=>p.id==='b'),c=standings.find(p=>p.id==='c');
 assert.equal(a.murdersCompleted,1);assert.equal(b.murdersCompleted,1);assert.equal(a.correctAccusations,0);assert.equal(b.correctAccusations,1);assert.equal(c.correctAccusations,2);assert.equal(a.attemptsSpotted,1);assert.equal(b.attemptsSpotted,1);assert.equal(c.attemptsSpotted,0);
});
test('summary shares tied wins and tied awards without inventing a tie-break or adding points',()=>{
 const before=restore(players),past=history(),pastBefore=restore(past),summary=gameFinishSummary(gameStandings(players,past),past);
 assert.deepEqual(summary.winners.map(p=>p.id),['a','b']);assert.equal(summary.completedRounds,3);assert.equal(summary.hasDiscardedRounds,true);assert.deepEqual(summary.awards[0].winners.map(p=>p.id),['a','b']);assert.equal(summary.awards[0].value,1);assert.deepEqual(summary.awards[1].winners.map(p=>p.id),['c']);assert.equal(summary.awards[1].value,2);assert.deepEqual(players,before);assert.deepEqual(past,pastBefore);
});
test('a 0-round arrival cannot win over players with negative scores',()=>{
 const s=gameStandings([{id:'a',name:'Alex',score:-4},{id:'b',name:'Ben',score:-2},{id:'new',name:'Late',score:0}],[{players:[{id:'a'},{id:'b'}]}]);assert.deepEqual(s.map(p=>[p.id,p.rank]),[['b',1],['a',2],['new',null]]);assert.deepEqual(gameFinishSummary(s).winners.map(p=>p.id),['b']);
});
test('a game with no completed rounds has no winner or awards',()=>{
 const summary=gameFinishSummary(gameStandings(players));assert.deepEqual(summary.winners,[]);assert.equal(summary.completedRounds,0);assert.ok(summary.awards.every(a=>a.value===0&&a.winners.length===0));
});
test('No killer votes, correct No answers, missing awareness and skipped answers do not earn the listed awards',()=>{
 const history=[{players:[{id:'a',role:'faithful',submitted:true,votedFor:null,noKiller:true,awareness:{answer:true,taskCompleted:true,skipped:true}},{id:'b',role:'innocent',submitted:true,noKiller:true,awareness:{answer:false,taskCompleted:false}}]}];const summary=gameFinishSummary(gameStandings(players,history),history);assert.ok(summary.awards.every(a=>a.value===0));
});
test('legacy role names and missing newer awareness fields are supported without guessing',()=>{
 const h=[{murdererIds:['a'],players:[{id:'a',role:'killer',submitted:true},{id:'b',role:'innocent',submitted:true,votedFor:'a'}]}];const s=gameStandings(players,h);assert.equal(s.find(p=>p.id==='a').murdersCompleted,1);assert.equal(s.find(p=>p.id==='b').correctAccusations,1);assert.ok(s.every(p=>p.attemptsSpotted===0));
});
test('public standings do not leak credentials or any current secret role, task or ballot',()=>{
 const g=game();g.players[0].loginHash='PRIVATE LOGIN';g.players[0].tokenHashes=['PRIVATE TOKEN'];start(g);const v=publicView(g,'p1');const stats=JSON.stringify(v.standings);for(const text of ['PRIVATE','traitor','faithful','signal','mission','ballots','authSalt','tokenHashes'])assert.ok(!stats.includes(text));assert.equal(v.finishSummary,null);assert.equal(v.standings.every(p=>p.roundsPlayed===0),true);
});
for(const n of [2,3,6,10,30])test(`${n}-player final round can be completed and confirmed with shared negative-score winners`,()=>{
 const g=game(n);mark(g);start(g);complete(g);applyAction(g,'p0',{type:'finishGame',round:1},now+30);const summary=publicView(g,'p0').finishSummary;assert.equal(summary.winners.length,n);assert.equal(summary.winners[0].score,-2);assert.equal(summary.standings.length,n);assert.ok(summary.standings.every(p=>p.roundsPlayed===1));
});
