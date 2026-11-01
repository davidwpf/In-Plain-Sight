// Role keys stay compatible with Games already saved and clients still open.
export function roleLabel(role){
  if(role==='traitor'||role==='killer')return 'Killer';
  return role==='faithful'||role==='innocent'?'Innocent':'Player';
}
// Translate recorded system explanations without changing scores or player names.
export function roleWording(text=''){
  return String(text??'').replace(/\b(traitors?|faithfuls?)\b/gi,word=>{
    const label=word.toLowerCase().startsWith('faithful')?(word.toLowerCase()==='faithfuls'?'innocents':'innocent'):(word.toLowerCase()==='traitors'?'killers':'killer');
    if(word===word.toUpperCase())return label.toUpperCase();
    return word[0]===word[0].toUpperCase()?label[0].toUpperCase()+label.slice(1):label;
  }).replace(/\ba innocent\b/gi,phrase=>phrase===phrase.toUpperCase()?'AN INNOCENT':phrase[0]==='A'?'An innocent':'an innocent');
}

const killerRole=role=>role==='traitor'||role==='killer';
const joined=items=>items.length<2?items[0]||'':`${items.slice(0,-1).join(', ')} and ${items.at(-1)}`;
const named=(results,ids)=>joined(ids.map(id=>results.players.find(p=>p.id===id)?.name||'an unknown player'));
const taskPerformers=(results,attempt)=>attempt.performerIds??((results.rulesVersion??1)<2?attempt.reporterIds??[]:[]);
export const pointsLabel=points=>points>0?`+${points}`:points<0?`−${Math.abs(points)}`:'0';

const murderers=results=>results.murdererIds??results.players.filter(p=>p.killed).map(p=>p.id);
const caughtOthers=(player,results)=>results.players.filter(p=>p.id!==player.id&&killerRole(p.role)&&p.caught);
const caughtNames=people=>`${joined(people.map(p=>p.name))} ${people.length===1?'was':'were'} caught`;
const caughtTie=(player,results)=>player.caught&&results.players.filter(p=>p.caught).length>1?' You were tied for the most votes.':'';
const caughtStatus=(player,results)=>player.caught?`You were caught.${caughtTie(player,results)}`:caughtOthers(player,results).length
  ?`You were not caught, but ${joined(caughtOthers(player,results).map(p=>p.name))} ${caughtOthers(player,results).length===1?'was':'were'}.`:'You were not caught.';

// Describe actions and outcomes separately from the short points labels.
// A correct accusation does not mean that the accused received the most votes.
export function resultOutcome(player,results){
  const people=results.players,target=people.find(p=>p.id===player.votedFor);
  if(killerRole(player.role)){
    const victim=people.find(p=>p.id===results.murderedId||p.murdered);
    const reported=people.find(p=>p.id===player.reportedVictim);
    if(player.killed){
      const action=victim?`You murdered ${victim.name}`:'You carried out the murder';
      return player.caught?`${action}, but you were caught.${caughtTie(player,results)}`:`${action} and were not caught.${caughtOthers(player,results).length?` ${caughtNames(caughtOthers(player,results))}.`:''}`;
    }
    if(player.accomplice){
      const ids=murderers(results);
      return `${victim?`You helped with the murder of ${victim.name}.`:'You helped with the murder.'}${ids.length?` ${named(results,ids)} completed the task.`:''} ${caughtStatus(player,results)}`;
    }
    if(player.submitted&&reported){
      if(player.performed===true||(results.rulesVersion??1)<2){
        const action=killerRole(reported.role)
          ?`You attempted to murder ${reported.name}, who was also a Killer.`
          :`You completed the task on ${reported.name}, but the murder failed because not enough Killers reported the same victim.`;
        return `${action} ${caughtStatus(player,results)}`;
      }
      return `You reported ${reported.name} as the victim without completing the task. No murder was confirmed for that report. ${caughtStatus(player,results)}`;
    }
    return player.submitted?`You reported no murder. ${caughtStatus(player,results)}`:player.caught?caughtStatus(player,results):'';
  }
  const lines=[];
  if(player.submitted){
    if(player.noKiller){
      const killers=people.filter(p=>killerRole(p.role));
      lines.push(killers.length?`You chose No killer this round, but ${joined(killers.map(p=>p.name))} ${killers.length===1?'was a Killer':'were Killers'}.`:'You correctly chose No killer this round.');
    }else if(target){
      lines.push(killerRole(target.role)
        ?`You correctly identified ${target.name} as a Killer. ${target.name} ${target.caught?'was caught':'did not receive the most votes and was not caught'}.`
        :`You voted for ${target.name}, who was an Innocent.`);
    }
  }
  if(player.caught&&results.mode!=='two-player')lines.push(people.filter(p=>p.caught).length>1
    ?'You were tied for the most votes, despite being an Innocent.'
    :'You received the most votes, despite being an Innocent.');
  return lines.join(' ');
}

// Explain the points already saved for a player. Never change or award scores here.
export function scoreBreakdown(player,results){
  const modern=(results.rulesVersion??1)>=2,killer=killerRole(player.role),people=results.players;
  const target=people.find(p=>p.id===player.votedFor),correct=!!target&&killerRole(target.role);
  const extras=[];
  const add=(text,points)=>extras.push({text,points});
  if(!killer&&player.caught&&results.mode!=='two-player'){
    const tied=people.filter(p=>p.caught).length>1;
    add(tied?'Tied for the most votes':'Received the most votes',-1);
  }
  if(!modern&&!killer&&player.murdered&&!correct)add('You were murdered without identifying a Killer',-1);
  if(player.penalties?.mistakenAttack)add('Attempted to murder another Killer',player.penalties.mistakenAttack);
  if(player.penalties?.traitorTarget)add('Targeted by another Killer',player.penalties.traitorTarget);
  const awareness=player.awareness;
  if(awareness&&!awareness.skipped&&typeof awareness.answer==='boolean'){
    add(awareness.answer
      ?awareness.taskCompleted?'Spotted a murder attempt':'Suspected an attempt, but nobody completed the task on you'
      :awareness.taskCompleted?'Missed a murder attempt':'Correctly recognised that nobody tried to murder you',awareness.points);
  }
  let base=player.delta-extras.reduce((sum,line)=>sum+line.points,0),text;
  if(killer){
    if(!player.submitted)text='Did not submit a murder report';
    else if(player.killed)text=player.caught?'Successful murder, but caught':'Successful murder';
    else if(player.accomplice)text=player.caught?'Helped with the murder, but caught':'Helped with the murder';
    else text=player.caught?'No successful murder; caught':'No successful murder';
    if(modern&&(player.killed&&base===6||player.accomplice&&base===2)){
      base-=2;extras.unshift({text:'Team bonus: no Killers were caught',points:2});
    }else if(modern&&(player.killed||player.accomplice)&&!player.caught){
      const others=caughtOthers(player,results);
      extras.unshift({text:others.length?`No team bonus: ${caughtNames(others)}`:'No team bonus: no Innocents voted',points:0});
    }
  }else if(!player.submitted)text='Did not vote';
  else if(player.noKiller)text=people.some(p=>killerRole(p.role))?'Chose No killer, but a Killer was present':'Correctly chose No killer this round';
  else text=correct?'Correct accusation':'Incorrect accusation';
  return [{text,points:base},...extras];
}

export function resultDetails(player,results){
  const details=[`${player.votes} accusation${player.votes===1?'':'s'} received`];
  if(player.submitted){
    if(player.awareness&&!player.awareness.skipped&&typeof player.awareness.answer==='boolean')details.push(`You suspected a murder attempt: ${player.awareness.answer?'Yes':'No'}.`);
  }
  return details;
}

export function personalResult(player,results){
  const awareness=player.awareness;
  const noticed=awareness&&!awareness.skipped&&typeof awareness.answer==='boolean'&&awareness.taskCompleted
    ?awareness.answer?' You spotted the attempt on your life.':' You did not spot the attempt on your life.':'';
  if(player.murdered){
    const ids=murderers(results);
    return (ids.length?`You were murdered by ${named(results,ids)}.`:'You were murdered this round.')+noticed;
  }
  if(player.attempted){
    const attempt=results.attempts?.find(a=>a.targetId===player.id);
    const ids=player.attemptedBy??(attempt?taskPerformers(results,attempt):[]);
    if(!ids.length)return 'You were named in a murder report, but nobody confirmed completing the task on you.';
    if(killerRole(player.role))return `${named(results,ids)} tried to murder you, a fellow Killer. Killers cannot be murdered.`;
    return `${named(results,ids)} completed the task on you, but the murder failed because not enough Killers reported the same victim.${noticed}`;
  }
  return 'Your score for this round. Your breakdown is open below.';
}

// Keep each completed round consistent across refreshes and past-round views.
export function roundSummary(results){
  const people=results.players??[],killers=people.filter(p=>killerRole(p.role));
  const victim=people.find(p=>p.id===results.murderedId||p.murdered);
  const performers=results.murdererIds??people.filter(p=>p.killed).map(p=>p.id);
  const attempts=results.attempts??[],real=attempts.filter(a=>taskPerformers(results,a).length>0);
  const innocentAttempts=real.filter(a=>!killerRole(people.find(p=>p.id===a.targetId)?.role));
  const friendly=real.filter(a=>killerRole(people.find(p=>p.id===a.targetId)?.role));
  const reports=attempts.filter(a=>taskPerformers(results,a).length===0);
  const alternate=(Math.max(1,Number(results.round)||1)-1)%2===1;
  let headline,body;const notes=[];
  const attemptSentence=a=>`${named(results,taskPerformers(results,a))} attempted to murder ${named(results,[a.targetId])}, but the attempt failed.`;
  const friendlySentence=a=>`${named(results,taskPerformers(results,a))} tried to murder ${named(results,[a.targetId])}, a fellow Killer.`;
  const reportSentence=a=>`${named(results,[a.targetId])} was named in a murder report, but no Killer said they completed the task on that person.`;
  if(!killers.length){
    headline=alternate?'Nobody had murder on their to-do list.':'All that suspicion. Not a Killer between you.';
    body=people.length===2?'Both players were Innocent.':'All players were Innocent.';
  }else if(victim){
    const murder=performers.length?`${victim.name} was murdered by ${named(results,performers)}.`:`${victim.name} was murdered.`;
    if(innocentAttempts.length){
      headline=alternate?'Mixed fortunes for the Killers.':innocentAttempts.length===1?'One murder. One lucky escape.':'One murder. A few lucky escapes.';
      body=[murder,...innocentAttempts.map(attemptSentence)].join(' ');
    }else{
      headline=alternate?'A small favour proved fatal.':`${victim.name} trusted the wrong person.`;
      body=murder;
    }
  }else if(innocentAttempts.length){
    headline=alternate?`A close call for ${named(results,innocentAttempts.map(a=>a.targetId))}.`:innocentAttempts.length===1?`${named(results,[innocentAttempts[0].targetId])} lives to accuse another day.`:'Everyone lives to accuse another day.';
    body=innocentAttempts.map(attemptSentence).join(' ');
  }else if(friendly.length){
    headline=alternate?`Wrong target, ${named(results,[...new Set(friendly.flatMap(a=>taskPerformers(results,a)))])}.`:'The Killers turned on their own.';
    body=friendly.map(friendlySentence).join(' ')+' Killers cannot be murdered.';
  }else if(reports.length){
    headline=alternate?'Someone named a victim. Nobody claimed the deed.':'A name is not enough.';
    body=reports.map(reportSentence).join(' ')+' No murder succeeded.';
  }else{
    headline=alternate?'Everyone survives another round.':'All talk. No murder.';
    body=killers.some(p=>p.submitted)?'The Killers failed to kill anyone this round.':'No Killers submitted a murder report. No successful murder was recorded.';
  }
  if((victim||innocentAttempts.length)&&friendly.length)notes.push(...friendly.map(friendlySentence),'Killers cannot be murdered.');
  if((victim||real.length)&&reports.length)notes.push(...reports.map(reportSentence));
  const innocents=people.filter(p=>!killerRole(p.role));
  const caughtKillers=killers.filter(p=>p.caught),caughtInnocents=results.mode==='two-player'?[]:innocents.filter(p=>p.caught);
  let court;
  if(!innocents.some(p=>p.submitted))court='No Innocents submitted a vote.';
  else if(!killers.length) court=innocents.every(p=>p.noKiller)?'Both players correctly chose No killer this round.':'No Killer was present this round.';
  else{
    const lines=[];
    if(caughtKillers.length)lines.push(caughtKillers.length===1?`Court caught ${caughtKillers[0].name}, a Killer.`:`Court caught ${joined(caughtKillers.map(p=>p.name))}, ${caughtKillers.length===2?'both':'all'} Killers.`);
    if(caughtInnocents.length)lines.push(`${joined(caughtInnocents.map(p=>p.name))} received ${caughtInnocents.length+caughtKillers.length>1?'the joint most':'the most'} votes, but ${caughtInnocents.length===1?'was Innocent':'were Innocent'}.`);
    if(!caughtKillers.length)lines.push('No Killers were caught.');
    court=lines.join(' ');
  }
  return {headline,body,notes,court};
}
