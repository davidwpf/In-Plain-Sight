import test from 'node:test';
import assert from 'node:assert/strict';
import {makeGame,addPlayer,startRound,openVoting,finishRound,applyAction,publicView,tick,VOTE_MS} from '../lib/game/engine.mjs';
import {MOST_LIKELY_QUESTIONS,validateMostLikelyQuestions} from '../lib/game/most-likely.mjs';

const now=1_000_000;
const fixed=n=>n-1;
const clone=value=>JSON.parse(JSON.stringify(value));
function fixture(count=3,rng=fixed){
  const g=makeGame('ABC234','A likely evening',{id:'p0',name:'Alex'},now);
  for(let i=1;i<count;i++)addPlayer(g,{id:`p${i}`,name:`Player ${i}`});
  startRound(g,now,rng);return g;
}
const innocents=g=>g.active.filter(id=>g.roles[id]==='faithful');
const killers=g=>g.active.filter(id=>g.roles[id]==='traitor');
const questionAction=(g,target)=>({type:'mostLikelyAnswer',round:g.round,questionId:g.mostLikely?.question.id,target});
const answer=(g,id,target=killers(g)[0])=>applyAction(g,id,questionAction(g,target),now,fixed);
function nextRound(g,rng=fixed){
  if(g.phase==='playing')openVoting(g);
  if(g.phase==='voting')finishRound(g,now);
  applyAction(g,g.adminId,{type:'nextRound',round:g.round,expectedFinalRound:g.finalRound??null,asFinal:false},now,rng);
}
function rejectWithoutChange(g,id,action,pattern){
  const before=clone(g);assert.throws(()=>applyAction(g,id,action,now,fixed),pattern);assert.deepEqual(g,before);
}
function submitNormalBallots(g){
  const target=innocents(g)[0],killer=killers(g)[0];
  for(const id of [...g.active]){
    const action=g.roles[id]==='traitor'?{type:'ballot',target,performed:true}:{type:'ballot',target:killer,suspectedAttempt:id===target};
    applyAction(g,id,action,now,fixed);
  }
}

test('the editable question bank has distinct non-empty IDs and prompts',()=>{
  assert.ok(MOST_LIKELY_QUESTIONS.length>1);assert.equal(validateMostLikelyQuestions(),true);
  assert.equal(new Set(MOST_LIKELY_QUESTIONS.map(q=>q.id)).size,MOST_LIKELY_QUESTIONS.length);
  assert.equal(validateMostLikelyQuestions([{id:'one',prompt:'A new question?'}]),true);
  for(const invalid of [[],null,[null],[{id:'',prompt:'Question?'}],[{id:'one',prompt:''}],[{id:'one',prompt:'First?'},{id:'one',prompt:'Second?'}],[{id:'one',prompt:'Same?'},{id:'two',prompt:' same? '}]])assert.throws(()=>validateMostLikelyQuestions(invalid));
});

for(const count of [3,4,6,10,30])test(`${count}-player rounds share one question among Innocents only`,()=>{
  const g=fixture(count);if(count<30)addPlayer(g,{id:'late',name:'Joining next round'});
  for(const id of innocents(g))assert.deepEqual(publicView(g,id,now).secret.mostLikely,{question:g.mostLikely.question,answerId:null});
  for(const id of killers(g))assert.equal(publicView(g,id,now).secret.mostLikely,undefined);
  if(count<30)assert.equal(publicView(g,'late',now).secret,null);
  assert.equal(g.usedTaskIds.mostLikely.length,1);assert.equal(Object.keys(g.mostLikely.answers).length,0);
});

test('an Innocent can choose a Killer, but a Killer cannot submit a question answer',()=>{
  const g=fixture(6),id=innocents(g)[0],killer=killers(g)[0];
  answer(g,id,killer);assert.equal(publicView(g,id,now).secret.mostLikely.answerId,killer);
  assert.equal(g.mostLikely.answers[id],killer);
  rejectWithoutChange(g,killer,questionAction(g,id),/Only Innocents/);
  openVoting(g);finishRound(g,now);
  assert.deepEqual(g.results.mostLikely.winners,[{id:killer,name:g.players.find(p=>p.id===killer).name}]);
});

test('answering changes only the answering player’s private view and no ballot or readiness state',()=>{
  const g=fixture(10),id=innocents(g)[0];addPlayer(g,{id:'late',name:'Late player'});
  const views=new Map(g.players.filter(p=>p.id!==id).map(p=>[p.id,clone(publicView(g,p.id,now))]));
  const stable=clone({roles:g.roles,signal:g.signal,mission:g.mission,deadline:g.deadline,voteDeadline:g.voteDeadline,players:g.players,ballots:g.ballots,history:g.history});
  answer(g,id);
  for(const [other,before]of views)assert.deepEqual(clone(publicView(g,other,now)),before);
  assert.deepEqual({roles:g.roles,signal:g.signal,mission:g.mission,deadline:g.deadline,voteDeadline:g.voteDeadline,players:g.players,ballots:g.ballots,history:g.history},stable);
  for(const player of g.players){
    const v=publicView(g,player.id,now);
    for(const field of ['mostLikely','mostLikelyAnswers','usedTaskIds','questionCount'])assert.equal(v[field],undefined);
    assert.equal(v.submittedCount,0);assert.equal(v.voteDeadline,null);
    assert.ok(v.players.every(p=>p.submitted===undefined));
  }
});

test('question answers survive reconnection and remain immutable after duplicate or changed submissions',()=>{
  let g=fixture(6);const id=innocents(g)[0],first=questionAction(g,killers(g)[0]);
  applyAction(g,id,first,now,fixed);g=clone(g);
  assert.equal(publicView(g,id,now).secret.mostLikely.answerId,first.target);
  assert.deepEqual(publicView(g,id,now).secret.mostLikely.question,g.mostLikely.question);
  for(const action of [first,questionAction(g,innocents(g)[1])])rejectWithoutChange(g,id,action,/already saved/);
});

test('stale snapshots and self, missing, inactive or late-arrival targets are rejected without mutation',()=>{
  const g=fixture(4),id=innocents(g)[0],target=killers(g)[0];addPlayer(g,{id:'late',name:'Late player'});
  const valid=questionAction(g,target);
  for(const action of [{...valid,round:g.round-1},{...valid,round:undefined},{...valid,questionId:'old'},{...valid,questionId:undefined}])rejectWithoutChange(g,id,action,/question has changed/);
  for(const target of [id,null,undefined,'missing','late'])rejectWithoutChange(g,id,questionAction(g,target),/Choose another player/);
  rejectWithoutChange(g,'late',valid,/Only Innocents/);
  answer(g,id,target);const old=questionAction(g,target);nextRound(g);
  rejectWithoutChange(g,innocents(g)[0],old,/question has changed/);
});

test('pausing blocks answers and resuming preserves the same question and the shifted round deadline',()=>{
  const g=fixture(),id=innocents(g)[0],question=clone(g.mostLikely.question),deadline=g.deadline;
  applyAction(g,g.adminId,{type:'pause'},now+1000,fixed);
  rejectWithoutChange(g,id,questionAction(g,killers(g)[0]),/Resume/);
  tick(g,deadline+10000,fixed);assert.equal(g.phase,'playing');
  applyAction(g,g.adminId,{type:'resume'},now+11000,fixed);
  assert.equal(g.deadline,deadline+10000);assert.deepEqual(g.mostLikely.question,question);
  answer(g,id);assert.equal(g.phase,'playing');
});

test('early Court closes questions without publishing them or counting answers as ballots',()=>{
  const g=fixture(6),id=innocents(g)[0];answer(g,id);
  applyAction(g,g.adminId,{type:'roundtable'},now,fixed);
  for(const player of g.players){const view=publicView(g,player.id,now);assert.equal(view.secret.mostLikely,undefined);assert.equal(view.results,null);assert.deepEqual(view.history,[]);assert.equal(view.submittedCount,0);}
  assert.equal(g.voteDeadline,null);rejectWithoutChange(g,innocents(g)[1],questionAction(g,killers(g)[0]),/Court opens/);
  applyAction(g,id,{type:'ballot',target:killers(g)[0],suspectedAttempt:false},now,fixed);
  assert.equal(Object.keys(g.ballots).length,1);assert.equal(g.voteDeadline,null);
});

test('the normal round deadline closes answers and only the existing ballot threshold starts five minutes',()=>{
  const g=fixture(6),id=innocents(g)[0],action=questionAction(g,killers(g)[0]);
  assert.throws(()=>applyAction(g,id,action,g.deadline,fixed),/Court opens/);
  assert.equal(g.phase,'voting');assert.equal(g.mostLikely.answers[id],undefined);
  for(const voter of innocents(g).slice(0,3))applyAction(g,voter,{type:'ballot',target:killers(g)[0],suspectedAttempt:false},now+4000000,fixed);
  assert.equal(g.voteDeadline,now+4000000+VOTE_MS);
  tick(g,g.voteDeadline,fixed);assert.equal(g.phase,'results');assert.deepEqual(g.results.mostLikely.winners,[]);
});

test('missing question answers never hold up the game or alter scores, final standings or murder resolution',()=>{
  const g=fixture(10),baseline=clone(g);delete baseline.mostLikely;
  openVoting(g);openVoting(baseline);submitNormalBallots(g);submitNormalBallots(baseline);
  const {mostLikely,...actual}=g.results;assert.deepEqual(mostLikely,{question:g.mostLikely.question,winners:[]});
  assert.deepEqual(actual,baseline.results);assert.deepEqual(publicView(g,g.adminId,now).standings,publicView(baseline,baseline.adminId,now).standings);
});

for(const [count,tied]of [[4,3],[6,4]])test(`all ${tied} tied names are revealed in roster order without counts or individual answers`,()=>{
  const g=fixture(count),voters=innocents(g);assert.equal(voters.length,tied);
  for(let i=voters.length-1;i>=0;i--)answer(g,voters[i],voters[(i+1)%voters.length]);
  openVoting(g);finishRound(g,now);
  const expected={question:g.mostLikely.question,winners:voters.map(id=>({id,name:g.players.find(p=>p.id===id).name}))};
  assert.deepEqual(g.results.mostLikely,expected);assert.deepEqual(g.history[0].mostLikely,expected);
  for(const id of g.active){const view=publicView(g,id,now);assert.equal(view.secret,null);assert.deepEqual(view.results.mostLikely,expected);assert.deepEqual(Object.keys(view.results.mostLikely).sort(),['question','winners']);assert.ok(view.results.mostLikely.winners.every(w=>Object.keys(w).sort().join(',')==='id,name'));}
});

test('a sole top choice wins while lower choices and raw answers are never archived',()=>{
  const g=fixture(6),ids=innocents(g),target=killers(g)[0];answer(g,ids[0],target);answer(g,ids[1],target);answer(g,ids[2],ids[3]);
  openVoting(g);finishRound(g,now);
  assert.deepEqual(g.results.mostLikely.winners,[{id:target,name:g.players.find(p=>p.id===target).name}]);
  assert.equal(g.results.answers,undefined);assert.equal(g.results.mostLikely.answers,undefined);assert.equal(g.results.mostLikely.counts,undefined);
  const summary=clone(g.results.mostLikely);g.mostLikely.question.prompt='Changed privately';g.mostLikely.answers={};
  assert.deepEqual(g.results.mostLikely,summary);nextRound(g);assert.deepEqual(g.history[0].mostLikely,summary);assert.deepEqual(g.mostLikely.answers,{});
});

test('question decks exhaust without repetitions, survive storage and avoid immediate repeats between cycles',()=>{
  let g=fixture(3,()=>0);const ids=[],bankLength=MOST_LIKELY_QUESTIONS.length;
  for(let i=0;i<bankLength*2+1;i++){
    ids.push(g.mostLikely.question.id);const question=clone(g.mostLikely.question);g=clone(g);
    for(const id of innocents(g))assert.deepEqual(publicView(g,id,now).secret.mostLikely.question,question);
    if(i<bankLength*2)nextRound(g,()=>0);
  }
  for(const start of [0,bankLength])assert.equal(new Set(ids.slice(start,start+bankLength)).size,bankLength);
  for(let i=1;i<ids.length;i++)assert.notEqual(ids[i],ids[i-1]);
});

for(const rng of [()=>0,fixed])test('two-player rounds skip the question and never consume its deck',()=>{
  const g=fixture(2,rng);assert.equal(g.mostLikely,null);assert.equal(g.usedTaskIds?.mostLikely,undefined);
  for(const id of g.active){assert.equal(publicView(g,id,now).secret.mostLikely,undefined);if(g.roles[id]==='faithful')rejectWithoutChange(g,id,{type:'mostLikelyAnswer',round:g.round,questionId:'any',target:g.active.find(other=>other!==id)},/no question/);}
  nextRound(g,rng);assert.equal(g.mostLikely,null);assert.equal(g.usedTaskIds?.mostLikely,undefined);
});

test('moving 3 to 2 to 3 active players skips without consuming and then resumes the question deck',()=>{
  const g=fixture(3),first=g.mostLikely.question.id,history=[...g.usedTaskIds.mostLikely];
  applyAction(g,'p2',{type:'ready',ready:false},now,fixed);nextRound(g);
  assert.equal(g.active.length,2);assert.equal(g.mostLikely,null);assert.deepEqual(g.usedTaskIds.mostLikely,history);
  for(const id of g.active)assert.equal(publicView(g,id,now).secret.mostLikely,undefined);
  applyAction(g,'p2',{type:'ready',ready:true},now,fixed);nextRound(g);
  assert.equal(g.active.length,3);assert.notEqual(g.mostLikely.question.id,first);assert.deepEqual(g.usedTaskIds.mostLikely,[...history,g.mostLikely.question.id]);
});

test('late joins and sitting out apply next round; disconnected current participants remain eligible',()=>{
  const g=fixture(4);addPlayer(g,{id:'late',name:'Late player'});const id=innocents(g)[0],other=innocents(g)[1];
  applyAction(g,other,{type:'leave'},now,fixed);assert.equal(g.players.find(p=>p.id===other).left,true);
  answer(g,id,other);answer(g,other,killers(g)[0]);
  const before=clone(g.usedTaskIds.mostLikely);nextRound(g);
  assert.equal(g.active.length,4);assert.ok(g.active.includes('late'));assert.ok(!g.active.includes(other));
  const current=innocents(g)[0];rejectWithoutChange(g,current,questionAction(g,other),/Choose another player/);
  assert.equal(publicView(g,other,now).secret,null);assert.equal(g.usedTaskIds.mostLikely.length,before.length+1);
});

test('legacy saved rounds stay unchanged and acquire a question only at the next deal',()=>{
  const g=fixture(6);delete g.mostLikely;delete g.usedTaskIds.mostLikely;
  for(const id of g.active)assert.equal(publicView(g,id,now).secret.mostLikely,undefined);
  rejectWithoutChange(g,innocents(g)[0],{type:'mostLikelyAnswer',round:g.round,questionId:'missing',target:killers(g)[0]},/no question/);
  openVoting(g);finishRound(g,now);assert.equal(g.results.mostLikely,undefined);nextRound(g);assert.ok(g.mostLikely.question.id);assert.equal(g.usedTaskIds.mostLikely.length,1);
});

test('ending an unfinished round does not expose its question or answers; completed summaries persist',()=>{
  const g=fixture(3);answer(g,innocents(g)[0]);openVoting(g);finishRound(g,now);const archived=clone(g.history[0].mostLikely);nextRound(g);
  answer(g,innocents(g)[0]);const unfinishedQuestion=g.mostLikely.question.id;
  applyAction(g,g.adminId,{type:'end'},now,fixed);assert.equal(g.mostLikely,null);assert.equal(g.results,null);assert.equal(g.history.length,1);
  for(const id of g.active){const view=publicView(g,id,now);assert.equal(view.secret,null);assert.equal(view.results,null);assert.deepEqual(view.history[0].mostLikely,archived);assert.ok(!JSON.stringify(view).includes(unfinishedQuestion));}
});

test('task replacements do not change the question and questions do not change task-change state',()=>{
  const g=fixture(3),question=clone(g.mostLikely),id=killers(g)[0];
  applyAction(g,id,{type:'changeMission',round:g.round,missionId:g.mission.id},now,fixed);assert.deepEqual(g.mostLikely,question);
  const mission=clone({mission:g.mission,missionChanges:g.missionChanges,roundMissionIds:g.roundMissionIds});answer(g,innocents(g)[0]);
  assert.deepEqual({mission:g.mission,missionChanges:g.missionChanges,roundMissionIds:g.roundMissionIds},mission);
});

test('the shared question draw is independent of which participant receives the Killer role',()=>{
  const first=fixture(6,()=>0),second=makeGame('XYZ789','Different roles',{id:'p5',name:'Player 5'},now);
  for(let i=4;i>=0;i--)addPlayer(second,{id:`p${i}`,name:i===0?'Alex':`Player ${i}`});
  startRound(second,now,()=>0);assert.notDeepEqual(first.roles,second.roles);assert.deepEqual(first.mostLikely.question,second.mostLikely.question);
});

test('simultaneous Games keep their question answers and decks isolated',()=>{
  const first=fixture(6),second=fixture(6),before=clone(second);answer(first,innocents(first)[0]);assert.deepEqual(second,before);
  nextRound(first);assert.deepEqual(second,before);assert.notEqual(first.mostLikely.question.id,second.mostLikely.question.id);
});

test('discarding a scored round preserves its entertainment summary and reverses only normal points',()=>{
  let g=fixture(6);for(const id of innocents(g))answer(g,id,killers(g)[0]);
  openVoting(g);submitNormalBallots(g);const summary=clone(g.results.mostLikely);g=clone(g);
  applyAction(g,g.adminId,{type:'openDispute',round:g.round},now,fixed);
  for(const id of g.active){
    if(g.dispute.status!=='open')break;
    applyAction(g,id,{type:'disputeVote',round:g.round,choice:'discard'},now,fixed);
  }
  assert.equal(g.dispute.status,'discarded');assert.ok(g.players.every(p=>p.score===0));
  assert.deepEqual(g.results.mostLikely,summary);assert.deepEqual(g.history[0].mostLikely,summary);
  nextRound(g);assert.deepEqual(g.history[0].mostLikely,summary);assert.deepEqual(g.mostLikely.answers,{});
});
