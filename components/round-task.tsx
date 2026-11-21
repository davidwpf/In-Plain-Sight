export function RoundTask({results}:{results:any}){
  const task=Object.hasOwn(results,'murderTask')?results.murderTask:results.murderMethod;
  const hasKiller=results.players.some((p:any)=>p.role==='traitor');
  return <section className="round-task" aria-label="Murder task">
    <span className="eyebrow">MURDER TASK</span>
    {task?<><h3>{task.title}</h3><p>{task.instruction}</p></>:<p>{hasKiller?'The task was not saved for this older round.':'No murder task this round.'}</p>}
  </section>;
}
