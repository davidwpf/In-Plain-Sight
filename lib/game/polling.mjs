export const FAST_POLL_MS=6_000;
export const SLOW_POLL_MS=30_000;
export const MAX_RETRY_MS=60_000;
export const POLL_REQUEST_TIMEOUT_MS=15_000;

export function pollDelay(state,failures=0,now=Date.now()){
  if(!state||state.phase==='ended')return null;
  const base=state.paused||state.phase==='playing'?SLOW_POLL_MS:FAST_POLL_MS;
  // A failed request must back off even if a round's deadline has passed.
  if(failures>0)return Math.min(MAX_RETRY_MS,base*2**Math.min(failures,4));
  if(!state.paused){
    const deadline=state.phase==='playing'?state.deadline:state.phase==='voting'?state.voteDeadline:null;
    if(Number.isFinite(deadline)){
      const remaining=deadline-now;
      return remaining>0?Math.min(base,Math.max(250,remaining+100)):FAST_POLL_MS;
    }
  }
  return base;
}

/**
 * One request at a time, scheduled after the previous response. Injected clocks
 * let tests exercise hours of play and failed connections without real waits.
 * @param {{getState:()=>any,refresh:(signal:AbortSignal)=>Promise<string>,isVisible?:()=>boolean,isBusy?:()=>boolean,now?:()=>number,setTimer?:(callback:()=>void,delay:number)=>any,clearTimer?:(id:any)=>void}} options
 */
export function createGamePoller({getState,refresh,isVisible=()=>true,isBusy=()=>false,now=Date.now,setTimer=setTimeout,clearTimer=clearTimeout}){
  let timer=null,active=null,inFlight=false,stopped=false,failures=0;
  function clearScheduled(){if(timer!==null){clearTimer(timer);timer=null;}}
  function schedule(){
    clearScheduled();
    if(stopped||inFlight||!isVisible())return;
    const delay=pollDelay(getState(),failures,now());
    if(delay!==null)timer=setTimer(()=>{timer=null;void run();},delay);
  }
  async function run(){
    clearScheduled();
    if(stopped||inFlight||!isVisible()||pollDelay(getState(),0,now())===null)return;
    if(isBusy()){schedule();return;}
    inFlight=true;
    const request=new AbortController();active=request;
    let result='failed';
    try{result=await refresh(request.signal);}catch{/* Retry rejected requests too. */}
    finally{inFlight=false;if(active===request)active=null;}
    if(stopped)return;
    if(result==='success')failures=0;
    else if(result==='failed')failures=Math.min(failures+1,4);
    schedule();
  }
  const poller={
    checkNow(){void run();},
    updated(){failures=0;schedule();},
    visibilityChanged(){if(isVisible())void run();else clearScheduled();},
    stop(){stopped=true;clearScheduled();active?.abort();},
  };
  schedule();return poller;
}
