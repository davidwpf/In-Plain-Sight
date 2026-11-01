'use client';
import {useEffect,useRef,useState} from 'react';
import {QRCodeSVG} from 'qrcode.react';
import {roleLabel,scoreBreakdown,resultDetails,resultOutcome,personalResult,roundSummary,pointsLabel} from '../lib/game/presentation.mjs';
import {createGamePoller,POLL_REQUEST_TIMEOUT_MS} from '../lib/game/polling.mjs';
import {DAGGER_HANDLE,DAGGER_PATHS,DAGGER_TRANSFORM} from '../lib/dagger.mjs';
import {detachNotifications} from '../lib/notifications/client.mjs';
import {RoundAlerts} from '../components/round-alerts';
import {TaskChangeControls,TaskChangeDialog} from '../components/task-changes';
import {ArrowLeft,ArrowRight,Bell,Check,CheckCheck,ChevronDown,Clock,Copy,Crown,Eye,EyeOff,Flag,HelpCircle,Hourglass,KeyRound,Link as LinkIcon,LoaderCircle,LogOut,MoreHorizontal,Pause,Play,QrCode,RefreshCw,Shield,Skull,Sparkles,Swords,Trophy,Users,Vote,X} from 'lucide-react';
import {makeGame,addPlayer,startRound,applyAction,publicView,tick,traitorCountFor,DEFAULT_ROUND_MINUTES,ROUND_RULES_VERSION,AWARENESS_RULES_VERSION,MIN_PLAYERS,MAX_MISSION_CHANGES} from '../lib/game/engine.mjs';
type Any=any;
const STORE='in-plain-sight.session.v2';
const ROUND_HOUR_OPTIONS=Array.from({length:25},(_,i)=>i);
const initials=(name:string)=>name.split(/\s+/).map(s=>s[0]).slice(0,2).join('').toUpperCase();
const timeLeft=(end:number|null,now:number)=>{const seconds=Math.max(0,Math.ceil(((end??now)-now)/1000));return `${Math.floor(seconds/60).toString().padStart(2,'0')}:${(seconds%60).toString().padStart(2,'0')}`;};
function Mark(){return <svg className="mark" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><g transform={DAGGER_TRANSFORM}><rect {...DAGGER_HANDLE} fill="currentColor"/>{DAGGER_PATHS.map(({d,...attributes})=><path key={d} d={d} {...attributes}/>)}</g></svg>;}
function Logo(){return <span className="brand"><Mark/><span>IN PLAIN SIGHT</span></span>;}
function Modal({title,close,children,wide=false,conceal}:{title:string;close:()=>void;children:React.ReactNode;wide?:boolean;conceal?:()=>void}){
  const ref=useRef<HTMLDivElement>(null),closeRef=useRef(close);closeRef.current=close;
  useEffect(()=>{
    const previous=document.activeElement as HTMLElement;
    const key=(event:KeyboardEvent)=>{
      if(event.key==='Escape')closeRef.current();
      if(event.key!=='Tab')return;
      const items=Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],summary,[tabindex]:not([tabindex="-1"])')??[]).filter(item=>item.tabIndex>=0&&item.getClientRects().length>0);
      if(!items.length)return;
      const first=items[0],last=items[items.length-1],outside=!ref.current?.contains(document.activeElement);
      if(outside||event.shiftKey&&document.activeElement===first||!event.shiftKey&&document.activeElement===last){event.preventDefault();(event.shiftKey?last:first).focus();}
    };
    document.addEventListener('keydown',key);return()=>{document.removeEventListener('keydown',key);if(previous?.isConnected)previous.focus();};
  },[]);
  useEffect(()=>{ref.current?.querySelector<HTMLElement>('button[aria-label="Close dialog"]')?.focus();},[title]);
  return <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)close();}}><div ref={ref} role="dialog" aria-modal="true" aria-label={title} className={`modal ${wide?'wide':''}`}><div className="modal-top"><span className="eyebrow">IN PLAIN SIGHT</span><div className="modal-top-actions">{conceal&&<button className="text-button" onClick={conceal}><EyeOff size={15}/> Hide role</button>}<button className="icon-button" onClick={close} aria-label="Close dialog"><X size={20}/></button></div></div><h2>{title}</h2>{children}</div></div>;
}
function Rules(){return <div className="rules">
  <p className="rules-intro">Keep your role secret. If you’re a Killer, carry out your murder task. If you’re Innocent, work out who the Killers are. Earn points each round.</p>
  <h3>A round in six steps</h3>
  <ol className="rules-steps">
    <li><b>Get everyone in.</b> Create a game and share its link or QR code. You need at least two players. The admin plays too and starts when everyone is ready.</li>
    <li><b>Check your secret role.</b> You’ll be a Killer or an Innocent. Your role can change every round.</li>
    <li><b>Play in person.</b> Killers follow their murder task. If there are other Killers, use the shared signal to find them and choose a victim together. Innocents look for suspicious behaviour.</li>
    <li><b>Meet in Court.</b> Discuss who seems suspicious, then answer the questions on your device. Innocents pick a suspected Killer. Killers report their murder. Once submitted, your choices are final.</li>
    <li><b>See what happened.</b> Everyone’s roles, murders and points are revealed. You still get to vote even if someone has murdered you.</li>
    <li><b>Go again.</b> Take time to discuss the results. Join in or sit out the next round. When everyone is ready, the admin starts it and new roles are chosen. You keep your points.</li>
  </ol>
  <details className="rules-section"><summary>Roles and two-player games<ChevronDown size={18} aria-hidden="true"/></summary><div className="rules-section-body">
    <p><b>Innocents:</b> try to spot a Killer and notice if someone carries out a murder task on you.</p>
    <p><b>Killers:</b> complete your murder task without giving yourself away. Other Killers get the same task and recognition signal, but you won’t be told their names. Only one of you needs to do the task; more can take part.</p>
    <table><thead><tr><th>Players this round</th><th>Killers</th></tr></thead><tbody><tr><td>2</td><td>0 or 1</td></tr><tr><td>3–5</td><td>1</td></tr><tr><td>6–9</td><td>2</td></tr><tr><td>10–30</td><td>3</td></tr></tbody></table>
    <p><b>Just two of you?</b> There may be one Killer, or you could both be Innocent. You won’t find out how many Killers there are until the results. An Innocent can vote for the other player or choose <b>No killer this round</b>. Choosing No killer skips the question about a murder attempt on you.</p>
    <p><b>Changing a task:</b> The Killers share a limit of two changes per round. A solo Killer can change the task directly. With other Killers, one requests a change and every other Killer must accept. This means all three must agree in a three-Killer round. One rejection keeps the current task and stops all further task-change requests that round.</p><p>Only change a task before anyone has completed it. While a request is waiting, wait before attempting a murder. Reject if you have already completed the current task. A replacement may be harder, and you cannot return to an earlier task. Court closes unanswered requests. Task changes and responses stop while the game is paused.</p>
    <p>Roles are picked again each round.</p>
  </div></details>
  <details className="rules-section"><summary>Voting and murder results<ChevronDown size={18} aria-hidden="true"/></summary><div className="rules-section-body">
    <p>A default round lasts 60 minutes, but the round length is decided when the game is created. The admin can call Court early.</p>
    <p>Once Court is called, players can submit their votes. There is no time limit until half the players have submitted. Everyone else then has <b>five minutes</b> to vote. Results appear when everyone has submitted, time runs out, or the admin finishes voting.</p>
    <h4>Reporting a murder</h4>
    <p>Killers choose the person they targeted, or <b>No murder</b>. With more than one Killer, each also says whether they personally did the task. A solo Killer only needs to name their victim or choose No murder.</p>
    <p>For a murder to succeed:</p>
    <ul><li><b>One Killer:</b> complete the task on an Innocent and report that person.</li><li><b>Two Killers:</b> at least one must complete the task, and <b>both must report the same Innocent</b>. Different reports mean the murder fails.</li><li><b>Three Killers:</b> <b>at least two must report the same Innocent</b>. At least one of the Killers naming that person must have completed the task on them. A different target is shown as a failed attempt.</li></ul>
    <p>Two matching reports are still needed if a Killer misses the vote. Other targets are shown as failed attempts. A Killer cannot be murdered.</p>
    <h4>What counts as a murder attempt?</h4>
    <p>A Killer must complete the task on their chosen person. Starting the task, or simply naming someone, does not count. Each Killer may complete the task on only one person per round.</p>
    <p>A completed task still counts as an attempt if the murder fails because the Killer reports do not match. It can count even if the person did not notice or remember it. Play honestly and discuss any genuine mistake after the results.</p>
    <h4>What does “caught” mean?</h4>
    <p>The player with the most votes from Innocents is caught. Ties count too. If nobody gets a vote, nobody is caught.</p>
  </div></details>
  <details className="rules-section"><summary>Innocent points<ChevronDown size={18} aria-hidden="true"/></summary><div className="rules-section-body">
    <table><thead><tr><th>Your vote</th><th>Points</th></tr></thead><tbody><tr><td>Vote for a Killer</td><td>+4</td></tr><tr><td>Vote for another Innocent</td><td>−1</td></tr><tr><td>Correctly choose No killer this round (two players only)</td><td>+2</td></tr><tr><td>Choose No killer when there is a Killer</td><td>−1</td></tr><tr><td>Miss the vote</td><td>−2</td></tr></tbody></table>
    <p>With three or more players, getting the most votes from Innocents costs <b>1 extra point</b>, including ties. This penalty doesn’t apply in two-player rounds. Being murdered doesn’t cost points by itself.</p>
    <h4>Did someone try to murder you?</h4>
    <p>You’ll also answer <b>“Do you think someone tried to murder you this round?”</b></p>
    <table><thead><tr><th>Your answer</th><th>What happened</th><th>Points</th></tr></thead><tbody><tr><td>Yes</td><td>A Killer did the task on you</td><td>+1</td></tr><tr><td>Yes</td><td>Nobody did the task on you</td><td>−1</td></tr><tr><td>No</td><td>A Killer did the task on you</td><td>−1</td></tr><tr><td>No</td><td>Nobody did the task on you</td><td>0</td></tr></tbody></table>
    <p>These points are added to your vote score. A failed murder attempt counts if a Killer reports actually doing the task on you. Simply naming you doesn’t count.</p>
    <p>Choose <b>No killer this round</b> and this question is skipped, with no extra points or penalties. If you miss the vote, you only get the usual −2.</p>
  </div></details>
  <details className="rules-section"><summary>Killer points<ChevronDown size={18} aria-hidden="true"/></summary><div className="rules-section-body">
    <p>If a murder succeeds and you reported that victim, your points depend on whether you did the task yourself.</p>
    <table className="killer-scoring"><thead><tr><th>What happened</th><th>You did the task</th><th>You didn’t</th></tr></thead><tbody><tr><td>No Killer is caught</td><td>+6</td><td>+2</td></tr><tr><td>Another Killer is caught, but you escape</td><td>+4</td><td>0</td></tr><tr><td>You are caught</td><td>+1</td><td>0</td></tr><tr><td>No Innocents submit a vote</td><td>+4</td><td>0</td></tr></tbody></table>
    <p>The first row includes a <b>+2 team bonus</b>. You only get this bonus if no Killer is caught and at least one Innocent submits a vote. A No killer vote counts as a submission too.</p>
    <p>If several Killers do the task on the person who was murdered, each gets the full points for doing it.</p>
    <h4>If you don’t help with a successful murder</h4>
    <p>This includes a failed attempt, reporting a different victim or choosing No murder.</p>
    <table><tbody><tr><td>You escape</td><td>0</td></tr><tr><td>You are caught</td><td>−2</td></tr><tr><td>You miss your report</td><td>−2</td></tr></tbody></table>
    <p>Missing your report costs −2 even if you’re caught; there’s no second penalty for being caught.</p>
    <h4>Targeting another Killer by mistake</h4>
    <table><tbody><tr><td>You do the task on another Killer</td><td>−2 extra</td></tr><tr><td>Another Killer does the task on you</td><td>−1 extra</td></tr></tbody></table>
    <p>These penalties apply when the attacker reports doing the task. Just naming another Killer doesn’t count. Each attacker loses 2 points. The targeted Killer loses 1 point per round, even if several Killers target them. These penalties add to your other points.</p>
  </div></details>
  <details className="rules-section"><summary>Disputing a round<ChevronDown size={18} aria-hidden="true"/></summary><div className="rules-section-body">
    <p>If there is a genuine mistake or disagreement, any player from that round can choose <b>Dispute this round</b> before the next round starts. There is no need for the victim to approve every task.</p>
    <p>Discuss it together, then choose <b>Keep this round</b> or <b>Discard this round</b>. Only players from the disputed round can vote, including Killers and victims. Your choice is private and cannot be changed.</p>
    <p>The vote lasts up to <b>two minutes</b>. Discarding needs more than half of all players from that round, even if some do not vote. Either choice reaching that majority can finish the vote early.</p>
    <p>When everyone has voted or time runs out, a tied vote gives the admin one extra point for their submitted choice. That choice must still reach the required majority. In a two-player tie, the admin decides. If the admin did not play that round or does not vote, there is no extra point. The tie-breaker is fixed when the dispute opens, even if admin controls are passed on.</p>
    <p>Without a majority to discard, the round is kept. A discarded round earns no points or penalties. Earlier scores stay the same. The admin can then start a fresh round with new roles.</p>
    <p>There is one dispute vote per round. The next round and End game must wait until it finishes. Once the vote is settled, or the next round starts, that result is final.</p>
  </div></details>
  <details className="rules-section"><summary>Joining, sitting out and sharing a device<ChevronDown size={18} aria-hidden="true"/></summary><div className="rules-section-body">
    <p><b>Joining late:</b> wait until the next round to get a role. You can follow the countdown and results while you wait.</p>
    <p><b>Sitting out:</b> choose Sit out next round while the results are showing. You keep your points and can still watch the game.</p>
    <p><b>Leaving:</b> Leave game sits you out and takes you back to the join screen. Use your player code to return, then choose Play next round.</p>
    <p><b>Sharing a device:</b> use Switch player, then sign in with your own player code. Switching does not sit anyone out.</p>
    <p>The admin chooses a six-digit player code when creating the game. Other players get a generated code. Keep your code to sign back in. Keep your invite with your private player code to return. Share the invite only with people playing. Changes to who is playing take effect next round. The number of Killers adjusts automatically. At least two players must be ready before the admin can start another round.</p>
  </div></details>
  <details className="rules-section"><summary>Admin controls and ending the game<ChevronDown size={18} aria-hidden="true"/></summary><div className="rules-section-body">
    <p>The person who creates the game is the first admin. The current admin uses their own player code to access these controls:</p>
    <ul><li><b>Start game / Start next round:</b> choose Start for a normal round, or Start as final round for the last one. Everyone playing gets a new role. There is no time limit between rounds, apart from an open dispute vote.</li><li><b>Call court:</b> end the current round early and open voting.</li><li><b>Finish voting:</b> show results using the votes submitted so far. Players who haven’t submitted get the missed-vote penalty.</li><li><b>Pause / Resume:</b> stop or restart the timers and voting.</li><li><b>End game:</b> finish when the group is ready. Completed scores stay; an unfinished round earns no points.</li></ul>
    <p>When sitting out, the admin can keep these controls or pass them to another player. Before leaving, they must choose another admin or end the game. There is one admin at a time, and player codes stay the same.</p>
    <h4>A final round and a proper finish</h4>
    <p>When the admin chooses <b>Start next round</b>, they can choose <b>Start</b> or <b>Start as final round</b>. The same choice appears for <b>Start game</b> in the lobby. Everyone sees when a final round has started.</p>
    <p>After the final round, review the results and settle any dispute. The admin then chooses <b>Finish game</b> to confirm the winner and final standings. To continue, choose <b>Keep playing</b> and start another round. If the final round is discarded, choose how to start a new round, or end with the earlier scores.</p>
    <p>The highest total wins. Equal totals share a place. Only players who completed a counted round can win; players with no counted rounds are unranked. Rounds played includes completed rounds where you had a role, even if you missed the vote. Sitting out, joining late and unfinished or discarded rounds do not add to that count.</p>
    <p>Awards recognise the most successful murders personally completed, correct accusations of Killers and murder attempts correctly spotted. Accomplice reports and No killer votes are not correct accusations or completed murders. Only counted rounds contribute. Ties share an award, with no extra points.</p>
    <p>Games and scores expire 7 days after creation and are automatically deleted.</p>
  </div></details>
</div>;}
export default function Home(){
  const [screen,setScreen]=useState<'home'|'entrance'|'game'>('home');
  const [view,setView]=useState<Any>(null),[session,setSession]=useState<Any>(null),[modal,setModal]=useState<string|null>(null);
  const [taskToChange,setTaskToChange]=useState<Any>(null),[taskChangeError,setTaskChangeError]=useState('');
  const seenTaskRequest=useRef('');
  const [finalPlan,setFinalPlan]=useState<Any>(null),[roundToStart,setRoundToStart]=useState<Any>(null);
  const [disputeChoice,setDisputeChoice]=useState<'keep'|'discard'|null>(null);
  const [departureAction,setDepartureAction]=useState<'sitOut'|'leave'>('sitOut'),[replacementAdminId,setReplacementAdminId]=useState(''),[adminNotice,setAdminNotice]=useState<number|null>(null);
  const [name,setName]=useState(''),[gameName,setGameName]=useState(''),[gameCode,setGameCode]=useState(''),[passcode,setPasscode]=useState(''),[entryMode,setEntryMode]=useState<'choice'|'login'|'join'>('choice');
  const [inviteKey,setInviteKey]=useState(''),[entryGameName,setEntryGameName]=useState(''),[entryLoading,setEntryLoading]=useState(false),[adminPasscode,setAdminPasscode]=useState('');
  const [roundHours,setRoundHours]=useState(String(DEFAULT_ROUND_MINUTES/60)),[roundMinutes,setRoundMinutes]=useState('0'),[longRoundHours,setLongRoundHours]=useState('25'),[roundNotice,setRoundNotice]=useState<number|null>(null);
  const selectedRoundMinutes=(roundHours==='more'?Number(longRoundHours):Number(roundHours))*60+Number(roundMinutes);
  const resetRoundLength=()=>{setRoundHours(String(DEFAULT_ROUND_MINUTES/60));setRoundMinutes('0');setLongRoundHours('25');setAdminPasscode('');};
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[toast,setToast]=useState(''),[connected,setConnected]=useState(true);
  const [now,setNow]=useState(Date.now()),[offset,setOffset]=useState(0),[revealed,setRevealed]=useState(false),[choice,setChoice]=useState(''),[performed,setPerformed]=useState<boolean|null>(null),[suspectedAttempt,setSuspectedAttempt]=useState<boolean|null>(null),[saveCode,setSaveCode]=useState(false),[historyRound,setHistoryRound]=useState<number|null>(null);
  const current=useRef<Any>(null),demoGame=useRef<Any>(null),mutation=useRef(0),pending=useRef(false),lastRoleRound=useRef(''),latestView=useRef<Any>(null),polling=useRef<ReturnType<typeof createGamePoller>|null>(null),serverOffset=useRef(0);
  const accept=(v:Any)=>{const received=Date.now();latestView.current=v;serverOffset.current=v.serverTime-received;setNow(received);setOffset(serverOffset.current);setView(v);setConnected(true);polling.current?.updated();};
  const notify=(s:string)=>{setToast(s);setTimeout(()=>setToast(''),3500);};
  const storeSession=(s:Any)=>{if(current.current?.code!==s.code)void detachNotifications(current.current);current.current=s;setSession(s);try{sessionStorage.setItem(STORE,JSON.stringify(s));}catch{}};
  const forgetSession=()=>{void detachNotifications(current.current);seenTaskRequest.current='';setTaskToChange(null);setTaskChangeError('');setAdminNotice(null);setReplacementAdminId('');polling.current?.stop();polling.current=null;latestView.current=null;lastRoleRound.current='';setRoundNotice(null);current.current=null;setSession(null);try{sessionStorage.removeItem(STORE);}catch{}};
  function entrance(code='',key='',knownName=''){
    const generation=++mutation.current;forgetSession();demoGame.current=null;setView(null);setRevealed(false);setSaveCode(false);setChoice('');setPerformed(null);setSuspectedAttempt(null);setPasscode('');setName('');setGameCode(code);setInviteKey(key);setEntryGameName(knownName);setEntryMode('choice');setModal(null);setError('');setScreen('entrance');
    if(knownName){setEntryLoading(false);return;}
    if(!code&&!key){setEntryLoading(false);setError('Open an invite link or scan a game’s QR code.');return;}
    setEntryLoading(true);
    const query=new URLSearchParams({preview:'1',...(key?{invite:key}:{code})});
    fetch(`/api/game?${query}`,{cache:'no-store'}).then(async res=>{const data:Any=await res.json();if(!res.ok)throw new Error(data.error);if(generation!==mutation.current)return;setGameCode(data.code);setEntryGameName(data.name);}).catch(e=>{if(generation===mutation.current)setError(e instanceof Error?e.message:'Could not open the invite. Try again.');}).finally(()=>{if(generation===mutation.current)setEntryLoading(false);});
  }
  useEffect(()=>{
    const query=new URL(location.href).searchParams,key=query.get('invite'),legacy=query.get('game')||query.get('room');
    let saved:Any=null;try{const raw=sessionStorage.getItem(STORE);if(raw)saved=JSON.parse(raw);}catch{}
    const sameInvite=key!==null?saved?.inviteKey===key:legacy?saved?.code===legacy.toUpperCase():true;
    if(saved?.token&&saved.code&&sameInvite){current.current=saved;setSession(saved);load(saved,true);}
    else if(key!==null||legacy){entrance(legacy?.toUpperCase()||'',key||'');}
    const timer=setInterval(()=>setNow(Date.now()),1000);const hide=()=>{if(document.hidden){setRevealed(false);setModal(previous=>['code','changeMission','missionChange'].includes(previous||'')?null:previous);}};document.addEventListener('visibilitychange',hide);
    return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',hide);};
  },[]);
  useEffect(()=>{
    if(!('serviceWorker' in navigator))return;
    const message=(event:MessageEvent)=>{
      if(event.data?.type==='which-game')event.ports[0]?.postMessage({game:current.current?.code});
      if(event.data?.type==='roundtable-opened'&&event.data.game===current.current?.code)polling.current?.checkNow();
    };
    navigator.serviceWorker.addEventListener('message',message);return()=>navigator.serviceWorker.removeEventListener('message',message);
  },[]);
  useEffect(()=>{setRevealed(false);setChoice('');setPerformed(null);setSuspectedAttempt(null);setModal(previous=>['ballot','roundtable','finishVoting','changeMission','missionChange','roundStart'].includes(previous||'')?null:previous);},[view?.round,view?.phase]);
  useEffect(()=>{
    if(!view?.me.isAdmin){setAdminNotice(null);setModal(previous=>['adminHandover','roundtable','finishVoting','end','finalPlan','finishGame','roundStart'].includes(previous||'')?null:previous);return;}
    if(modal==='leave'){setDepartureAction('leave');setReplacementAdminId('');setModal('adminHandover');}
    const revision=view.me.adminRevision??0;if(!revision){setAdminNotice(null);return;}
    let acknowledged='';try{acknowledged=sessionStorage.getItem(`${STORE}.admin-notice.${view.code}.${view.me.id}`)||'';}catch{}
    setAdminNotice(acknowledged===String(revision)?null:revision);
  },[view?.code,view?.me.id,view?.me.isAdmin,view?.me.adminRevision]);
  useEffect(()=>{
    if(!view||view.phase!=='playing'||!view.me.active){setRoundNotice(null);return;}
    const key=`${view.code}:${view.round}:${view.me.id}`;
    if(lastRoleRound.current!==key){lastRoleRound.current=key;setRoundNotice(view.round);}
  },[view?.code,view?.round,view?.phase,view?.me.id,view?.me.active]);
  useEffect(()=>{setTaskToChange(null);setModal(previous=>previous==='changeMission'?null:previous);},[view?.secret?.mission?.id]);
  useEffect(()=>{
    if(!revealed){setModal(previous=>['changeMission','missionChange'].includes(previous||'')?null:previous);return;}
    const request=view?.secret?.missionChange;
    if(screen!=='game'||view?.phase!=='playing'||view?.secret?.role!=='traitor'||request?.status!=='open'||modal&&modal!=='changeMission')return;
    const key=`${view.code}:${view.round}:${request.id}`;
    if(seenTaskRequest.current!==key){seenTaskRequest.current=key;setError('');setTaskChangeError('');setModal('missionChange');}
  },[screen,view?.code,view?.round,view?.phase,view?.secret?.role,view?.secret?.missionChange?.id,view?.secret?.missionChange?.status,revealed,modal]);

  useEffect(()=>{setModal(previous=>(previous==='openDispute'&&(view?.phase!=='results'||view?.dispute))||(previous==='disputeVote'&&(view?.dispute?.status!=='open'||view?.dispute?.myVote))||(['end','roundStart'].includes(previous||'')&&view?.dispute?.status==='open')?null:previous);setDisputeChoice(null);},[view?.round,view?.phase,view?.dispute?.status,view?.dispute?.myVote]);
  useEffect(()=>{setModal(previous=>(previous==='finalPlan'&&(view?.phase==='ended'||!view?.me.isAdmin))||(previous==='finishGame'&&(view?.phase!=='results'||view?.finalRound!==view?.round||view?.dispute?.status==='open'||view?.results?.review?.status==='discarded'))?null:previous);},[view?.round,view?.phase,view?.finalRound,view?.me.isAdmin,view?.dispute?.status,view?.results?.review?.status]);
  useEffect(()=>{if(roundNotice===null)return;const id=setTimeout(()=>setRoundNotice(null),15000);return()=>clearTimeout(id);},[roundNotice]);
  useEffect(()=>{
    if(!session||session.demo||screen!=='game')return;
    const poller=createGamePoller({getState:()=>latestView.current,refresh:signal=>load(session,false,signal),isVisible:()=>!document.hidden,isBusy:()=>pending.current,now:()=>Date.now()+serverOffset.current});
    polling.current=poller;
    poller.checkNow();
    const visibility=()=>poller.visibilityChanged(),online=()=>poller.checkNow();
    document.addEventListener('visibilitychange',visibility);window.addEventListener('online',online);
    return()=>{poller.stop();if(polling.current===poller)polling.current=null;document.removeEventListener('visibilitychange',visibility);window.removeEventListener('online',online);};
  },[session,screen]);
  useEffect(()=>{if(!session?.demo||screen!=='game')return;const id=setInterval(()=>{tick(demoGame.current);setView(publicView(demoGame.current,'demo-me'));},1000);return()=>clearInterval(id);},[session,screen]);
  async function load(s:Any,resume=false,signal?:AbortSignal){
    if(signal?.aborted)return 'ignored';
    const generation=mutation.current,request=new AbortController(),abort=()=>request.abort();
    signal?.addEventListener('abort',abort,{once:true});
    const timeout=setTimeout(abort,POLL_REQUEST_TIMEOUT_MS);
    try{
      const res=await fetch(`/api/game?code=${encodeURIComponent(s.code)}`,{headers:{Authorization:`Bearer ${s.token}`},cache:'no-store',signal:request.signal});
      const data:Any=await res.json();
      if(signal?.aborted||current.current?.token!==s.token||generation!==mutation.current)return 'ignored';
      if(!res.ok){if([401,404,410].includes(res.status)){entrance(s.code,s.inviteKey||'',s.gameName||'');setError(data.error);return 'ignored';}throw new Error(data.error);}
      accept(data);if(resume)setScreen('game');return 'success';
    }catch{
      if(signal?.aborted||current.current?.token!==s.token||generation!==mutation.current)return 'ignored';
      setConnected(false);return 'failed';
    }finally{clearTimeout(timeout);signal?.removeEventListener('abort',abort);}
  }
  async function enter(type:'create'|'join'|'login'){
    if(busy)return;setBusy(true);setError('');mutation.current++;
    try{const res=await fetch('/api/game',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type,name,gameName,code:gameCode,passcode,...(type==='create'?{roundMinutes:selectedRoundMinutes,adminPasscode}:{invite:inviteKey||undefined})})});const data:Any=await res.json();if(!res.ok)throw new Error(data.error);storeSession({token:data.token,code:data.view.code,passcode:data.passcode,inviteKey:data.view.inviteKey,gameName:data.view.name});accept(data.view);setSaveCode(type!=='login');setScreen('game');setModal(null);setPasscode('');setHistoryRound(null);history.replaceState(null,'',`${location.pathname}?${data.view.inviteKey?'invite':'game'}=${encodeURIComponent(data.view.inviteKey||data.view.code)}`);}
    catch(e){setError(e instanceof Error?e.message:'Could not enter the game. Try again.');}finally{setBusy(false);}
  }
  async function act(action:Any){
    if(busy||pending.current)return false;const taskAction=['changeMission','requestMissionChange','respondMissionChange'].includes(action.type);setBusy(true);pending.current=true;mutation.current++;if(taskAction)setTaskChangeError('');else setError('');
    try{if(session?.demo){applyAction(demoGame.current,'demo-me',action);accept(publicView(demoGame.current,'demo-me'));}
      else{const res=await fetch('/api/game',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.token}`},body:JSON.stringify({...action,code:session.code})});const data:Any=await res.json();if(!res.ok)throw new Error(data.error);accept(data);}
      if(['requestMissionChange','respondMissionChange'].includes(action.type))return true;
      if(action.type==='setFinalRound'){notify(action.enabled?'The next round is marked as the final round.':'The final-round plan has been cancelled.');}if(action.type==='disputeVote'){notify('Your dispute vote is locked.');}if(action.type==='changeMission'){setTaskToChange(null);notify('Murder task changed.');}if(action.type==='ballot'){setRevealed(false);notify('Your submission is locked.');}if(action.type==='leave'){entrance(session.code,v.inviteKey||'',v.name);notify('You have left the game. Use your player code to return.');return true;}if(action.newAdminId)notify(`${v.players.find((p:Any)=>p.id===action.newAdminId)?.name||'The chosen player'} is now the admin.`);setModal(null);return true;
    }catch(e){(taskAction?setTaskChangeError:setError)(e instanceof Error?e.message:'Something went wrong. Try again.');return false;}finally{setBusy(false);pending.current=false;if(['requestMissionChange','respondMissionChange'].includes(action.type))polling.current?.checkNow();}
  }
  async function copy(text:string,message:string){try{await navigator.clipboard.writeText(text);notify(message);}catch{setError(`Copy this: ${text}`);}}
  async function shareInvite(){if(canInvite)await copy(inviteUrl,'Invite link copied.');}
  function demo(){
    mutation.current++;forgetSession();const g:Any=makeGame('DEMO24','Saturday game',{id:'demo-me',name:'You'});
    ['Alice','Ben','Charlie','Isla','Jamie','Grace','Noah'].forEach((n,i)=>addPlayer(g,{id:`demo-${i}`,name:n}));startRound(g,Date.now(),n=>n-1);
    demoGame.current=g;setSession({demo:true,code:g.code,passcode:'DEMO'});accept(publicView(g,'demo-me'));setSaveCode(false);setScreen('game');setModal(null);setError('');
  }
  function answerDemoTaskRequest(acceptChange:boolean){
    const g=demoGame.current,request=g?.missionChangeRequest;if(!request||request.status!=='open')return;
    try{
      for(const id of request.voters)if(g.missionChangeRequest.status==='open'&&!Object.hasOwn(g.missionChangeRequest.votes,id))applyAction(g,id,{type:'respondMissionChange',round:g.round,missionId:g.mission.id,requestId:request.id,accept:acceptChange});
      accept(publicView(g,'demo-me'));setTaskChangeError('');
    }catch(e){setTaskChangeError(e instanceof Error?e.message:'Could not answer this request.');}
  }
  function advanceDemo(){
    const g=demoGame.current;if(g.pausedAt!==null){notify('Resume the demo before moving on.');return;}
    if(g.phase==='playing'){g.deadline=Date.now()-1;tick(g);}
    else if(g.phase==='voting'){
      const reported=g.active.find((id:string)=>g.roles[id]==='traitor'&&g.ballots[id]?.targetId&&g.roles[g.ballots[id].targetId]==='faithful');
      const victim=reported?g.ballots[reported].targetId:g.active.find((id:string)=>g.roles[id]==='faithful'),suspect=g.active.find((id:string)=>g.roles[id]==='traitor');
      for(const id of g.active)if(g.phase==='voting'&&!g.ballots[id]){const killer=g.roles[id]==='traitor',target=killer?victim:suspect;applyAction(g,id,{type:'ballot',target,...(killer?{performed:g.traitorCount===1||!g.active.some((other:string)=>g.roles[other]==='traitor'&&g.ballots[other]?.targetId===victim&&g.ballots[other].performed===true)}:{suspectedAttempt:id===victim})});}
    }else if(g.phase==='results'){openRoundStart();return;}else{demo();return;}
    accept(publicView(g,'demo-me'));setError('');
  }
  const v=view,me=v?.me,phase=v?.phase,players=v?.players||[],gameNow=v?.paused?v.pausedAt:now+offset;
  const inviteUrl=v&&typeof window!=='undefined'?`${window.location.origin}/?${v.inviteKey?'invite':'game'}=${encodeURIComponent(v.inviteKey||v.code)}`:'';
  const canInvite=!!inviteUrl&&!session?.demo&&phase!=='ended';
  const adminCandidates=players.filter((p:Any)=>p.id!==me?.id&&!p.left),replacementAdmin=adminCandidates.find((p:Any)=>p.id===replacementAdminId);
  const openDeparture=(action:'sitOut'|'leave')=>{if(busy)return;setError('');setDepartureAction(action);setReplacementAdminId('');setModal(me.isAdmin?'adminHandover':'leave');};
  const changeReadiness=()=>{if(busy)return;if(me.nextActive&&me.isAdmin)openDeparture('sitOut');else void act({type:'ready',ready:!me.nextActive});};
  const dismissAdminNotice=()=>{try{sessionStorage.setItem(`${STORE}.admin-notice.${v.code}.${me.id}`,String(adminNotice));}catch{}setAdminNotice(null);};
  const clock=phase==='playing'?timeLeft(v.deadline,gameNow):phase==='voting'&&v.voteDeadline?timeLeft(v.voteDeadline,gameNow):null;
  const modern=(v?.roundRulesVersion??1)>=2,penaltyRules=(v?.roundRulesVersion??1)>=3,awarenessRules=(v?.roundRulesVersion??1)>=AWARENESS_RULES_VERSION,killer=v?.secret?.role==='traitor';
  const twoPlayer=v?.roundMode==='two-player',soloKiller=killer&&(twoPlayer||v?.traitorCount===1);
  const taskChangesRemaining=killer?(v?.secret?.missionChangesRemaining??MAX_MISSION_CHANGES):0;
  const missionRequest=v?.secret?.missionChange??null;
  const hidePrivateTask=()=>{setRevealed(false);setModal(null);setError('');setTaskChangeError('');};
  const showPrivate=()=>{setRevealed(true);polling.current?.checkNow();};
  const needsParticipation=modern&&killer&&!soloKiller&&v?.traitorCount>1&&!!choice&&choice!=='none';
  const needsAwareness=awarenessRules&&v?.secret?.role==='faithful';
  const asksAwareness=needsAwareness&&choice!=='no-killer';
  const chooseVictim=(id:string)=>{if(id!==choice){setChoice(id);setPerformed(null);setSuspectedAttempt(null);}};
  const ballotHint=v?.paused?'Voting is paused. Wait for the admin to resume.':!choice
    ?killer?'Choose a person or No murder to continue.':twoPlayer?'Choose the other player or No killer this round to continue.':'Choose the player you suspect to continue.'
    :needsParticipation&&performed===null?'Answer whether you personally completed the task to continue.'
    :asksAwareness&&suspectedAttempt===null?'Answer whether someone tried to murder you to continue.':null;
  const needsBallotAnswer=!!choice&&(needsParticipation&&performed===null||asksAwareness&&suspectedAttempt===null);
  const ballotAction=()=>({type:'ballot',target:choice==='none'||choice==='no-killer'?null:choice,...(modern&&killer?{performed:choice==='none'?false:soloKiller?true:performed}:{}),...(asksAwareness?{suspectedAttempt}:{})});
  const reviewOpen=phase==='results'&&v?.dispute?.status==='open';
  const myResult=v?.results?.players.find((p:Any)=>p.id===me?.id);
  const results=historyRound!==null?v?.history.find((h:Any)=>h.round===historyRound):v?.results;
  const scoreList=v?.standings??[...players].sort((a:Any,b:Any)=>b.score-a.score||a.name.localeCompare(b.name));
  const isFinalRound=!!v?.finalRound&&v.finalRound===v.round;
  const discardedFinal=isFinalRound&&v?.results?.review?.status==='discarded';
  const finalResults=phase==='results'&&isFinalRound&&!discardedFinal;
  const cancelFinal=()=>{setError('');setFinalPlan({round:v.round,expectedFinalRound:v.finalRound??null,enabled:false});setModal('finalPlan');};
  const openRoundStart=()=>{if(busy||pending.current)return;setError('');setRoundToStart({type:phase==='lobby'?'start':'nextRound',round:v.round,expectedFinalRound:v.finalRound??null});setModal('roundStart');};
  const startRoundHint=!me?.isAdmin?'Only the admin can start a round.':reviewOpen?'Wait for the dispute vote to finish.':v?.paused?'Resume the game before starting a round.':v?.readyCount<MIN_PLAYERS?'At least two players need to be ready.':!roundToStart||roundToStart.round!==v?.round||roundToStart.expectedFinalRound!==(v?.finalRound??null)?'The round has changed. Close this window and try again.':null;
  const finalPlanStale=!finalPlan||finalPlan.round!==v?.round||finalPlan.expectedFinalRound!==(v?.finalRound??null);
  const closeModal=()=>{if(!busy){setModal(null);setTaskToChange(null);setError('');}};
  const openRules=()=>{setError('');setModal('rules');};
  return <div className={`site-shell ${screen==='game'&&phase==='playing'&&me?.active&&revealed&&!saveCode?'private-role-open':''}`}>
    <header className="site-header"><button className="logo-button" onClick={()=>{setScreen('home');setRevealed(false);setError('');}} aria-label="In Plain Sight home"><Logo/></button><div className="header-actions">{screen==='game'?<><button aria-label="Switch player" className="switch-button" onClick={()=>entrance(session.code,v.inviteKey||'',v.name)}><LogOut size={14}/><span>Switch player</span></button><button className="icon-button menu-trigger" onClick={()=>setModal('menu')} aria-label="Game menu"><MoreHorizontal size={23}/></button></>:<button aria-label="How to play" className="help-button" onClick={openRules}><HelpCircle size={17}/><span>How to play</span></button>}</div></header>
    {screen==='home'&&<main className="landing"><section className="hero"><div className="hero-copy"><h1>In Plain<br/>{' '}<em>Sight</em></h1><p className="hero-description"><strong>Kill or be killed.</strong><span>A small favour could hide a secret murder. A social deduction game of everyday actions and suspicious intentions, where Killers carry out secret tasks and Innocents try to spot them. Play with friends and family at a get-together, over an evening or across a weekend.</span></p><div className="hero-buttons"><button className="button primary" onClick={()=>{setName('');setGameName('');resetRoundLength();setError('');setModal('create');}}>Create a game <ArrowRight size={17}/></button></div><button className="demo-link" onClick={demo}><Play size={12}/> Try demo</button>{session&&!session.demo&&v&&<button className="return-link" onClick={()=>setScreen('game')}>Return as {me.name} <ArrowRight size={14}/></button>}<div className="hero-facts"><span><Users size={15}/> 2–30 players</span></div></div></section></main>}
    {screen==='entrance'&&<main className="entrance-main"><button className="text-button back-link" onClick={()=>{setScreen('home');setError('');}}><ArrowLeft size={15}/> Back</button><section className="panel entrance-panel"><h1>{entryGameName||'Game invite'}</h1>{entryLoading?<p role="status"><LoaderCircle className="spin" size={17}/> Opening invite…</p>:entryGameName?<><p>{entryMode==='login'?'Enter your private player code.':entryMode==='join'?'Enter your name to join.':'Join this game or return with your player code.'}</p><form onSubmit={e=>{e.preventDefault();if(entryMode==='choice')setEntryMode('join');else enter(entryMode);}}>
      {entryMode==='choice'?<div className="entry-options"><button type="button" className="button join-highlight full" onClick={()=>{setEntryMode('join');setError('');}}><Users size={16}/> Join as a new player</button><button type="button" className="button secondary full" onClick={()=>{setEntryMode('login');setError('');}}><KeyRound size={16}/> Enter my player code</button></div>:<><label htmlFor="player-entry">{entryMode==='login'?'Your private player code':'Your name'}</label><input id="player-entry" type={entryMode==='login'?'password':'text'} className={entryMode==='login'?'code-input':''} value={entryMode==='login'?passcode:name} onChange={e=>entryMode==='login'?setPasscode(e.target.value.replace(/\D/g,'').slice(0,6)):setName(e.target.value)} placeholder={entryMode==='login'?'000000':'Alex'} inputMode={entryMode==='login'?'numeric':'text'} autoComplete="off" minLength={entryMode==='login'?6:1} maxLength={entryMode==='login'?6:24} required/>{error&&<p role="alert" className="form-error">{error}</p>}<button type="submit" disabled={busy} className={`button ${entryMode==='join'?'join-highlight':'primary'} full`}>{busy?<LoaderCircle className="spin" size={17}/>:entryMode==='login'?'Return to my game':'Join the game'}{!busy&&<ArrowRight size={17}/>}</button><button className="text-button full" type="button" onClick={()=>{setEntryMode('choice');setPasscode('');setError('');}}>Choose another option</button></>}
      {entryMode==='choice'&&error&&<p className="form-error" role="alert">{error}</p>}</form><p className="fine">{entryMode==='join'?'You’ll receive a role when the next round starts.':'Keep this invite and your player code to return.'}</p></>:error&&<p className="form-error" role="alert">{error}</p>}<p className="fine retention-note">Games and scores expire 7 days after creation and are automatically deleted.</p></section></main>}
    {screen==='game'&&v&&<main className="game-main">
      {session?.demo&&<div className="demo-banner"><span><Sparkles size={15}/><b>DEMO</b></span>{phase!=='results'&&<button onClick={advanceDemo}>{phase==='playing'?'Call court':phase==='voting'?'Fill remaining submissions':'Restart demo'} <ArrowRight size={14}/></button>}</div>}
      {!connected&&!session?.demo&&<div className="alert" role="status">Reconnecting. The information below may be out of date.</div>}
      <div className="game-heading"><div><span className={`eyebrow ${phase==='lobby'||phase==='ended'?'':'game-name'}`}>{phase==='lobby'?'LOBBY':phase==='ended'?'GAME ENDED':v.name}</span><h1 className={phase==='lobby'||phase==='ended'?'':'round-heading'}>{phase==='lobby'||phase==='ended'?v.name:`Round ${v.round}`}</h1></div><div className="player-identity"><span className="avatar">{initials(me.name)}</span><span>{me.name}<small>{me.isAdmin?'ADMIN · ':''}{me.score} POINTS</small></span></div></div>
      {adminNotice!==null&&me.isAdmin&&phase!=='ended'&&<div className="round-notice" role="status"><Crown size={18}/><b>You are now the admin.</b><button className="icon-button" aria-label="Dismiss admin notice" onClick={dismissAdminNotice}><X size={16}/></button></div>}
      {roundNotice!==null&&phase==='playing'&&me.active&&!saveCode&&<div className="round-notice" role="status"><Sparkles size={18}/><b>Round {roundNotice} · Check your role</b><button className="icon-button" aria-label="Dismiss new round notice" onClick={()=>setRoundNotice(null)}><X size={16}/></button></div>}
      {v.paused&&<div className="pause-banner"><Pause size={17}/><div><b>Game paused</b><span>Waiting for the admin to resume.</span></div></div>}
      {error&&<div className="alert" role="alert">{error}<button className="icon-button" onClick={()=>setError('')} aria-label="Dismiss error"><X size={15}/></button></div>}
      {saveCode?<section className="panel code-welcome"><div className="round-icon"><KeyRound size={28}/></div><h2>Save your player code</h2><p>Use this code to sign in on any device.</p><button className="private-code" onClick={()=>copy(session.passcode,'Your player code is copied.')} aria-label={`Your private player code ${session.passcode}. Copy code`}>{session.passcode}<Copy size={17}/></button><p className="fine">{me.isAdmin?'Keep it private. It also gives admin access.':'Keep this code private.'}</p><button className="button primary" onClick={()=>setSaveCode(false)}>Continue <Check size={17}/></button></section>:<>
      {canInvite&&phase!=='lobby'&&<section className="game-invite-actions" aria-label="Invite players"><button className="button secondary" onClick={()=>setModal('invite')}><QrCode size={16}/> Show QR code</button><button className="button secondary" onClick={shareInvite}><LinkIcon size={14}/> Share link</button></section>}
      {me.isAdmin&&phase!=='ended'&&<><section className="admin-toolbar" aria-label="Admin controls"><span className="admin-toolbar-label"><Crown size={14}/> Admin</span><div className={`admin-toolbar-actions ${['playing','voting'].includes(phase)||v.paused?'three-actions':'two-actions'}`}>
        {phase==='lobby'?<button className="button primary" disabled={busy||v.readyCount<MIN_PLAYERS||v.paused} onClick={openRoundStart}><Play size={14}/> Start game</button>:<>
          {phase==='results'&&(finalResults?<button className="button primary" disabled={busy||v.paused||reviewOpen} onClick={()=>{setError('');setModal('finishGame');}}><Trophy size={14}/> Finish game</button>:<button className="button primary" disabled={busy||v.readyCount<MIN_PLAYERS||v.paused||reviewOpen} onClick={openRoundStart}><Play size={14}/> Start next round</button>)}
          {phase==='playing'&&<button className="button secondary" disabled={busy||v.paused} onClick={()=>setModal('roundtable')}><Vote size={14}/> Call court</button>}
          {phase==='voting'&&<button className="button secondary" disabled={busy||v.paused} onClick={()=>setModal('finishVoting')}><CheckCheck size={14}/> Finish voting</button>}
          {(phase!=='results'||v.paused)&&<button className="button secondary" disabled={busy} onClick={()=>act({type:v.paused?'resume':'pause'})}>{v.paused?<Play size={14}/>:<Pause size={14}/>} {v.paused?'Resume':'Pause'}</button>}
        </>}
        {finalResults?<button className="button secondary" disabled={busy||reviewOpen} onClick={openRoundStart}>Keep playing</button>:<button className="button secondary end-game" disabled={busy||reviewOpen} onClick={()=>setModal('end')}>End game</button>}
      </div></section>{reviewOpen&&<p className="admin-dispute-note">Wait for the dispute vote to finish before starting another round or ending the game.</p>}</>}
      {v.finalRound&&phase!=='ended'&&<div className="final-round-banner" role="status"><Flag size={17}/><div><b>{isFinalRound?'Final round':`Round ${v.finalRound} will be the final round`}</b><span>{discardedFinal?'This round was discarded. Start another round with new roles, or end the game with the earlier scores.':isFinalRound?phase==='results'?'Review the results before the admin confirms the finish.':'One last round. Every point counts.':phase==='lobby'?'The game will finish after its first round.':phase==='results'?'The next round will be the last. The admin starts it when everyone is ready.':'Finish this round as usual. The next round will be the last.'}</span></div>{me.isAdmin&&!finalResults&&<button className="text-button" disabled={busy||reviewOpen} onClick={cancelFinal}>{isFinalRound?'Keep playing':'Cancel plan'}</button>}</div>}
      {phase==='lobby'&&<section className="panel lobby-panel"><div className="round-icon"><Users size={29}/></div><h2>Waiting for players</h2><p>{me.isAdmin?'Share the invite link or QR code. Start when everyone has joined.':'Share the invite link or QR code with people playing.'}</p><div className="lobby-invite-actions"><button className="button secondary" disabled={!canInvite} onClick={()=>setModal('invite')}><QrCode size={16}/> Show QR code</button><button className="button secondary" disabled={!canInvite} onClick={shareInvite}><LinkIcon size={14}/> Share link</button></div><div className="lobby-players">{players.map((p:Any)=><span key={p.id} className={p.nextActive?'':'sitting-out'}><span className="avatar">{initials(p.name)}</span>{p.name}</span>)}</div><p className="ready-summary"><b>{v.readyCount} ready</b>{v.readyCount>=MIN_PLAYERS?(v.readyCount===2?' · two-player rules: 0 or 1 Killer':` · ${v.nextTraitorCount} killer${v.nextTraitorCount===1?'':'s'} in the next round`):' · at least 2 needed'}</p>{!me.isAdmin&&<span className="waiting-pill"><span className="live-dot"/> Waiting for the admin</span>}{!me.nextActive&&<button className="text-button" disabled={busy} onClick={()=>act({type:'ready',ready:true})}>I’m ready to play</button>}</section>}
      {(v.roundRulesVersion??1)<ROUND_RULES_VERSION&&['playing','voting'].includes(phase)&&<p className="fine legacy-rules">This round uses the previous rules. Updated rules start next round.</p>}
      {twoPlayer&&['playing','voting'].includes(phase)&&<p className="fine round-mode-note">Two-player round · 0 or 1 Killer</p>}{['playing','voting'].includes(phase)&&<section className="clock-panel"><div><span className="eyebrow">{phase==='playing'?'COURT IN':v.voteDeadline?'VOTING CLOSES IN':'WAITING FOR SUBMISSIONS'}</span>{clock?<strong className={v.paused?'paused-clock':''}>{clock}</strong>:<strong className="submission-clock">{v.submittedCount}<span> / {v.activeCount}</span></strong>}</div>{phase==='voting'&&<p>{v.voteDeadline?'Voting ends when everyone submits or the timer expires.':`The timer starts at ${Math.ceil(v.activeCount/2)} submission${Math.ceil(v.activeCount/2)===1?'':'s'}.`}</p>}{phase==='voting'&&<div className="vote-progress"><div className="progress-track"><span style={{width:`${v.submittedCount/v.activeCount*100}%`}}/></div><span>{v.submittedCount} of {v.activeCount} submitted</span></div>}</section>}
      {!me.active&&['playing','voting'].includes(phase)?<section className="panel waiting-panel"><div className="round-icon"><Hourglass size={28}/></div><h2>{isFinalRound?'Watching the final round':me.nextActive?'Joining next round':'Sitting out'}</h2><p>{phase==='playing'?'Waiting for this round to finish.':'Waiting for the current round’s votes.'}</p><p className="fine">{isFinalRound?'You can follow the results. If the group keeps playing, you can join the next round.':me.nextActive?'You will get your role when the admin starts the next round.':'Your score is saved.'}</p>{!me.nextActive&&<button className="button secondary" disabled={busy} onClick={()=>act({type:'ready',ready:true})}>Play next round</button>}</section>:
      phase==='playing'&&<section className="role-card">
        <div className="private-heading"><span className="eyebrow"><KeyRound size={12}/> PRIVATE ROLE</span><div className="role-heading-actions"><span>ROUND {v.round}</span>{revealed&&<button className="text-button role-hide-inline" onClick={()=>setRevealed(false)}><EyeOff size={15}/> Hide role</button>}</div></div>
        {!revealed?<div className="sealed-role"><div className="seal"><Mark/></div><h2>Your role</h2><p>Keep your screen private.</p><button className="button primary" onClick={showPrivate}><Eye size={16}/> Show role</button></div>:<>
          <div className="role-reveal">{killer?<Swords size={28}/>:<Shield size={28}/>}<h2 className={killer?'killer-text':''}>{killer?'Killer':'Innocent'}</h2>{killer&&<p>{v.secret.otherTraitors?`${v.secret.otherTraitors} other killer${v.secret.otherTraitors===1?'':'s'}`:'You are the only killer.'}</p>}</div>
          {killer?<>
            <div className="secret-details">
              {v.secret.signal&&<section><span className="eyebrow">RECOGNITION SIGNAL</span>{v.secret.signal.reply?<><p className="signal-question">“{v.secret.signal.prompt}”</p><p>Reply:</p><blockquote>“{v.secret.signal.reply}”</blockquote><p className="fine">All killers have this question and reply.</p></>:<><p className="signal-instruction">{v.secret.signal.prompt}</p><p className="fine">Use this shared signal to find the other killers.</p></>}</section>}
              <section><span className="eyebrow">MURDER TASK</span><h3>{v.secret.mission.title}</h3><p>{v.secret.mission.instruction}</p>
                <div className="mission-note">{soloKiller?'Complete the task, then report your victim at Court.':<>
                  <p>At least one Killer must complete the task.</p>
                  <p className="matching-report-rule"><b>{v.traitorCount===2?'Both Killers must report the same victim at Court.':'At least two of the three Killers must report the same victim at Court.'}</b>{v.traitorCount===2?' Otherwise, the murder fails.':' At least one of the Killers naming that victim must have completed the task on them.'}</p>
                  {modern&&<p>Each Killer must say whether they personally completed the task.</p>}
                </>}</div>
                <p className="fine">Complete the task on only one person per round. Keep the victim secret until results.</p>
                <TaskChangeControls solo={soloKiller} remaining={taskChangesRemaining} request={missionRequest} disabled={busy||v.paused} onRequest={()=>{setError('');setTaskChangeError('');setTaskToChange({round:v.round,missionId:v.secret.mission.id,requestRevision:v.secret.missionChangeRevision??0});setModal('changeMission');polling.current?.checkNow();}} onReview={()=>{setError('');setTaskChangeError('');setModal('missionChange');polling.current?.checkNow();}}/>
              </section>
            </div>
            <details className="role-rules"><summary>Scoring and rules<ChevronDown size={18} aria-hidden="true"/></summary><div className="role-rules-body">
              {modern?<><p>Carry out a successful murder: <b>+4</b> if you escape, or <b>+1</b> if you’re caught. Simply reporting the same victim earns <b>0</b>.</p><p>There’s a <b>+2 team bonus</b> for everyone who reports the successful murder if no Killer is caught and at least one Innocent votes.</p><p>Without a successful murder, you earn <b>0</b> if you escape or lose <b>2 points</b> if caught. Missing your report loses <b>2 points</b>.</p></>:<p>This round uses previous scoring rules. See How to play for the current rules.</p>}
              {!soloKiller&&<p>Each killer reports whether they personally completed the task. Agree on your victim before Court.</p>}
              {penaltyRules&&v.traitorCount>1&&<p>Completing the task on another killer costs you <b>2 extra points</b>. A killer targeted this way loses <b>1 extra point</b>, once per round.</p>}
              <p>The Killers share two task changes per round before Court. {soloKiller?'You can change the task directly.':'Every Killer must accept, including all three in a three-Killer round.'} Only change it before anyone has completed it. You cannot return to an earlier task. {!soloKiller&&'A rejection stops all further requests that round.'}</p>
              <button className="text-button" onClick={openRules}>Full rules and scoring <ArrowRight size={14}/></button>
            </div></details>
          </>:<>
            <div className="innocent-note"><span className="eyebrow">AT COURT</span>
              {twoPlayer?<><p>Is there a Killer, or are you both Innocent? Be ready for an attempt on your life.</p><p>Vote for the other player or choose <b>No killer this round</b>.</p></>:<p>Watch for suspicious behaviour, then vote for the player you suspect is a Killer.</p>}
              {awarenessRules&&<p>{twoPlayer?'If you accuse the other player, you’ll also answer':'You’ll also answer'} whether you think someone tried to murder you.</p>}
              <p className="fine">You can still vote if you’ve been murdered.</p>
            </div>
            <details className="role-rules"><summary>Scoring and rules<ChevronDown size={18} aria-hidden="true"/></summary><div className="role-rules-body">
              <p>A correct vote earns <b>4 points</b>. A wrong vote loses <b>1 point</b>. Missing the vote loses <b>{modern?'2 points':'1 point'}</b>.</p>
              {twoPlayer?<p>Correctly choose <b>No killer this round</b> to earn <b>2 points</b>. Choosing it skips the murder-attempt question.</p>:<p>Receiving the most accusations costs <b>1 extra point</b>, including ties.</p>}
              {awarenessRules&&<p>Spotting an attempt on your life earns <b>1 extra point</b>; get it wrong and lose <b>1 point</b>. Saying No when nobody tries earns <b>0</b>.</p>}
              <button className="text-button" onClick={openRules}>Full rules and scoring <ArrowRight size={14}/></button>
            </div></details>
          </>}
          <button className="text-button full hide-secret role-hide-action" onClick={()=>setRevealed(false)}><EyeOff size={16}/> Hide role</button>
        </>}
      </section>}
      {phase==='voting'&&me.active&&<section className="panel ballot-panel"><div className="private-heading"><span className="eyebrow"><KeyRound size={12}/> PRIVATE BALLOT</span></div>{!revealed?<div className="sealed-ballot"><div className="round-icon">{v.myBallot?<CheckCheck size={28}/>:<Vote size={28}/>}</div><h2>{v.myBallot?'Submitted':'Court'}</h2><p>{v.myBallot?'Waiting for votes.':'Keep your screen private.'}</p><button className="button primary" onClick={showPrivate}><Eye size={16}/>{v.myBallot?'View my submission':'Open my ballot'}</button></div>:<><div className="ballot-intro"><span className="eyebrow">YOU ARE {killer?'A':'AN'} {roleLabel(v.secret.role).toUpperCase()}</span><h2>{killer?modern&&!soloKiller?'Who did the killers murder?':'Who did you murder?':twoPlayer?'Is there a Killer?':'Who do you suspect?'}</h2><p>{killer?modern&&soloKiller?'Choose the person you completed the task on, or No murder.':'Choose a victim or No murder. A majority must report the same Innocent.':twoPlayer?'Choose the other player if you suspect them, or No killer this round.':'Choose the player you suspect.'}</p></div>{v.myBallot?<div className="locked-detail"><CheckCheck size={24}/><p>{v.myBallot.targetId?<>You {v.myBallot.kind==='report'?'reported':'accused'} <b>{players.find((p:Any)=>p.id===v.myBallot.targetId)?.name}</b>.</>:v.myBallot.kind==='accusation'?<>You chose <b>No killer this round</b>.</>:<>You reported <b>No murder</b>.</>}</p>{modern&&killer&&<p className="participation-summary">{v.myBallot.performed?'You personally completed the task.':'You did not personally complete the task.'}</p>}{needsAwareness&&typeof v.myBallot.suspectedAttempt==='boolean'&&<p className="participation-summary">You think someone tried to murder you: <b>{v.myBallot.suspectedAttempt?'Yes':'No'}</b>.</p>}<span className="fine">Your choice is final.</span></div>:<><div className="ballot-list" role="radiogroup" aria-label={killer?'Choose your murder report':twoPlayer?'Choose your vote':'Choose your accusation'}>{players.filter((p:Any)=>p.active&&p.id!==me.id).map((p:Any)=><button className={`ballot ${choice===p.id?'selected':''}`} role="radio" aria-checked={choice===p.id} key={p.id} disabled={busy||v.paused} onClick={()=>chooseVictim(p.id)}><span className="avatar">{initials(p.name)}</span><b>{p.name}</b><span className="radio-dot">{choice===p.id&&<Check size={12}/>}</span></button>)}{twoPlayer&&!killer&&<button className={`ballot no-murder ${choice==='no-killer'?'selected':''}`} role="radio" aria-checked={choice==='no-killer'} disabled={busy||v.paused} onClick={()=>chooseVictim('no-killer')}><span className="avatar"><Shield size={16}/></span><b>No killer this round</b><span className="radio-dot">{choice==='no-killer'&&<Check size={12}/>}</span></button>}{v.secret.role==='traitor'&&<button className={`ballot no-murder ${choice==='none'?'selected':''}`} role="radio" aria-checked={choice==='none'} disabled={busy||v.paused} onClick={()=>chooseVictim('none')}><span className="avatar"><X size={16}/></span><b>No murder</b><span className="radio-dot">{choice==='none'&&<Check size={12}/>}</span></button>}</div>{needsBallotAnswer&&<p className="ballot-next-step" role="status">Now answer the question below.</p>}{needsParticipation&&<fieldset className="participation-step" disabled={busy||v.paused}><legend>Did you personally complete the murder task on {players.find((p:Any)=>p.id===choice)?.name}?</legend><div className="participation-options">{[true,false].map(value=><label className={`participation-option ${performed===value?'selected':''}`} key={String(value)}><input type="radio" name="performed-task" checked={performed===value} onChange={()=>setPerformed(value)}/><span>{value?'Yes, I did.':'No, I didn’t.'}</span></label>)}</div></fieldset>}{asksAwareness&&!!choice&&<fieldset className="participation-step awareness-step" disabled={busy||v.paused}><legend>Do you think someone tried to murder you this round?</legend><div className="participation-options">{[true,false].map(value=><label className={`participation-option ${suspectedAttempt===value?'selected':''}`} key={String(value)}><input type="radio" name="suspected-attempt" checked={suspectedAttempt===value} onChange={()=>setSuspectedAttempt(value)}/><span>{value?'Yes':'No'}</span></label>)}</div><p className="fine">Spot an attempt on your life: +1. Get it wrong: −1. Correctly answer No: 0.</p></fieldset>}<p id="ballot-guidance" className="ballot-guidance" role="status">{busy?'Submitting…':ballotHint||'Ready to submit. You’ll review your choice next.'}</p><button className="button primary full" aria-describedby="ballot-guidance" disabled={!!ballotHint||busy} onClick={()=>setModal('ballot')}>Lock my {killer?'report':twoPlayer?'vote':'accusation'} <KeyRound size={16}/></button><p className="fine centred">Your submission cannot be changed.</p></>}<button className="text-button full hide-secret" onClick={()=>setRevealed(false)}><EyeOff size={15}/> Hide my ballot</button></>}</section>}
      {phase==='voting'&&<section className="submission-panel" aria-label="Voting submissions"><div className="submission-heading"><h2>Submissions</h2><span>{v.submittedCount} of {v.activeCount}</span></div><ul>{players.filter((p:Any)=>p.active).map((p:Any)=><li key={p.id}><span className="avatar">{initials(p.name)}</span><b>{p.name}{p.id===me.id&&<small> YOU</small>}</b><span className={`submission-status ${p.submitted?'sent':''}`}>{p.submitted?<CheckCheck size={14}/>:<Clock size={14}/>} {p.submitted?'Submitted':'Not yet'}</span></li>)}</ul></section>}
      {phase==='results'&&<><section className="reveal-intro"><h2>{isFinalRound?'Final round results':'Round results'}</h2><p className="round-results-wait">{reviewOpen?'A dispute vote is open. The finish and next round will wait.':finalResults?me.isAdmin?'Review the results, then finish the game when everyone is ready.':'Waiting for the admin to confirm the finish.':me.isAdmin?'Start the next round when everyone is ready.':'Waiting for the admin to start the next round.'}</p></section><DisputePanel view={v} now={now+offset} busy={busy} open={()=>{setError('');setModal('openDispute');}} vote={(choice:'keep'|'discard')=>{setError('');setDisputeChoice(choice);setModal('disputeVote');}}/>{v.results.review?.status!=='discarded'&&<section className="reveal-story"><RoundStory results={v.results}/></section>}{myResult?<section className="my-result"><div><span className="eyebrow">YOUR SCORE</span><p>{personalResult(myResult,v.results)}</p></div><strong className={myResult.delta<0?'negative':'positive'}>{myResult.delta>0?'+':''}{myResult.delta}<small>{myResult.score} TOTAL</small></strong></section>:<section className="waiting-result"><Hourglass size={18}/><p>{isFinalRound?'You did not play this round. You can view the results.':'You will get a role when the next round starts.'}</p></section>}<Results results={v.results} me={me.id} showMurderSummary={false}/>{!finalResults&&<section className="next-round"><div><b>{me.nextActive?'Playing next round':'Sitting out next round'}</b><span>{v.readyCount} ready · {v.readyCount===2?'two-player rules next round':v.readyCount<MIN_PLAYERS?'at least 2 players needed':`${v.nextTraitorCount} killer${v.nextTraitorCount===1?'':'s'} next round`}</span></div><button className="button secondary" disabled={busy} onClick={changeReadiness}>{me.nextActive?'Sit out next round':'Play next round'}</button></section>}</>}
      {phase==='ended'&&<section className="ended-panel finish-panel"><GameFinish summary={v.finishSummary} me={me.id}/><div className="finish-actions"><button className="button primary full" onClick={()=>{setName(me.name);setGameName('');resetRoundLength();setModal('create');}}>Create another game <ArrowRight size={16}/></button></div></section>}
      </>}
      <div className="game-bottom"><button className="text-button" onClick={()=>setModal('players')}><Users size={14}/>{players.length} player{players.length===1?'':'s'}</button><button className="text-button" onClick={()=>{setHistoryRound(null);setModal('scores');}}><Trophy size={14}/> Scores</button>{phase!=='ended'&&<button className="text-button" onClick={()=>setModal('notifications')}><Bell size={14}/> Round alerts</button>}<span className="connection"><span className={`live-dot ${!connected&&!session?.demo?'offline':''}`}/>{session?.demo?'DEMO':connected?'CONNECTED':'RECONNECTING'}</span></div>
    </main>}
    {screen!=='game'&&<footer><span>IN PLAIN SIGHT</span></footer>}
    {modal&&<Modal title={modal==='create'?'Create game':modal==='rules'?'How to play':modal==='menu'?'Game menu':modal==='invite'?'Invite players':modal==='notifications'?'Round alerts':modal==='code'?'Player code':modal==='players'?'Players':modal==='scores'?'Scores':modal==='changeMission'?(soloKiller?'Change murder task?':'Request task change?'):modal==='missionChange'?(missionRequest?.status==='accepted'?'Task changed':missionRequest?.status==='rejected'?'Task kept':missionRequest?.canRespond?'Change murder task?':missionRequest?.total===2?'Waiting for the other Killer':'Waiting for other Killers'):modal==='end'?'End game?':modal==='finishGame'?'Finish game?':modal==='finalPlan'?'Keep playing?':modal==='roundStart'?(roundToStart?.type==='start'?'Start game?':'Start next round?'):modal==='roundtable'?'Call court?':modal==='finishVoting'?'Finish voting?':modal==='adminHandover'?'Choose another admin?':modal==='leave'?'Leave game?':modal==='openDispute'?`Dispute round ${v.round}?`:modal==='disputeVote'?'Confirm dispute vote':'Confirm choice'} close={closeModal} wide={modal==='rules'} conceal={['changeMission','missionChange'].includes(modal)?hidePrivateTask:undefined}>
      {modal==='rules'?<Rules/>:modal==='create'?<form onSubmit={e=>{e.preventDefault();enter('create');}}><p className="modal-description">You’ll be the admin and can play too.</p><label htmlFor="create-name">Your name</label><input id="create-name" value={name} onChange={e=>setName(e.target.value)} placeholder="Alex" maxLength={24} required autoComplete="given-name"/><label htmlFor="create-game">Game name</label><input id="create-game" value={gameName} onChange={e=>setGameName(e.target.value)} placeholder="Saturday game" maxLength={40} required/><label htmlFor="create-admin-code">Your player code</label><input id="create-admin-code" type="password" inputMode="numeric" autoComplete="new-password" value={adminPasscode} onChange={e=>setAdminPasscode(e.target.value.replace(/\D/g,'').slice(0,6))} placeholder="Choose 6 digits" minLength={6} maxLength={6} required/><p className="fine field-note">Keep this code to sign back in and use the admin controls.</p><fieldset className="round-duration"><legend>Round length</legend><div className="round-duration-row"><div><label htmlFor="create-round-hours">Hours</label><select id="create-round-hours" value={roundHours} onChange={e=>{const hours=e.target.value;setRoundHours(hours);if(hours==='0'&&roundMinutes==='0')setRoundMinutes('30');}}>{ROUND_HOUR_OPTIONS.map(hours=><option key={hours} value={String(hours)}>{hours}</option>)}<option value="more">More…</option></select></div><div><label htmlFor="create-round-minutes">Minutes</label><select id="create-round-minutes" value={roundMinutes} onChange={e=>setRoundMinutes(e.target.value)}><option value="0" disabled={roundHours==='0'}>0</option><option value="30">30</option></select></div></div>{roundHours==='more'&&<><label htmlFor="create-round-more-hours">Number of hours</label><input id="create-round-more-hours" type="number" min={25} step={1} value={longRoundHours} onChange={e=>setLongRoundHours(e.target.value)} required inputMode="numeric"/></>}</fieldset>{error&&<p className="form-error" role="alert">{error}</p>}<button className="button primary full" type="submit" disabled={busy}>{busy?<LoaderCircle className="spin" size={17}/>:<>Create the game <ArrowRight size={17}/></>}</button><p className="fine centred">2–30 players · killer numbers adjust automatically</p><p className="fine retention-note">Games and scores expire 7 days after creation and are automatically deleted.</p></form>:
      modal==='menu'?<div className="menu-list"><button onClick={()=>setModal('code')}><KeyRound size={18}/> My player code <ArrowRight size={15}/></button><button onClick={()=>setModal('invite')}><LinkIcon size={18}/> Invite someone <ArrowRight size={15}/></button><button onClick={()=>setModal('players')}><Users size={18}/> Players <ArrowRight size={15}/></button><button onClick={()=>{setHistoryRound(null);setModal('scores');}}><Trophy size={18}/> Scores & past rounds <ArrowRight size={15}/></button>{phase!=='ended'&&<button onClick={()=>setModal('notifications')}><Bell size={18}/> Round alerts <ArrowRight size={15}/></button>}<button onClick={()=>setModal('rules')}><HelpCircle size={18}/> How to play <ArrowRight size={15}/></button><button onClick={()=>entrance(session.code,v.inviteKey||'',v.name)}><LogOut size={18}/> Switch player <ArrowRight size={15}/></button>{phase!=='ended'&&<button onClick={()=>openDeparture('leave')}><LogOut size={18}/> Leave game <ArrowRight size={15}/></button>}</div>:
      modal==='notifications'?<RoundAlerts session={session}/>:
      modal==='invite'?<div className="code-dialog"><p>{canInvite?`Scan to join ${v.name}, or share the link.`:session?.demo?'Joining is available in a real game.':'This game has ended.'}</p>{canInvite&&<div className="invite-qr"><QRCodeSVG value={inviteUrl} size={224} level="M" marginSize={4} bgColor="#ffffff" fgColor="#111111" role="img" aria-label={`QR code to join ${v.name}`} title={`Join ${v.name}`}/></div>}<button className="button primary full" disabled={!canInvite} onClick={shareInvite}><LinkIcon size={16}/> Share link</button><p className="fine">Share only with people playing. Keep your player code private.</p></div>:
      modal==='code'?<div className="code-dialog"><p>This returns you to <b>{me.name}</b> in <b>{v.name}</b>. Keep this code private.</p><button className="private-code" onClick={()=>copy(session.passcode,'Player code copied.')} aria-label={`Your private player code ${session.passcode}. Copy code`}>{session.passcode}<Copy size={17}/></button><p className="fine">{me.isAdmin?'Your code also unlocks the admin controls.':'Open the game’s invite link, then enter this private player code.'}</p><button className="button secondary full" onClick={closeModal}><EyeOff size={15}/> Hide my code</button></div>:
      modal==='players'?<><p className="modal-description">{phase==='lobby'?'Ready players join when the admin starts.':'Changes apply to the next round.'}</p><div className="roster">{players.map((p:Any)=><div key={p.id}><span className="avatar">{initials(p.name)}</span><div><b>{p.name}{p.id===me.id&&<small> YOU</small>}{p.isAdmin&&<small> ADMIN</small>}</b><span>{p.left?'Left the game':phase==='lobby'?(p.nextActive?'Ready to play':'Sitting out'):p.active?'In this round':'Waiting for the next round'}{!p.left&&!p.nextActive&&phase!=='lobby'?' · sitting out next':''}</span></div><strong>{p.score}<small>PTS</small></strong></div>)}</div>{phase!=='ended'&&<button className="button secondary full" disabled={busy} onClick={changeReadiness}>{me.nextActive?'Sit out next round':'Play next round'}</button>}</>:
      modal==='scores'?<><p className="leaderboard-note fine">Ranked by total points. Only completed, counted rounds appear in rounds played.</p><Scoreboard players={scoreList} me={me.id}/>{v.history.length>0&&<div className="past-rounds"><label htmlFor="past-round">Past round</label><select id="past-round" value={historyRound??v.history[v.history.length-1].round} onChange={e=>setHistoryRound(Number(e.target.value))}>{[...v.history].reverse().map((h:Any)=><option value={h.round} key={h.round}>Round {h.round}{h.review?.status==='discarded'?' · Discarded':''}</option>)}</select><Results results={results||v.history[v.history.length-1]} me={me.id}/></div>}{!v.history.length&&<p className="fine">Points appear after the first reveal.</p>}</>:
      modal==='roundStart'?<div className="confirmation round-start-choice"><p>Choose how to start <b>Round {(roundToStart?.round??v.round)+1}</b>.</p>{discardedFinal&&<p className="fine">The discarded round stays out of the score. Everyone playing gets a new role.</p>}<div className="round-start-buttons"><button className="button primary full" disabled={busy||!!startRoundHint} onClick={()=>act({...roundToStart,asFinal:false})}><Play size={16}/> Start</button><button className="button secondary full" disabled={busy||!!startRoundHint} onClick={()=>act({...roundToStart,asFinal:true})}><Flag size={16}/> Start as final round</button></div>{startRoundHint&&<p className="form-error" role="status">{startRoundHint}</p>}{error&&<p className="form-error" role="alert">{error}</p>}</div>:
      modal==='finalPlan'?<div className="confirmation"><p>Carry on for as long as the group wants?</p><p className="fine">This removes the final-round designation. It does not start another round or change any points.</p>{finalPlanStale&&<p className="form-error" role="alert">The round has changed. Go back and choose again.</p>}{error&&<p className="form-error" role="alert">{error}</p>}<button className="button primary full" disabled={busy||finalPlanStale||!me.isAdmin||phase==='ended'} onClick={()=>act({type:'setFinalRound',...finalPlan})}>Keep playing <Play size={16}/></button><button className="text-button full" disabled={busy} onClick={closeModal}>Go back</button></div>:
      modal==='finishGame'?<div className="confirmation"><p>Finish the game and confirm the final scores?</p><p className="fine">Check that everyone is happy with the results. Once confirmed, this game cannot continue and no more disputes can be opened.</p>{error&&<p className="form-error" role="alert">{error}</p>}<button className="button primary full" disabled={busy||!finalResults||reviewOpen||!me.isAdmin} onClick={()=>act({type:'finishGame',round:v.round})}><Trophy size={16}/> Confirm finish</button><button className="text-button full" disabled={busy} onClick={closeModal}>Review results</button></div>:
      modal==='openDispute'?<div className="confirmation"><p>Talk through what happened, then let the players from this round decide whether its scores should count.</p><p className="fine">The vote lasts up to two minutes. It can only be opened once per round. A task can still count if the person did not notice or remember it.</p>{error&&<p className="form-error" role="alert">{error}</p>}<button className="button primary full" disabled={busy||v.paused||phase!=='results'||!!v.dispute} onClick={()=>act({type:'openDispute',round:v.round})}>Open dispute vote <Vote size={16}/></button><button className="text-button full" disabled={busy} onClick={closeModal}>Go back</button></div>:
      modal==='disputeVote'?<div className="confirmation"><p>You are choosing <b>{disputeChoice==='discard'?'Discard this round':'Keep this round'}</b>.</p><p className="fine">{disputeChoice==='discard'?'If the round is discarded, all its points and penalties are removed. Earlier scores stay the same.':'If the round is kept, its results and points stay as shown.'} Your vote cannot be changed.</p>{error&&<p className="form-error" role="alert">{error}</p>}<button className="button primary full" disabled={busy||!disputeChoice||!reviewOpen||!!v.dispute?.myVote||now+offset>=v.dispute.deadline} onClick={()=>act({type:'disputeVote',round:v.round,choice:disputeChoice})}>Lock my vote <Check size={16}/></button><button className="text-button full" disabled={busy} onClick={closeModal}>Go back</button></div>:
      modal==='changeMission'?<div className="confirmation task-change-dialog"><p>{soloKiller?'Replace your murder task?':'Request a different shared murder task?'}</p>{!soloKiller&&<p>{v.traitorCount===2?'The other Killer must accept.':'Both other Killers must accept.'} A rejection keeps the current task and stops further requests this round.</p>}<p className="fine">A new task may be harder, and you cannot go back. Only change it before {soloKiller?'you have':'any Killer has'} completed the current task on anyone.</p>{taskChangeError&&<p className="form-error" role="alert">{taskChangeError}</p>}<button className="button primary full" disabled={busy||v.paused||phase!=='playing'||!killer||taskChangesRemaining===0||!taskToChange||taskToChange.round!==v.round||taskToChange.missionId!==v.secret?.mission?.id||!soloKiller&&(missionRequest?.status==='open'||taskToChange.requestRevision!==(v.secret?.missionChangeRevision??0))} onClick={()=>act({type:soloKiller?'changeMission':'requestMissionChange',...taskToChange})}>{busy?<LoaderCircle className="spin" size={17}/>:<RefreshCw size={16}/>} {soloKiller?'Change task':'Request change'}</button><button className="text-button full" disabled={busy} onClick={closeModal}>Keep task</button><button className="text-button full" onClick={hidePrivateTask}><EyeOff size={15}/> Hide role</button></div>:
      modal==='missionChange'?<TaskChangeDialog request={missionRequest} task={v.secret?.mission} remaining={taskChangesRemaining} paused={v.paused} busy={busy} error={taskChangeError} onDecision={accept=>act({type:'respondMissionChange',round:v.round,missionId:v.secret.mission.id,requestId:missionRequest?.id,accept})} onClose={closeModal} onHide={hidePrivateTask} onDemoDecision={session?.demo?answerDemoTaskRequest:undefined}/>:
      modal==='adminHandover'?<div className="confirmation admin-handover">
        <p>{departureAction==='sitOut'?'You can keep admin control while sitting out, or pass it to another player.':'Pass admin control to another player before you leave.'}</p>
        {adminCandidates.length>0?<>
          <label htmlFor="replacement-admin">New admin</label><select id="replacement-admin" value={replacementAdminId} onChange={e=>{setReplacementAdminId(e.target.value);setError('');}}><option value="">Choose a player</option>{adminCandidates.map((p:Any)=><option key={p.id} value={p.id}>{p.name}{!p.nextActive?' (sitting out)':''}</option>)}</select>
          <p className="fine">The new admin gets the controls and you give them up. Your player codes and scores stay the same.</p>
          {replacementAdminId&&!replacementAdmin&&<p className="form-error" role="alert">That player is no longer available. Choose another admin.</p>}
          {taskChangeError&&<p className="form-error" role="alert">{taskChangeError}</p>}
          <button className="button primary full" disabled={busy||!replacementAdmin||!me.isAdmin||phase==='ended'} onClick={()=>act({type:departureAction==='leave'?'leave':'ready',...(departureAction==='sitOut'?{ready:false}:{}),newAdminId:replacementAdminId})}>{busy?<LoaderCircle className="spin" size={17}/>:<Crown size={16}/>} {replacementAdmin?`Make ${replacementAdmin.name} admin and ${departureAction==='leave'?'leave':'sit out'}`:'Choose an admin to continue'}</button>
        </>:<p className="fine">No other players are available to take over.</p>}
        {departureAction==='sitOut'?<button className="button secondary full" disabled={busy||!me.isAdmin} onClick={()=>act({type:'ready',ready:false})}>Sit out and stay admin</button>:<>
          {['playing','voting'].includes(phase)&&<p className="fine">This round will still be scored, including any missed-ballot penalty.</p>}
          <button className="button secondary full" disabled={busy||!me.isAdmin} onClick={()=>{setError('');setModal('end');}}>End game instead</button>
          <button className="text-button full" disabled={busy} onClick={()=>setModal('code')}>View my player code</button>
        </>}
        <button className="text-button full" disabled={busy} onClick={closeModal}>Go back</button>
      </div>:
      modal==='leave'?<div className="confirmation"><p>Leave the game and sit out future rounds?</p><p className="fine">Your score and player code are kept. {['playing','voting'].includes(phase)?'This round will still be scored, including any missed-ballot penalty. ':''}Use your player code to return, then choose Play next round.</p>{taskChangeError&&<p className="form-error" role="alert">{taskChangeError}</p>}<button className="button primary full" disabled={busy} onClick={()=>act({type:'leave'})}>Leave game <LogOut size={16}/></button><button className="text-button full" disabled={busy} onClick={()=>setModal('code')}>View my player code</button><button className="text-button full" disabled={busy} onClick={closeModal}>Go back</button></div>:
      modal==='finishVoting'?<div className="confirmation"><p>Finish voting now?</p><p className="fine">{v.submittedCount} of {v.activeCount} have submitted. Players who haven’t submitted will receive the missed-vote or missed-report penalty.</p>{taskChangeError&&<p className="form-error" role="alert">{taskChangeError}</p>}<button className="button primary full" disabled={busy||v.paused||phase!=='voting'} onClick={()=>act({type:'finishVoting'})}>{busy?<LoaderCircle className="spin" size={17}/>:<CheckCheck size={16}/>} Finish voting</button><button className="text-button full" disabled={busy} onClick={closeModal}>Go back</button></div>:
      modal==='roundtable'?<div className="confirmation"><p>Call Court and open voting for everyone?</p>{error&&<p className="form-error" role="alert">{error}</p>}<button className="button primary full" disabled={busy||v.paused||phase!=='playing'} onClick={()=>act({type:'roundtable'})}>{busy?<LoaderCircle className="spin" size={17}/>:<Vote size={16}/>} Call court</button><button className="text-button full" disabled={busy} onClick={closeModal}>Go back</button></div>:
      <div className="confirmation"><p>{modal==='end'?'End the game for everyone? Completed scores are kept. Unfinished rounds are not scored.':<>You’re {choice==='no-killer'?'choosing':v.secret?.role==='traitor'?'reporting':'accusing'} <b>{choice==='none'?'No murder':choice==='no-killer'?'No killer this round':players.find((p:Any)=>p.id===choice)?.name}</b>. This choice cannot be changed.</>}</p>{modal==='ballot'&&modern&&killer&&<p className="participation-summary">{choice!=='none'&&(soloKiller||performed===true)?'You personally completed the task.':'You did not personally complete the task.'}</p>}{modal==='ballot'&&asksAwareness&&<p className="participation-summary">You think someone tried to murder you: <b>{suspectedAttempt?'Yes':'No'}</b>.</p>}{error&&<p className="form-error" role="alert">{error}</p>}<button className="button primary full" disabled={busy||modal!=='end'&&(v.paused||needsParticipation&&performed===null||asksAwareness&&suspectedAttempt===null)} onClick={()=>act(modal==='end'?{type:'end'}:ballotAction())}>{busy?<LoaderCircle className="spin" size={17}/>:modal==='end'?'End the game':'Lock my submission'}<Check size={16}/></button><button className="text-button full" disabled={busy} onClick={closeModal}>Go back</button></div>}
    </Modal>}
    {toast&&<div className="toast" role="status"><Check size={16}/>{toast}</div>}
  </div>;
}
function Scoreboard({players,me}:{players:Any[];me:string}){return <div className="leaderboard">{players.map(p=><div key={p.id}><span className="rank" aria-label={p.rank?`Place ${p.rank}`:'Not ranked'}>{p.rank===1?<Crown size={16}/>:p.rank??'·'}</span><span className="avatar">{initials(p.name)}</span><div className="leaderboard-identity"><b>{p.name}{p.id===me&&<small> YOU</small>}</b><span>{p.roundsPlayed??0} {(p.roundsPlayed??0)===1?'round':'rounds'} played</span></div><strong>{p.score}<small>POINTS</small></strong></div>)}</div>;}
function GameFinish({summary,me}:{summary:Any;me:string}){
  if(!summary)return null;
  const winners=summary.winners,awards=summary.awards.filter((award:Any)=>award.value>0);
  return <>
    <section className="winner-panel" aria-label="Game winner"><Trophy size={34} aria-hidden="true"/><span className="eyebrow">{winners.length>1?'JOINT WINNERS':winners.length?'WINNER':'GAME ENDED'}</span>
      {winners.length?<><h2>{winners.map((p:Any)=><span key={p.id}>{p.name}{p.id===me&&<small> YOU</small>}</span>)}</h2><p className="winning-score">{winners[0].score} {Math.abs(winners[0].score)===1?'point':'points'}</p><p>{summary.completedRounds} {summary.completedRounds===1?'round':'rounds'} completed.</p></>:<><h2>No rounds completed</h2><p>There are no counted rounds to name a winner.</p></>}
    </section>
    <section className="final-standings" aria-labelledby="final-standings-title"><h2 id="final-standings-title">Final standings</h2><Scoreboard players={summary.standings} me={me}/><p className="fine">Ranked by total points. {summary.hasDiscardedRounds?'Discarded rounds do not count towards rounds played or awards.':'Only completed rounds count towards rounds played.'} Players with no counted rounds are unranked.</p></section>
    {awards.length>0&&<section className="game-awards" aria-labelledby="game-awards-title"><div className="awards-heading"><h2 id="game-awards-title">Awards</h2><p className="fine">A little recognition. No extra points.</p></div>{awards.map((award:Any)=><div className="award-card" key={award.id}><span className="eyebrow">{award.title}</span><div className="award-result"><div>{award.winners.map((p:Any)=><b key={p.id}>{p.name}{p.id===me&&<small> YOU</small>}</b>)}</div><strong>{award.value}</strong></div>{award.winners.length>1&&<span className="fine">Shared award</span>}</div>)}</section>}
  </>;
}
function ReviewNotice({results}:{results:Any}){
  const review=results?.review;if(!review)return null;
  return <div className="review-notice" role="status"><b>{review.status==='discarded'?'Round discarded by group vote':'Round kept'}</b><p>{review.status==='discarded'?'All points and penalties from this round have been removed. Earlier scores are unchanged.':'The results and points from this round stand.'}</p><span className="fine">{review.keepVotes} keep · {review.discardVotes} discard · {review.submittedCount} of {review.totalEligible} voted.{review.adminTieBreak?' The admin tie-break decided the vote.':review.resolution==='timeout'?' No majority to discard was reached before time ran out.':''}</span></div>;
}
function DisputePanel({view,now,busy,open,vote}:{view:Any;now:number;busy:boolean;open:()=>void;vote:(choice:'keep'|'discard')=>void}){
  const d=view.dispute,review=view.results.review;
  if(review)return <ReviewNotice results={view.results}/>;
  if(!d)return view.results.players.some((p:Any)=>p.id===view.me.id)?<div className="dispute-entry"><span>Something went wrong this round?</span><button className="text-button" disabled={busy||view.paused} onClick={open}>Dispute this round <Vote size={15}/></button></div>:null;
  if(d.status!=='open')return null;
  const expired=now>=d.deadline;
  return <section className="dispute-panel" aria-labelledby="dispute-heading">
    <div className="dispute-heading"><div><span className="eyebrow">ROUND {d.round} · DISPUTE VOTE</span><h2 id="dispute-heading">Should this round count?</h2></div><span className="dispute-clock" aria-label={`${timeLeft(d.deadline,now)} remaining`}>{timeLeft(d.deadline,now)}</span></div>
    <p>Talk it through, then decide together. Discarding needs <b>{d.majority} of {d.totalEligible}</b> players from this round.</p>
    <p className="fine">{d.tieBreakAdminName?`${d.tieBreakAdminName} has one extra point only when the vote closes in a tie. `:''}Without a majority to discard, the round is kept.</p>
    {d.eligible?d.myVote?<div className="dispute-locked" role="status"><CheckCheck size={18}/><span>Your vote: <b>{d.myVote==='keep'?'Keep this round':'Discard this round'}</b>. Waiting for the decision.</span></div>:<div className="dispute-actions"><button className="button primary" disabled={busy||expired} onClick={()=>vote('keep')}>Keep this round</button><button className="button secondary" disabled={busy||expired} onClick={()=>vote('discard')}>Discard this round</button></div>:<p className="dispute-locked">Only players from this round can vote. You can join the next round.</p>}
    <p className="dispute-progress" role="status">{expired?'Closing the vote…':`${d.submittedCount} of ${d.totalEligible} voted. Choices stay private.`}</p>
  </section>;
}
function MurderedBadge(){return <span className="murdered-badge"><Mark/> Murdered</span>;}
function RoundStory({results}:{results:Any}){
  if(results.review?.status==='discarded')return null;
  const story=roundSummary(results);
  return <div className="round-story">
    <h3>{story.headline}</h3>
    <p>{story.body}</p>
    {story.notes.map((note:string,i:number)=><p className="story-note" key={i}>{note}</p>)}
    {results.review?.status!=='discarded'&&results.murderedId&&results.murderMethod&&<p className="story-method">Method: <b>{results.murderMethod.title}</b></p>}
    <p className="story-court">{story.court}</p>
  </div>;
}
function Results({results,me,showMurderSummary=true}:{results:Any;me:string;showMurderSummary?:boolean}){
  if(!results)return null;
  return <section className="results-list" aria-label={`Round ${results.round} results`}>
    <div className="results-list-heading"><span className="eyebrow">ROUND {results.round} · RESULTS</span><span>{results.submittedCount} / {results.totalActive} submitted</span></div>
    {(results.rulesVersion??1)<ROUND_RULES_VERSION&&<p className="fine legacy-rules">Scored using the previous rules.</p>}
    {showMurderSummary&&<><ReviewNotice results={results}/><RoundStory results={results}/></>}
    <p className="results-help">Tap a player to see their vote and points breakdown.</p>
    {[...results.players].sort((a:Any,b:Any)=>(a.role==='traitor'?0:1)-(b.role==='traitor'?0:1)||b.delta-a.delta).map((p:Any)=><details key={`${results.round}:${p.id}`} className={`result-row ${p.id===me?'your-result':''}`} open={p.id===me}>
      <summary className="result-person">
        <span className="avatar">{initials(p.name)}</span>
        <span className="result-identity"><span className="result-name"><b>{p.name}{p.id===me&&<small> YOU</small>}</b>{p.murdered&&results.review?.status!=='discarded'&&<MurderedBadge/>}</span><span className={`result-role ${roleLabel(p.role).toLowerCase()}`}>{p.role==='traitor'?<Swords size={12}/>:<Shield size={12}/>} {roleLabel(p.role)}</span></span>
        <span className="result-points"><strong className={p.delta<0?'negative':p.delta>0?'positive':''}>{pointsLabel(p.delta)}<span className="sr-only"> points this round</span></strong><span>{p.score} total</span></span>
        <ChevronDown size={17} className="result-chevron" aria-hidden="true"/>
      </summary>
      <div className="result-expanded">
        <p className="result-outcome">{resultOutcome(p,results)}</p>
        <ul className="score-breakdown" aria-label={`Points breakdown for ${p.name}`}>{scoreBreakdown(p,results).map((line:Any,i:number)=><li key={i}><span>{line.text}.</span><strong>{pointsLabel(line.points)}</strong></li>)}</ul>
        <div className="result-detail">{resultDetails(p,results).map((detail:string,i:number)=><span key={i}>{detail}</span>)}</div>
      </div>
    </details>)}
  </section>;
}
