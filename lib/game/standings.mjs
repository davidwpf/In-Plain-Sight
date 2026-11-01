const killer=role=>role==='traitor'||role==='killer';
const innocent=role=>role==='faithful'||role==='innocent';
const counted=history=>(history??[]).filter(round=>round.review?.status!=='discarded');

// Derive context from completed results rather than keeping counters that can
// drift when a round is discarded or a player joins, leaves or signs in again.
export function gameStandings(players,history=[]){
  const records=new Map(players.map(p=>[p.id,{id:p.id,name:p.name,score:p.score,
    roundsPlayed:0,murdersCompleted:0,correctAccusations:0,attemptsSpotted:0,rank:null}]));
  for(const round of counted(history)){
    const people=new Map((round.players??[]).map(p=>[p.id,p]));
    for(const p of people.values()){
      const record=records.get(p.id);if(!record)continue;
      record.roundsPlayed++;
      if(killer(p.role)&&(p.killed===true||round.murdererIds?.includes(p.id)))record.murdersCompleted++;
      const accused=people.get(p.votedFor);
      if(innocent(p.role)&&p.submitted&&accused&&killer(accused.role))record.correctAccusations++;
      if(innocent(p.role)&&p.submitted&&!p.awareness?.skipped&&p.awareness?.answer===true&&p.awareness?.taskCompleted===true)record.attemptsSpotted++;
    }
  }
  // Unplayed arrivals do not win a game merely because 0 beats a negative score.
  const standings=[...records.values()].sort((a,b)=>Number(b.roundsPlayed>0)-Number(a.roundsPlayed>0)||b.score-a.score||a.name.localeCompare(b.name));
  for(let i=0;i<standings.length;i++)if(standings[i].roundsPlayed>0){
    standings[i].rank=i>0&&standings[i-1].score===standings[i].score?standings[i-1].rank:i+1;
  }
  return standings;
}

export function gameFinishSummary(standings,history=[]){
  const winners=standings.filter(p=>p.rank===1).map(p=>({...p}));
  const awards=[['murders','Most murders completed','murdersCompleted'],['accusations','Most correct accusations','correctAccusations'],['attempts','Most murder attempts spotted','attemptsSpotted']].map(([id,title,key])=>{
    const value=Math.max(0,...standings.map(p=>p[key]));
    return {id,title,value,winners:value?standings.filter(p=>p[key]===value).map(p=>({id:p.id,name:p.name})):[]};
  });
  return {completedRounds:counted(history).length,winners,awards,standings,
    hasDiscardedRounds:history.some(round=>round.review?.status==='discarded')};
}
