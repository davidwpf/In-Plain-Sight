export const DISPUTE_MS=2*60*1000;
const need=(condition,message)=>{if(!condition)throw new Error(message);};
export const disputeOpen=g=>g.dispute?.status==='open';

function totals(d){
  const choices=d.eligibleIds.map(id=>d.votes[id]);
  return {keep:choices.filter(v=>v==='keep').length,discard:choices.filter(v=>v==='discard').length};
}

function resolve(g,now,closing=false){
  const d=g.dispute;if(!disputeOpen(g))return;
  const counts=totals(d),needed=Math.floor(d.eligibleIds.length/2)+1;
  const submitted=counts.keep+counts.discard;
  closing||=submitted===d.eligibleIds.length;
  let keep=counts.keep,discard=counts.discard,tieBreak=null;
  // A partial tie cannot trigger an early decision. The extra point still has
  // to reach a majority of the full, fixed electorate, not just respondents.
  if(closing&&keep===discard&&keep>0&&d.adminId&&d.votes[d.adminId]){
    const choice=d.votes[d.adminId];
    if(counts[choice]+1>=needed){tieBreak=choice;if(choice==='keep')keep++;else discard++;}
  }
  if(!closing&&keep<needed&&discard<needed)return;
  const status=discard>=needed?'discarded':'kept';
  d.status=status;d.resolvedAt=now;
  const review={status,openedAt:d.openedAt,resolvedAt:now,submittedCount:submitted,totalEligible:d.eligibleIds.length,
    keepVotes:counts.keep,discardVotes:counts.discard,adminTieBreak:tieBreak,
    resolution:tieBreak?'admin-tie':keep>=needed||discard>=needed?'majority':'timeout'};
  // Reverse the saved delta, including every bonus and penalty, exactly once.
  // Never recalculate a past round using whatever scoring rules exist today.
  if(status==='discarded')for(const result of g.results.players){
    const player=g.players.find(p=>p.id===result.id);
    need(player,'A player from this round is missing.');player.score-=result.delta;
  }
  const update=result=>{
    result.review={...review};
    if(status==='discarded')for(const p of result.players){
      p.originalDelta=p.delta;p.originalScore=p.score;p.delta=0;
      p.score=g.players.find(player=>player.id===p.id).score;
    }
  };
  // JSON persistence makes these separate objects. Direct engine calls may
  // share them, so deduplicate by object identity before touching any deltas.
  for(const result of new Set([g.results,...g.history.filter(r=>r.round===d.round)]))update(result);
}

export function openDispute(g,actorId,round,now){
  need(g.phase==='results'&&g.results,'A round can only be disputed while its results are showing.');
  need(round===g.round,'This round has already moved on. Refresh the page.');
  need(g.pausedAt===null,'Resume the game before opening a dispute.');
  need(!g.dispute&&!g.results.review,'This round has already had a dispute vote.');
  const eligibleIds=g.results.players.map(p=>p.id);
  need(eligibleIds.includes(actorId),'Only players from this round can dispute it.');
  // Keep the electorate and the tie-breaker fixed if players arrive, sit out,
  // leave or hand over admin controls while the vote is underway.
  g.dispute={round,eligibleIds,adminId:eligibleIds.includes(g.adminId)?g.adminId:null,
    openedAt:now,deadline:now+DISPUTE_MS,status:'open',votes:{}};
}

export function voteOnDispute(g,actorId,action,now){
  need(g.phase==='results'&&action.round===g.round,'This round has already moved on. Refresh the page.');
  need(disputeOpen(g),'This dispute vote is closed.');
  const d=g.dispute;
  need(d.eligibleIds.includes(actorId),'Only players from this round can vote on the dispute.');
  need(action.choice==='keep'||action.choice==='discard','Choose Keep this round or Discard this round.');
  need(!Object.hasOwn(d.votes,actorId),'Your dispute vote is already locked.');
  d.votes[actorId]=action.choice;resolve(g,now);
}

export function tickDispute(g,now){if(disputeOpen(g)&&now>=g.dispute.deadline)resolve(g,now,true);}

export function publicDispute(g,id){
  const d=g.dispute;if(!d)return null;
  return {round:d.round,status:d.status,deadline:d.deadline,eligible:d.eligibleIds.includes(id),
    submittedCount:Object.keys(d.votes).length,totalEligible:d.eligibleIds.length,
    majority:Math.floor(d.eligibleIds.length/2)+1,myVote:d.votes[id]??null,
    tieBreakAdminName:d.adminId?g.players.find(p=>p.id===d.adminId)?.name??null:null};
}
