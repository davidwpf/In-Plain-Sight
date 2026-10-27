import library from '../../content/tasks.json' with {type:'json'};
export const MIN_PLAYERS=2;
export const MAX_PLAYERS=30;
export const ROUND_MS=60*60*1000;
export const DEFAULT_ROUND_MINUTES=60;
export const VOTE_MS=5*60*1000;
export const BREAK_MS=120*1000;
export const ROUND_RULES_VERSION=5;
const PARTICIPATION_RULES_VERSION=2;
export const AWARENESS_RULES_VERSION=4;
export const TWO_PLAYER_RULES_VERSION=5;
export const CONTENT=library;
function need(condition,message){if(!condition)throw new Error(message);}
// Two-player rounds draw zero or one; null means the count is not fixed.
export function traitorCountFor(count){return count===2?null:count<3?0:count<6?1:count<10?2:3;}
export function isTwoPlayerRound(g){return g.roundRulesVersion>=TWO_PLAYER_RULES_VERSION&&g.active.length===2;}
export function randomInt(n){need(Number.isInteger(n)&&n>0,'Invalid random range.');const a=new Uint32Array(1),limit=Math.floor(4294967296/n)*n;do{crypto.getRandomValues(a);}while(a[0]>=limit);return a[0]%n;}
export function shuffled(items,rng=randomInt){const a=[...items];for(let i=a.length-1;i>0;i--){const j=rng(i+1);[a[i],a[j]]=[a[j],a[i]];}return a;}
export function validateRoundMinutes(minutes=DEFAULT_ROUND_MINUTES){
  need(Number.isSafeInteger(minutes)&&minutes>=30&&minutes%30===0&&Number.isSafeInteger(Date.now()+minutes*60000),'Choose a round length in 30-minute steps: 30, 60, 90…');return minutes;
}
export function traitorWeights(g,active){
  const records=new Map(active.map(id=>[id,{expected:0,traitor:0}]));
  for(const round of g.history||[]){
    const players=round.players||[];if(!players.length)continue;
    const chance=players.filter(p=>p.role==='traitor').length/players.length;
    for(const p of players){const record=records.get(p.id);if(record){record.expected+=chance;if(p.role==='traitor')record.traitor++;}}
  }
  // New players start neutral. Sitting out adds no opportunities. Bound the weights so everyone stays eligible.
  return Object.fromEntries([...records].map(([id,r])=>[id,Math.round(100*2**Math.max(-2,Math.min(2,2*(r.expected-r.traitor))))]));
}
export function drawTraitors(active,weights,count,rng=randomInt){
  if(active.every(id=>weights[id]===weights[active[0]]))return shuffled(active,rng).slice(0,count);
  const pool=[...active],chosen=[];
  while(chosen.length<count){
    const total=pool.reduce((sum,id)=>sum+weights[id],0);let ticket=rng(total),index=0;
    while(ticket>=weights[pool[index]]){ticket-=weights[pool[index]];index++;}
    chosen.push(pool.splice(index,1)[0]);
  }return chosen;
}
export function validateContent(content=library){
  need(Array.isArray(content.recognition)&&content.recognition.length>0,'Add at least one recognition signal.');
  need(Array.isArray(content.murders)&&content.murders.length>0,'Add at least one murder task.');
  for(const [key,fields] of [['recognition',['id','prompt']],['murders',['id','title','kind','difficulty','instruction']]]){
    const ids=new Set();for(const entry of content[key]){for(const f of fields)need(typeof entry[f]==='string'&&entry[f].trim().length>0,`${key}: every entry needs ${f}.`);if(key==='recognition'&&Object.hasOwn(entry,'reply'))need(typeof entry.reply==='string'&&entry.reply.trim().length>0,'recognition: reply must be non-empty when provided.');need(!ids.has(entry.id),`${key}: duplicate id ${entry.id}.`);ids.add(entry.id);}
  }return true;
}
validateContent();
function drawTask(g,key,items,previous,rng){
  g.usedTaskIds??={};
  let used=g.usedTaskIds[key]??(previous?[previous.id]:[]);
  const previousId=previous?.id??used.at(-1);
  let available=items.filter(item=>!used.includes(item.id));
  if(!available.length){used=[];available=items.length>1?items.filter(item=>item.id!==previousId):items;}
  const chosen=available[rng(available.length)];
  g.usedTaskIds[key]=[...used,chosen.id];return {...chosen};
}
export function makeGame(code,name,admin,now=Date.now(),roundMinutes=DEFAULT_ROUND_MINUTES){
  roundMinutes=validateRoundMinutes(roundMinutes);
  return {schemaVersion:2,roundRulesVersion:ROUND_RULES_VERSION,code,name,roundMinutes,adminId:admin.id,createdAt:now,phase:'lobby',round:0,deadline:null,voteDeadline:null,pausedAt:null,
    players:[{...admin,score:0,nextActive:true}],active:[],roles:{},ballots:{},history:[],results:null,traitorCount:0,signal:null,mission:null,loginAttempts:{}};
}
export function startRound(g,now=Date.now(),rng=randomInt){
  const active=g.players.filter(p=>p.nextActive).map(p=>p.id);need(active.length>=MIN_PLAYERS,'At least two players need to be ready.');
  const roundMinutes=validateRoundMinutes(g.roundMinutes);g.roundMinutes=roundMinutes;
  g.active=active;g.round++;g.phase='playing';g.deadline=now+roundMinutes*60000;g.voteDeadline=null;g.pausedAt=null;g.traitorCount=active.length===2?rng(2):traitorCountFor(active.length);
  g.roles={};g.ballots={};g.results=null;g.roundRulesVersion=ROUND_RULES_VERSION;
  const traitors=g.traitorCount?drawTraitors(active,traitorWeights(g,active),g.traitorCount,rng):[];for(const id of active)g.roles[id]=traitors.includes(id)?'traitor':'faithful';
  g.signal=g.traitorCount>1?drawTask(g,'recognition',library.recognition,g.signal,rng):null;
  g.mission=g.traitorCount?drawTask(g,'murders',library.murders,g.mission,rng):null;return g;
}
export function openVoting(g){need(g.phase==='playing','The roundtable is not ready.');g.phase='voting';g.deadline=null;g.voteDeadline=null;return g;}
function joinedNames(names){return names.length<2?names[0]||'':`${names.slice(0,-1).join(', ')} and ${names.at(-1)}`;}
export function resolveMurder(g){
  const traitors=g.active.filter(id=>g.roles[id]==='traitor'),reports={};
  const modern=g.roundRulesVersion>=PARTICIPATION_RULES_VERSION;
  for(const id of traitors){const target=g.ballots[id]?.targetId;if(target&&g.active.includes(target)){(reports[target]??=[]).push(id);}}
  const majority=Math.floor(traitors.length/2)+1;
  const performers=ids=>ids.filter(id=>g.ballots[id].performed===true);
  const murderedId=Object.keys(reports).find(id=>reports[id].length>=majority&&g.roles[id]==='faithful'&&(!modern||performers(reports[id]).length>0))||null;
  const matching=murderedId?reports[murderedId]:[];
  return {murderedId,murdererIds:modern?performers(matching):matching,
    ...(modern?{accompliceIds:matching.filter(id=>g.ballots[id].performed===false)}:{}),
    attempts:Object.entries(reports).filter(([id])=>id!==murderedId).map(([targetId,reporterIds])=>({targetId,reporterIds,...(modern?{performerIds:performers(reporterIds)}:{})})),majority};
}
export function finishRound(g,now=Date.now()){
  need(g.phase==='voting','Voting is not open.');
  const counts=Object.fromEntries(g.active.map(id=>[id,0]));
  for(const [id,ballot] of Object.entries(g.ballots))if(g.roles[id]==='faithful'&&ballot.kind==='accusation'&&g.active.includes(ballot.targetId))counts[ballot.targetId]++;
  const max=Math.max(0,...Object.values(counts));const caughtIds=g.active.filter(id=>max>0&&counts[id]===max);
  const murder=resolveMurder(g);const traitorsCaught=caughtIds.filter(id=>g.roles[id]==='traitor');
  const modern=g.roundRulesVersion>=PARTICIPATION_RULES_VERSION;
  const penaltyRules=g.roundRulesVersion>=3;
  const awarenessRules=g.roundRulesVersion>=AWARENESS_RULES_VERSION;
  // A completed task counts even when the reports do not confirm a murder.
  const completedTargets=new Set(g.active.filter(id=>g.roles[id]==='traitor'&&g.ballots[id]?.performed===true).map(id=>g.ballots[id].targetId).filter(id=>g.active.includes(id)));
  const mistakenAttacks=penaltyRules?murder.attempts.filter(a=>g.roles[a.targetId]==='traitor'&&a.performerIds.length>0):[];
  const mistakenAttackers=new Set(mistakenAttacks.flatMap(a=>a.performerIds));
  const mistakenTargets=new Set(mistakenAttacks.map(a=>a.targetId));
  const twoPlayer=isTwoPlayerRound(g);
  const innocentVoteSubmitted=twoPlayer?g.active.some(id=>g.roles[id]==='faithful'&&g.ballots[id]?.kind==='accusation'):Object.values(counts).some(n=>n>0);
  const escapeBonus=traitorsCaught.length===0&&innocentVoteSubmitted?2:0;
  const results=g.active.map(id=>{
    const p=g.players.find(p=>p.id===id),role=g.roles[id],caught=caughtIds.includes(id),ballot=g.ballots[id];
    const killed=murder.murdererIds.includes(id),correct=role==='faithful'&&!!ballot?.targetId&&g.roles[ballot.targetId]==='traitor';
    const attempt=murder.attempts.find(a=>a.targetId===id),attemptedBy=attempt?(modern?attempt.performerIds:attempt.reporterIds):[];
    const accomplice=modern&&murder.accompliceIds.includes(id);let delta,reason;
    if(modern&&role==='traitor'){
      if(!ballot){delta=-2;reason='Did not submit a murder report (−2)';}
      else if(killed){
        delta=caught?1:4+escapeBonus;
        reason=caught?'Carried out the murder · caught (+1)':`Carried out the murder (+4)${escapeBonus?' · No traitor caught (+2)':traitorsCaught.length?' · Another traitor caught; no bonus':' · No faithful votes; no bonus'}`;
      }else if(accomplice){
        delta=escapeBonus;reason=escapeBonus?'Accomplice · no traitor caught (+2)':caught?'Accomplice · caught (0)':traitorsCaught.length?'Accomplice · another traitor caught (0)':'Accomplice · no faithful votes (0)';
      }else{delta=caught?-2:0;reason=`No confirmed murder · ${caught?'caught (−2)':'escaped (0)'}`;}
    }else if(modern){
      const noKiller=twoPlayer&&ballot?.kind==='accusation'&&ballot.targetId===null;
      delta=(correct?4:noKiller&&g.traitorCount===0?2:ballot?-1:-2)-(caught&&!twoPlayer?1:0);
      reason=correct?'Correctly identified a traitor (+4)':noKiller?(g.traitorCount===0?'Correctly chose No killer this round (+2)':'Chose No killer, but a killer was present (−1)'):ballot?'Accused a faithful (−1)':'Did not vote (−2)';
      if(caught&&!twoPlayer)reason+=' · Most accusations (−1)';
    }else if(role==='traitor'){
      delta=killed?(caught?1:traitorsCaught.length?2:4):(caught?-3:0);
      reason=killed?(caught?'Successful murder · caught':traitorsCaught.length?'Successful murder · another traitor caught':'Successful murder · escaped'):(caught?'No successful murder · caught':ballot?.targetId?'Attempted murder · escaped':'No murder · escaped');
    }else{
      const murderPenalty=murder.murderedId===id&&!correct;
      delta=(correct?4:-1)-(caught?1:0)-(murderPenalty?1:0);
      reason=correct?'Correctly identified a traitor (+4)':ballot?'Incorrect accusation (−1)':'Did not vote (−1)';
      if(caught)reason+=' · Most accusations (−1)';
      if(murderPenalty)reason+=' · Murdered (−1)';
    }
    const penalties=penaltyRules?{mistakenAttack:mistakenAttackers.has(id)?-2:0,traitorTarget:mistakenTargets.has(id)?-1:0}:null;
    if(penalties?.mistakenAttack){delta+=penalties.mistakenAttack;reason+=' · Completed the task on another traitor (−2)';}
    if(penalties?.traitorTarget){delta+=penalties.traitorTarget;reason+=' · Targeted by another traitor (−1)';}
    let awareness;
    if(awarenessRules&&role==='faithful'){
      const answer=typeof ballot?.suspectedAttempt==='boolean'?ballot.suspectedAttempt:null,taskCompleted=completedTargets.has(id);
      const points=answer===null?0:answer?(taskCompleted?1:-1):(taskCompleted?-1:0);
      awareness={answer,taskCompleted,points};delta+=points;
      if(answer!==null)reason+=answer?(taskCompleted?' · Spotted a murder attempt (+1)':' · Expected a murder attempt; no completed task (−1)'):(taskCompleted?' · Missed a murder attempt (−1)':' · No murder attempt; answered No (0)');
    }
    p.score+=delta;
    const killers=murder.murdererIds.map(pid=>g.players.find(x=>x.id===pid).name);const attackers=attemptedBy.map(pid=>g.players.find(x=>x.id===pid).name);
    const blurb=murder.murderedId===id?`You were murdered. ${joinedNames(killers)}${killers.length===2?' both':killers.length>2?' all':''} killed you.`:attempt?attemptedBy.length?`You survived an attempted murder. ${joinedNames(attackers)} tried to kill you, but the murder failed.`:'An attempted murder was reported against you, but nobody confirmed carrying out the task.':null;
    return {id,name:p.name,role,caught,murdered:murder.murderedId===id,attempted:!!attempt,attemptedBy,killed,...(modern?{accomplice,performed:role==='traitor'&&ballot?ballot.performed:null}:{}),...(penalties?{penalties}:{}),...(awareness?{awareness}:{}),...(twoPlayer?{noKiller:role==='faithful'&&ballot?.kind==='accusation'&&ballot.targetId===null}:{}),votes:counts[id],delta,score:p.score,reason,blurb,
      votedFor:role==='faithful'?ballot?.targetId||null:null,reportedVictim:role==='traitor'?ballot?.targetId||null:null,submitted:!!ballot};
  });
  g.results={round:g.round,...(g.roundRulesVersion>=TWO_PLAYER_RULES_VERSION?{mode:twoPlayer?'two-player':'group'}:{}),...(modern?{rulesVersion:g.roundRulesVersion,accompliceIds:murder.accompliceIds}:{}),players:results,murderedId:murder.murderedId,murderMethod:murder.murderedId?{...g.mission}:null,murdererIds:murder.murdererIds,attempts:murder.attempts,submittedCount:Object.keys(g.ballots).length,totalActive:g.active.length,finishedAt:now};
  g.history.push(g.results);g.phase='results';g.deadline=now+BREAK_MS;g.voteDeadline=null;return g;
}
export function tick(g,now=Date.now(),rng=randomInt){
  if(g.pausedAt!==null)return g;
  if(g.phase==='playing'&&now>=g.deadline)openVoting(g);
  if(g.phase==='voting'&&g.voteDeadline!==null&&now>=g.voteDeadline)finishRound(g,now);
  if(g.phase==='results'&&now>=g.deadline){if(g.players.filter(p=>p.nextActive).length>=MIN_PLAYERS)startRound(g,now,rng);else{g.phase='lobby';g.deadline=null;}}
  return g;
}
export function addPlayer(g,player){
  need(g.phase!=='ended','This game has ended. Create a new game.');need(g.players.length<MAX_PLAYERS,'This game is full (30 players).');
  need(!g.players.some(p=>p.name.toLowerCase()===player.name.toLowerCase()),'That name is already in the game. Add an initial to make yours unique.');
  g.players.push({...player,score:0,nextActive:true});return g;
}
export function applyAction(g,actorId,action,now=Date.now(),rng=randomInt){
  tick(g,now,rng);const actor=g.players.find(p=>p.id===actorId);need(actor,'Player not found.');const admin=g.adminId===actorId;
  switch(action.type){
    case 'start':need(admin,'Only the admin can start the game.');need(g.phase==='lobby','The game has already started.');need(g.pausedAt===null,'Resume the game first.');startRound(g,now,rng);break;
    case 'roundtable':need(admin,'Only the admin can call a roundtable.');need(g.pausedAt===null,'Resume the game first.');openVoting(g);break;
    case 'finishVoting':need(admin,'Only the admin can finish voting.');need(g.pausedAt===null,'Resume the game before finishing voting.');if(g.phase!=='results')finishRound(g,now);break;
    case 'pause':need(admin,'Only the admin can pause the game.');need(['playing','voting','results'].includes(g.phase),'There is no round to pause.');need(g.pausedAt===null,'The game is already paused.');g.pausedAt=now;break;
    case 'resume':need(admin,'Only the admin can resume the game.');need(g.pausedAt!==null,'The game is not paused.');const duration=now-g.pausedAt;if(g.deadline!==null)g.deadline+=duration;if(g.voteDeadline!==null)g.voteDeadline+=duration;g.pausedAt=null;break;
    case 'ballot':{
      need(g.pausedAt===null,'The game is paused. Wait for the admin to resume.');need(g.phase==='voting','The roundtable is not voting yet.');need(g.active.includes(actorId),'You are joining the next round.');need(!Object.hasOwn(g.ballots,actorId),'Your submission is already locked.');
      const traitor=g.roles[actorId]==='traitor';need((traitor||isTwoPlayerRound(g))&&action.target===null||g.active.includes(action.target)&&action.target!==actorId,'Choose another player.');
      let performed;
      if(g.roundRulesVersion>=PARTICIPATION_RULES_VERSION){
        if(traitor){
          if(action.target===null){need(action.performed===undefined||action.performed===false,'No murder cannot include a completed task.');performed=false;}
          else if(g.traitorCount===1){need(action.performed===undefined||action.performed===true,'Choosing a victim confirms that you completed the task. Choose No murder if you did not.');performed=true;}
          else{need(typeof action.performed==='boolean','Choose whether you personally completed the murder task. Refresh the page if the question is missing.');performed=action.performed;}
        }else need(action.performed===undefined,'An Innocent vote does not need a murder-task answer.');
      }
      let suspectedAttempt;
      if(g.roundRulesVersion>=AWARENESS_RULES_VERSION){
        if(traitor)need(action.suspectedAttempt===undefined,'Only Innocents answer the murder-attempt question.');
        else{need(typeof action.suspectedAttempt==='boolean','Choose Yes or No for whether someone tried to murder you. Refresh the page if the question is missing.');suspectedAttempt=action.suspectedAttempt;}
      }
      g.ballots[actorId]={kind:traitor?'report':'accusation',targetId:action.target,...(performed!==undefined?{performed}:{}),...(suspectedAttempt!==undefined?{suspectedAttempt}:{})};
      if(g.voteDeadline===null&&Object.keys(g.ballots).length>=Math.ceil(g.active.length/2))g.voteDeadline=now+VOTE_MS;
      if(Object.keys(g.ballots).length===g.active.length)finishRound(g,now);break;
    }
    case 'ready':need(g.phase!=='ended','This game has ended.');need(typeof action.ready==='boolean','Choose whether to play.');actor.nextActive=action.ready;break;
    case 'leave':need(g.phase!=='ended','This game has ended.');actor.nextActive=false;break;
    case 'end':need(admin,'Only the admin can end the game.');need(g.phase!=='ended','This game has ended.');g.phase='ended';g.deadline=null;g.voteDeadline=null;g.pausedAt=null;break;
    default:throw new Error('Unknown action.');
  }return g;
}
export function publicView(g,id,now=Date.now()){
  const p=g.players.find(p=>p.id===id);need(p,'Player not found.');const active=g.active.includes(id),secretActive=active&&['playing','voting'].includes(g.phase),traitor=g.roles[id]==='traitor';
  const twoPlayer=isTwoPlayerRound(g),hideKillerCount=twoPlayer&&!g.results;
  return {schemaVersion:2,roundRulesVersion:g.roundRulesVersion??1,code:g.code,name:g.name,roundMinutes:g.roundMinutes??DEFAULT_ROUND_MINUTES,phase:g.phase,round:g.round,deadline:g.deadline,voteDeadline:g.voteDeadline,paused:g.pausedAt!==null,pausedAt:g.pausedAt,serverTime:now,
    me:{id:p.id,name:p.name,score:p.score,nextActive:p.nextActive,active,isAdmin:g.adminId===id},
    players:g.players.map(p=>({id:p.id,name:p.name,score:p.score,nextActive:p.nextActive,active:g.active.includes(p.id),submitted:g.phase==='voting'&&g.active.includes(p.id)?Object.hasOwn(g.ballots,p.id):undefined})),
    roundMode:twoPlayer?'two-player':'group',activeCount:g.active.length,readyCount:g.players.filter(p=>p.nextActive).length,traitorCount:hideKillerCount?null:g.traitorCount,nextTraitorCount:traitorCountFor(g.players.filter(p=>p.nextActive).length),
    submittedCount:Object.keys(g.ballots).length,myBallot:g.ballots[id]||null,
    secret:secretActive?{role:g.roles[id],otherTraitors:traitor?g.traitorCount-1:undefined,signal:traitor?g.signal:undefined,mission:traitor?g.mission:undefined}:null,
    results:g.results||null,history:g.history};
}
