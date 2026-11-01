import {EyeOff,RefreshCw} from 'lucide-react';

export type TaskChangeRequest={id:string;status:'open'|'accepted'|'rejected';total:number;acceptedCount:number;requestedByMe:boolean;myDecision:boolean|null;canRespond:boolean};
type Task={title:string;instruction:string};

export function TaskChangeControls({solo,remaining,request,disabled,onRequest,onReview}:{solo:boolean;remaining:number;request:TaskChangeRequest|null;disabled:boolean;onRequest:()=>void;onReview:()=>void}){
  return <div className="task-changes">
    {request?.status==='open'?<>
      <p className="task-change-status">{request.canRespond?'Another Killer has requested a task change.':`Waiting for the other ${request.total===2?'Killer':'Killers'} to agree.`}</p>
      <button className="button secondary full" onClick={onReview}>Review task change</button>
    </>:<>
      {request&&<p className="task-change-status" role="status">{request.status==='accepted'?'All Killers accepted. The task has changed.':'The request was rejected. The task stays the same.'}</p>}
      {remaining>0?<button className="button secondary full" disabled={disabled} onClick={onRequest}><RefreshCw size={15}/>{solo?'Change task':'Request change'} · {remaining} left</button>:<p className="fine">No change left.</p>}
    </>}
    {!solo&&<p className="fine">Every Killer must accept a change. A new task may be harder, and you cannot go back.</p>}
  </div>;
}

export function TaskChangeDialog({request,task,remaining,paused,busy,error,onDecision,onClose,onHide,onDemoDecision}:{request:TaskChangeRequest|null;task:Task;remaining:number;paused:boolean;busy:boolean;error:string;onDecision:(accept:boolean)=>void;onClose:()=>void;onHide:()=>void;onDemoDecision?:(accept:boolean)=>void}){
  const open=request?.status==='open';
  return <div className="confirmation task-change-dialog">
    {!request?<p>This request is no longer open. Check your current task.</p>:request.status==='accepted'?<>
      <p>All Killers accepted. Everyone now has the new task below.</p>
      <div className="task-change-current"><b>{task.title}</b><p>{task.instruction}</p></div>
      <p className="fine">{remaining>0?`${remaining} shared change left this round.`:'No change left.'}</p>
    </>:request.status==='rejected'?<>
      <p>A Killer rejected the request. Keep the current task.</p>
      <p className="fine">This request did not use a change.</p>
    </>:<>
      <p>{request.canRespond?'Another Killer wants to change the shared murder task.':request.requestedByMe?request.total===2?'The other Killer needs to open their role and respond.':'Both other Killers need to open their roles and respond.':'You accepted the change. The remaining Killer must also accept.'}</p>
      <p className="task-change-progress" role="status">{request.acceptedCount} of {request.total} Killers accepted.</p>
      <div className="task-change-current"><span className="eyebrow">CURRENT TASK</span><b>{task.title}</b><p>{task.instruction}</p></div>
      <p>{request.total===2?'Both Killers must accept.':'All three Killers must accept.'} If anyone rejects, the task stays the same and no change is used.</p>
      <p className="fine">Wait before attempting a murder. Reject if you have already completed this task. A new task may be harder and cannot be undone. Court closes unanswered requests.</p>
      {request.canRespond&&<p className="fine">Your answer cannot be changed for this request.</p>}
    </>}
    {paused&&open&&<p className="task-change-status" role="status">The game is paused. Responses can continue when the admin resumes.</p>}
    {error&&<p className="form-error" role="alert">{error}</p>}
    {open&&request.canRespond?<div className="task-change-buttons">
      <button className="button primary full" disabled={busy||paused} onClick={()=>onDecision(true)}>Accept change</button>
      <button className="button secondary full" disabled={busy||paused} onClick={()=>onDecision(false)}>Reject change</button>
    </div>:<button className="button primary full" disabled={busy} onClick={onClose}>{open?'Close for now':request?.status==='accepted'?'View new task':'Keep current task'}</button>}
    {open&&onDemoDecision&&<div className="task-change-demo"><p className="fine">Try a response for the other Killers in this demo.</p><div className="task-change-buttons"><button className="button secondary full" disabled={busy||paused} onClick={()=>onDemoDecision(true)}>Demo: accept change</button><button className="button secondary full" disabled={busy||paused} onClick={()=>onDemoDecision(false)}>Demo: reject change</button></div></div>}
    <button className="text-button full" onClick={onHide}><EyeOff size={15}/> Hide role</button>
  </div>;
}
