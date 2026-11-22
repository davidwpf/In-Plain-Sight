'use client';
import {useState} from 'react';
import {Eye,EyeOff} from 'lucide-react';

export function PlayerCodeInput({id,value,onChange,choosing=false}:{id:string;value:string;onChange:(value:string)=>void;choosing?:boolean}){
  const [visible,setVisible]=useState(false);
  return <>
    <label htmlFor={id}>{choosing?'Choose a four-digit player code':'Your player code'}</label>
    <div className="pin-field"><input id={id} name="player-code" type={visible?'text':'password'} value={value} onChange={event=>onChange(event.target.value.replace(/\D/g,'').slice(0,4))} inputMode="numeric" pattern="[0-9]{4}" minLength={4} maxLength={4} placeholder="0000" autoComplete={choosing?'new-password':'current-password'} required aria-describedby={`${id}-help`}/><button type="button" className="icon-button" aria-label={visible?'Hide player code':'Show player code'} aria-pressed={visible} onClick={()=>setVisible(!visible)}>{visible?<EyeOff size={19}/>:<Eye size={19}/>}</button></div>
    <p id={`${id}-help`} className="fine pin-help">{choosing?'Use this code with your name to return. Keep it private.':'Enter the four-digit code you chose when joining.'}</p>
  </>;
}
