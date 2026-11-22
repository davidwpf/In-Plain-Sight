import {Copy,KeyRound} from 'lucide-react';

export function PlayerCode({code,demo=false,onCopy}:{code?:string;demo?:boolean;onCopy:()=>void}){
  if(demo)return <p className="fine">Player codes are available in a real game.</p>;
  return <div className="player-code-reminder">
    <span className="eyebrow"><KeyRound size={14} aria-hidden="true"/> YOUR PLAYER CODE</span>
    <div className="player-code-value" aria-label={`Your private player code ${code}`}>{code}</div>
    <button className="button secondary full" onClick={onCopy} disabled={!code}><Copy size={16}/> Copy code</button>
    <p>Use your name and this code to return to the game.</p>
  </div>;
}

