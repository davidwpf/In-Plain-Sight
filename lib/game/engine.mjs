import library from '../../content/tasks.json' with {type:'json'};
export const MIN_PLAYERS=3;
export const MAX_PLAYERS=30;
export const ROUND_MS=60*60*1000;
export const VOTE_MS=5*60*1000;
export const BREAK_MS=120*1000;
export const CONTENT=library;
function need(condition,message){if(!condition)throw new Error(message);}
export function traitorCountFor(count){return count<3?0:count<6?1:count<10?2:3;}
export function randomInt(n){need(Number.isInteger(n)&&n>0,'Invalid random range.');const a=new Uint32Array(1),limit=Math.floor(4294967296/n)*n;do{crypto.getRandomValues(a);}while(a[0]>=limit);return a[0]%n;}
export function shuffled(items,rng=randomInt){const a=[...items];for(let i=a.length-1;i>0;i--){const j=rng(i+1);[a[i],a[j]]=[a[j],a[i]];}return a;}
export function validateContent(content=library){
  need(Array.isArray(content.recognition)&&content.recognition.length>0,'Add at least one recognition phrase.');
  need(Array.isArray(content.murders)&&content.murders.length>0,'Add at least one murder task.');
  for(const [key,fields] of [['recognition',['id','prompt','reply']],['murders',['id','title','kind','difficulty','instruction']]]){
    const ids=new Set();for(const entry of content[key]){for(const f of fields)need(typeof entry[f]==='string'&&entry[f].trim().length>0,`${key}: every entry needs ${f}.`);need(!ids.has(entry.id),`${key}: duplicate id ${entry.id}.`);ids.add(entry.id);}
  }return true;
}
validateContent();
export function makeGame(code,name,admin,now=Date.now()){
  return {schemaVersion:2,code,name,adminId:admin.id,createdAt:now,phase:'lobby',round:0,deadline:null,voteDeadline:null,pausedAt:null,
    players:[{...admin,score:0,nextActive:true}],active:[],roles:{},ballots:{},history:[],results:null,traitorCount:0,signal:null,mission:null,loginAttempts:{}};
}
export function startRound(g,now=Date.now(),rng=randomInt){
  const active=g.players.filter(p=>p.nextActive).map(p=>p.id);need(active.length>=MIN_PLAYERS,'At least three players need to be ready.');
  g.active=active;g.round++;g.phase='playing';g.deadline=now+ROUND_MS;g.voteDeadline=null;g.pausedAt=null;g.traitorCount=traitorCountFor(active.length);
  g.roles={};g.ballots={};g.results=null;
  // Draw independently every round; previous traitors remain eligible.
  const traitors=shuffled(active,rng).slice(0,g.traitorCount);for(const id of active)g.roles[id]=traitors.includes(id)?'traitor':'faithful';
  g.signal=g.traitorCount>1?library.recognition[rng(library.recognition.length)]:null;
  g.mission=library.murders[rng(library.murders.length)];return g;
}
export function openVoting(g){need(g.phase==='playing','The roundtable is not ready.');g.phase='voting';g.deadline=null;g.voteDeadline=null;return g;}
function joinedNames(names){return names.length<2?names[0]||'':`${names.slice(0,-1).join(', ')} and ${names.at(-1)}`;}
export function resolveMurder(g){
  const traitors=g.active.filter(id=>g.roles[id]==='traitor');const reports={};
  for(const id of traitors){const target=g.ballots[id]?.targetId;if(target&&g.active.includes(target)){(reports[target]??=[]).push(id);}}
  const majority=Math.floor(traitors.length/2)+1;
  const murderedId=Object.keys(reports).find(id=>reports[id].length>=majority&&g.roles[id]==='faithful')||null;
  return {murderedId,murdererIds:murderedId?reports[murderedId]:[],attempts:Object.entries(reports).filter(([id])=>id!==murderedId).map(([targetId,reporterIds])=>({targetId,reporterIds})),majority};
}
export function finishRound(g,now=Date.now()){
  need(g.phase==='voting','Voting is not open.');
  const counts=Object.fromEntries(g.active.map(id=>[id,0]));
  for(const [id,ballot] of Object.entries(g.ballots))if(g.roles[id]==='faithful'&&ballot.kind==='accusation'&&g.active.includes(ballot.targetId))counts[ballot.targetId]++;
  const max=Math.max(0,...Object.values(counts));const caughtIds=g.active.filter(id=>max>0&&counts[id]===max);
  const murder=resolveMurder(g);const traitorsCaught=caughtIds.filter(id=>g.roles[id]==='traitor');
  const results=g.active.map(id=>{
    const p=g.players.find(p=>p.id===id),role=g.roles[id],caught=caughtIds.includes(id),ballot=g.ballots[id];
    const killed=murder.murdererIds.includes(id),correct=role==='faithful'&&!!ballot?.targetId&&g.roles[ballot.targetId]==='traitor';
    const attemptedBy=murder.attempts.find(a=>a.targetId===id)?.reporterIds||[];let delta,reason;
    if(role==='traitor'){
      delta=killed?(caught?1:traitorsCaught.length?2:4):(caught?-3:0);
      reason=killed?(caught?'Successful murder · caught':traitorsCaught.length?'Successful murder · another traitor caught':'Successful murder · escaped'):(caught?'No successful murder · caught':ballot?.targetId?'Attempted murder · escaped':'No murder · escaped');
    }else{
      const murderPenalty=murder.murderedId===id&&!correct;
      delta=(correct?4:-1)-(caught?1:0)-(murderPenalty?1:0);
      reason=correct?'Correctly identified a traitor (+4)':ballot?'Incorrect accusation (−1)':'Did not vote (−1)';
      if(caught)reason+=' · Most accusations (−1)';
      if(murderPenalty)reason+=' · Murdered (−1)';
    }
    p.score+=delta;
    const killers=murder.murdererIds.map(pid=>g.players.find(x=>x.id===pid).name);const attackers=attemptedBy.map(pid=>g.players.find(x=>x.id===pid).name);
    const blurb=murder.murderedId===id?`You were murdered. ${joinedNames(killers)}${killers.length===2?' both':killers.length>2?' all':''} killed you.`:attemptedBy.length?`You survived an attempted murder. ${joinedNames(attackers)} tried to kill you, but the murder failed.`:null;
    return {id,name:p.name,role,caught,murdered:murder.murderedId===id,attempted:attemptedBy.length>0,attemptedBy,killed,votes:counts[id],delta,score:p.score,reason,blurb,
      votedFor:role==='faithful'?ballot?.targetId||null:null,reportedVictim:role==='traitor'?ballot?.targetId||null:null,submitted:!!ballot};
  });
  g.results={round:g.round,players:results,murderedId:murder.murderedId,murdererIds:murder.murdererIds,attempts:murder.attempts,submittedCount:Object.keys(g.ballots).length,totalActive:g.active.length,finishedAt:now};
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
    case 'pause':need(admin,'Only the admin can pause the game.');need(['playing','voting','results'].includes(g.phase),'There is no round to pause.');need(g.pausedAt===null,'The game is already paused.');g.pausedAt=now;break;
    case 'resume':need(admin,'Only the admin can resume the game.');need(g.pausedAt!==null,'The game is not paused.');const duration=now-g.pausedAt;if(g.deadline!==null)g.deadline+=duration;if(g.voteDeadline!==null)g.voteDeadline+=duration;g.pausedAt=null;break;
    case 'ballot':{
      need(g.pausedAt===null,'The game is paused. Wait for the admin to resume.');need(g.phase==='voting','The roundtable is not voting yet.');need(g.active.includes(actorId),'You are joining the next round.');need(!Object.hasOwn(g.ballots,actorId),'Your submission is already locked.');
      const traitor=g.roles[actorId]==='traitor';need(traitor&&action.target===null||g.active.includes(action.target)&&action.target!==actorId,'Choose another player.');
      g.ballots[actorId]={kind:traitor?'report':'accusation',targetId:action.target};
      if(g.voteDeadline===null&&Object.keys(g.ballots).length>=Math.ceil(g.active.length/2))g.voteDeadline=now+VOTE_MS;
      if(Object.keys(g.ballots).length===g.active.length)finishRound(g,now);break;
    }
    case 'ready':need(g.phase!=='ended','This game has ended.');need(typeof action.ready==='boolean','Choose whether to play.');actor.nextActive=action.ready;break;
    case 'end':need(admin,'Only the admin can end the game.');need(g.phase!=='ended','This game has ended.');g.phase='ended';g.deadline=null;g.voteDeadline=null;g.pausedAt=null;break;
    default:throw new Error('Unknown action.');
  }return g;
}
export function publicView(g,id,now=Date.now()){
  const p=g.players.find(p=>p.id===id);need(p,'Player not found.');const active=g.active.includes(id),secretActive=active&&['playing','voting'].includes(g.phase),traitor=g.roles[id]==='traitor';
  return {schemaVersion:2,code:g.code,name:g.name,phase:g.phase,round:g.round,deadline:g.deadline,voteDeadline:g.voteDeadline,paused:g.pausedAt!==null,pausedAt:g.pausedAt,serverTime:now,
    me:{id:p.id,name:p.name,score:p.score,nextActive:p.nextActive,active,isAdmin:g.adminId===id},
    players:g.players.map(p=>({id:p.id,name:p.name,score:p.score,nextActive:p.nextActive,active:g.active.includes(p.id),submitted:g.phase==='voting'&&g.active.includes(p.id)?Object.hasOwn(g.ballots,p.id):undefined})),
    activeCount:g.active.length,readyCount:g.players.filter(p=>p.nextActive).length,traitorCount:g.traitorCount,nextTraitorCount:traitorCountFor(g.players.filter(p=>p.nextActive).length),
    submittedCount:Object.keys(g.ballots).length,myBallot:g.ballots[id]||null,
    secret:secretActive?{role:g.roles[id],otherTraitors:traitor?g.traitorCount-1:undefined,signal:traitor?g.signal:undefined,mission:traitor?g.mission:undefined}:null,
    results:g.results||null,history:g.history};
}
