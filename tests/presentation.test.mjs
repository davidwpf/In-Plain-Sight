import test from 'node:test';
import assert from 'node:assert/strict';
import {roleLabel,roleWording} from '../lib/game/presentation.mjs';
test('saved role identifiers and the current name both display as Killer',()=>{
  assert.equal(roleLabel('traitor'),'Killer');assert.equal(roleLabel('killer'),'Killer');assert.equal(roleLabel('faithful'),'Innocent');
});
test('recorded scoring explanations use Killer wording without changing saved history',()=>{
  const saved=Object.freeze({role:'traitor',reason:'Completed the task on another traitor (−2) · No traitor caught (+2)',delta:4});
  assert.equal(roleWording(saved.reason),'Completed the task on another killer (−2) · No killer caught (+2)');
  assert.equal(saved.role,'traitor');assert.equal(saved.reason,'Completed the task on another traitor (−2) · No traitor caught (+2)');assert.equal(saved.delta,4);
});
test('headings, plurals and unchanged scoring text retain their case and values',()=>{
  assert.equal(roleWording('TRAITORS · Traitor scoring · two traitors'),'KILLERS · Killer scoring · two killers');
  assert.equal(roleWording('Faithful correctly identifies a killer (+4)'),'Innocent correctly identifies a killer (+4)');
  assert.equal(roleWording(null),'');
});

test('Innocent labels and articles work for saved results without rewriting names',()=>{
  assert.equal(roleLabel('innocent'),'Innocent');
  assert.equal(roleWording('Accused a faithful (−1) · Most accusations (−1)'), 'Accused an innocent (−1) · Most accusations (−1)');
  assert.equal(roleWording('No faithful votes; no bonus'), 'No innocent votes; no bonus');
  assert.equal(roleWording('FAITHFUL · Faithful scoring'), 'INNOCENT · Innocent scoring');
});

import {scoreBreakdown,resultDetails,personalResult,roundSummary,pointsLabel} from '../lib/game/presentation.mjs';
import {makeGame,addPlayer,startRound,openVoting,applyAction,finishRound} from '../lib/game/engine.mjs';
const storyNow=1000000;
function storyGame(count=8,{innocentPair=false,legacy=false}={}){
  const g=makeGame('ABC234','Results test',{id:'p0',name:'Alice'},storyNow);
  const names=['Alice','Jamie','Ben','Charlie','Robin','Sam','Grace','Noah','Isla','Alex'];
  for(let i=1;i<count;i++)addPlayer(g,{id:`p${i}`,name:names[i]});
  startRound(g,storyNow,innocentPair?()=>0:n=>n-1);
  if(legacy)g.roundRulesVersion=1;
  openVoting(g);return g;
}
const storyReport=(g,id,target,performed)=>applyAction(g,id,{type:'ballot',target,...(performed===undefined?{}:{performed})},storyNow);
const storyVote=(g,id,target,suspectedAttempt=false)=>applyAction(g,id,{type:'ballot',target,suspectedAttempt},storyNow);
function storyResults(g){if(g.phase==='voting')finishRound(g,storyNow);return g.results;}
const storyPlayer=(r,id)=>r.players.find(p=>p.id===id);
const scenarios=[];

test('a murder summary credits performers and keeps an accomplice out of the murderer list',()=>{
  const g=storyGame();storyReport(g,'p0','p2',true);storyReport(g,'p1','p2',false);storyVote(g,'p2','p0');
  const r=storyResults(g),story=roundSummary(r);scenarios.push(r);
  assert.match(story.body,/Ben was murdered by Alice\./);assert.ok(!story.body.includes('Jamie'));
  assert.match(story.court,/Court caught Alice, a Killer/);
  assert.match(personalResult(storyPlayer(r,'p2'),r),/Alice killed you/);
});
test('a mixed summary distinguishes a successful murder from the separate failed attempt',()=>{
  const g=storyGame(10);storyReport(g,'p0','p3',true);storyReport(g,'p1','p3',false);storyReport(g,'p2','p4',true);storyVote(g,'p5','p2');
  const r=storyResults(g),story=roundSummary(r);scenarios.push(r);
  assert.match(story.body,/Charlie was murdered by Alice/);assert.match(story.body,/Ben attempted to murder Robin, but the attempt failed/);
  assert.ok(!story.body.includes('murdered by Alice and Jamie'));
  assert.match(scoreBreakdown(storyPlayer(r,'p2'),r)[0].text,/Your murder attempt failed and you were caught/);
  assert.match(scoreBreakdown(storyPlayer(r,'p0'),r)[0].text,/You carried out the murder and were not caught/);
});
test('a minority completed task cannot turn a different name-only report into an actual attempt',()=>{
  const g=storyGame(10);storyReport(g,'p0','p3',false);storyReport(g,'p1','p3',false);storyReport(g,'p2','p4',true);
  const r=storyResults(g),story=roundSummary(r);scenarios.push(r);
  assert.match(story.body,/Ben attempted to murder Robin/);
  assert.ok(!story.body.includes('attempted to murder Charlie'));
  assert.match(story.notes.join(' '),/Charlie was named in a murder report/);
  assert.match(scoreBreakdown(storyPlayer(r,'p0'),r)[0].text,/Your report did not confirm a murder/);
});
test('name-only reports never claim the task happened or the target survived an actual attack',()=>{
  const g=storyGame();storyReport(g,'p0','p2',false);storyReport(g,'p1','p2',false);
  const r=storyResults(g),story=roundSummary(r);scenarios.push(r);
  assert.match(story.body,/Ben was named in a murder report/);
  assert.ok(!story.body.includes('survived'));assert.ok(!story.body.includes('attempted to murder'));
  assert.match(personalResult(storyPlayer(r,'p2'),r),/nobody confirmed completing/);
});
test('a failed completed task is described as an attempt, with the correct target and attacker',()=>{
  const g=storyGame();storyReport(g,'p0','p2',true);storyReport(g,'p1',null,false);
  const r=storyResults(g),story=roundSummary(r);scenarios.push(r);
  assert.match(story.headline,/Ben lives to accuse another day/);assert.match(story.body,/Alice attempted to murder Ben/);
  assert.match(scoreBreakdown(storyPlayer(r,'p0'),r)[0].text,/Your murder attempt failed, but you were not caught/);
});
test('friendly fire identifies a fellow Killer without claiming a murder succeeded',()=>{
  const g=storyGame();storyReport(g,'p0','p1',true);storyReport(g,'p1',null,false);
  const r=storyResults(g),story=roundSummary(r);scenarios.push(r);
  assert.match(story.body,/Alice tried to murder Jamie, a fellow Killer/);assert.match(story.body,/Killers cannot be murdered/);
  assert.ok(!story.body.includes('was murdered'));
  assert.ok(scoreBreakdown(storyPlayer(r,'p0'),r).some(line=>line.text==='You completed the task on another Killer'&&line.points===-2));
});
test('an explicit No murder report is not described as an attempted murder',()=>{
  const g=storyGame();storyReport(g,'p0',null,false);storyReport(g,'p1',null,false);
  const r=storyResults(g);scenarios.push(r);
  assert.match(roundSummary(r).body,/failed to kill anyone/);
  assert.equal(scoreBreakdown(storyPlayer(r,'p0'),r)[0].text,'You reported no murder and were not caught');
});
test('missing ballots have one scored explanation and no repeated missing-answer labels',()=>{
  const r=storyResults(storyGame());scenarios.push(r);
  assert.deepEqual(scoreBreakdown(storyPlayer(r,'p2'),r),[{text:'You did not vote',points:-2}]);
  assert.deepEqual(resultDetails(storyPlayer(r,'p2'),r),['0 accusations received']);
  assert.match(roundSummary(r).body,/No Killers submitted a murder report/);
  assert.equal(roundSummary(r).court,'No Innocents submitted a vote.');
  assert.ok(!personalResult(storyPlayer(r,'p2'),r).includes('did not vote'));
});
test('both Innocent players can correctly choose No killer without displaying a skipped awareness answer',()=>{
  const g=storyGame(2,{innocentPair:true});storyVote(g,'p0',null);storyVote(g,'p1',null);
  const r=storyResults(g);scenarios.push(r);
  assert.equal(roundSummary(r).body,'Both players were Innocent.');
  assert.match(roundSummary(r).court,/Both players correctly chose No killer/);
  assert.deepEqual(resultDetails(storyPlayer(r,'p0'),r),['0 accusations received']);
});
test('an Innocent tied with a caught Killer does not make the summary say that no Killer was caught',()=>{
  const g=storyGame();storyVote(g,'p2','p0');storyVote(g,'p3','p4');
  const r=storyResults(g),story=roundSummary(r);scenarios.push(r);
  assert.match(story.court,/Court caught Alice/);assert.match(story.court,/Robin received the joint most votes, but was Innocent/);
  assert.ok(!story.court.includes('No Killers were caught'));
});
test('a missed vote can still identify the player who received the most accusations',()=>{
  const g=storyGame();storyVote(g,'p2','p3');const r=storyResults(g);scenarios.push(r);
  assert.deepEqual(scoreBreakdown(storyPlayer(r,'p3'),r),[{text:'You did not vote',points:-2},{text:'You received the most votes',points:-1}]);
});
test('the team bonus is explained separately from the task points, including a completed task on a second Killer',()=>{
  const g=storyGame(10);storyReport(g,'p0','p3',true);storyReport(g,'p1','p3',false);storyReport(g,'p2','p0',true);storyVote(g,'p4','p5');
  const r=storyResults(g);scenarios.push(r);
  assert.deepEqual(scoreBreakdown(storyPlayer(r,'p0'),r).map(line=>line.points),[4,2,-1]);
  assert.deepEqual(scoreBreakdown(storyPlayer(r,'p1'),r).map(line=>line.points),[0,2]);
  assert.match(roundSummary(r).notes.join(' '),/Ben tried to murder Alice, a fellow Killer/);
});
test('saved legacy results use the saved points and original performer information',()=>{
  const g=storyGame(8,{legacy:true});storyReport(g,'p0','p2');storyReport(g,'p1','p2');storyVote(g,'p3','p0');
  const r=storyResults(g);scenarios.push(r);
  assert.match(roundSummary(r).body,/murdered by Alice and Jamie/);
  assert.equal(scoreBreakdown(storyPlayer(r,'p0'),r)[0].points,storyPlayer(r,'p0').delta);
});
test('all four awareness outcomes have clear explanations and keep the awarded points',()=>{
  for(const completed of [true,false])for(const answer of [true,false]){
    const g=storyGame(3);if(completed)storyReport(g,'p0','p1');storyVote(g,'p1','p0',answer);
    const r=storyResults(g);scenarios.push(r);
    const line=scoreBreakdown(storyPlayer(r,'p1'),r).at(-1);
    assert.equal(line.points,answer?(completed?1:-1):(completed?-1:0));
    assert.equal(resultDetails(storyPlayer(r,'p1'),r).at(-1),`You suspected a murder attempt: ${answer?'Yes':'No'}.`);
  }
});
test('presentation is stable, does not mutate saved rounds, and explains the exact recorded total',()=>{
  assert.ok(scenarios.length>=14);
  for(const r of scenarios){
    const before=JSON.stringify(r),story=roundSummary(r);
    assert.deepEqual(roundSummary(r),story);
    const copy=JSON.stringify(story);
    assert.doesNotMatch(copy,/\u2014|\b(?:isn|wasn|weren|didn|doesn|don|won|can|couldn|shouldn|wouldn|haven|hasn|hadn)['’]t\b|\b(?:you|we|they|it|that|there)['’](?:re|ve|ll|d|s)\b/i);
    for(const p of r.players){
      const lines=scoreBreakdown(p,r);assert.equal(lines.reduce((sum,line)=>sum+line.points,0),p.delta);
      assert.doesNotMatch(JSON.stringify([lines,resultDetails(p,r),personalResult(p,r)]),/\u2014|\b(?:isn|wasn|weren|didn|doesn|don|won|couldn|shouldn|wouldn|haven|hasn|hadn)['’]t\b|\b(?:you|we|they|it|that|there)['’](?:re|ve|ll|d|s)\b/i);
    }
    assert.equal(JSON.stringify(r),before);
  }
  assert.equal(pointsLabel(-3),'−3');assert.equal(pointsLabel(4),'+4');assert.equal(pointsLabel(0),'0');
});
