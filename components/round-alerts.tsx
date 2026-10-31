'use client';
import {useEffect,useRef,useState} from 'react';
import {Bell,BellOff,LoaderCircle} from 'lucide-react';
import {applicationKey,notificationRegistration,notificationRequest,notificationSupport,rememberNotificationGame} from '../lib/notifications/client.mjs';

export function RoundAlerts({session}:{session:any}){
  const [support,setSupport]=useState('loading'),[enabled,setEnabled]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState(''),[permission,setPermission]=useState('default');
  const alive=useRef(true);
  useEffect(()=>{
    alive.current=true;const supported=session.demo?'demo':notificationSupport();setSupport(supported);
    if(supported==='supported'){
      setPermission(Notification.permission);
      navigator.serviceWorker.getRegistration('/').then(async registration=>{
        void registration?.update().catch(()=>{});
        const subscription=await registration?.pushManager.getSubscription();
        if(!subscription)return;const data=await notificationRequest(session,'notificationStatus',{endpoint:subscription.endpoint});
        if(alive.current){setEnabled(data.enabled&&Notification.permission==='granted');if(data.enabled)rememberNotificationGame(registration,session);}
      }).catch(()=>{if(alive.current)setError('Could not check your alerts. Please try again.');});
    }
    return()=>{alive.current=false;};
  },[session]);
  async function enable(){
    if(busy)return;setBusy(true);setError('');setMessage('');
    try{
      // The permission request runs directly from a tap, before other awaits.
      setMessage('If your browser asks, choose Allow notifications.');
      const granted=Notification.permission==='granted'?'granted':await Promise.race([Notification.requestPermission(),new Promise<never>((_,reject)=>setTimeout(()=>reject(new Error('Check your browser’s notification permission prompt.')),30000))]);if(!alive.current)return;setPermission(granted);
      if(granted!=='granted'){setMessage(granted==='denied'?'Notifications are blocked. You can allow them in your browser or phone settings.':'Notifications are still off. You can enable them later.');return;}
      const [registration,keys]=await Promise.all([notificationRegistration(),notificationRequest(session,'notificationKey')]);
      if(!alive.current)return;
      const subscription=await registration.pushManager.getSubscription()||await Promise.race([registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:applicationKey(keys.publicKey)}),new Promise<never>((_,reject)=>setTimeout(()=>reject(new Error('This browser did not finish setting up notifications.')),15000))]);
      if(!alive.current)return;
      await notificationRequest(session,'enableNotifications',{subscription:subscription.toJSON()});
      rememberNotificationGame(registration,session);if(alive.current){setEnabled(true);setMessage('Round alerts are on. Try a test notification below.');}
    }catch{if(alive.current){setMessage('');setError('Could not enable notifications. Check your connection and browser settings, then try again.');}}
    finally{if(alive.current)setBusy(false);}
  }
  async function change(type:'disableNotifications'|'testNotification'){
    if(busy)return;setBusy(true);setError('');setMessage('');
    try{
      const registration=await navigator.serviceWorker.getRegistration('/'),subscription=await registration?.pushManager.getSubscription();
      if(!subscription){setEnabled(false);throw new Error('Enable notifications again to reconnect this device.');}
      await notificationRequest(session,type,{endpoint:subscription.endpoint});
      if(type==='disableNotifications'){setEnabled(false);registration?.active?.postMessage({type:'forget-game',game:session.code});setMessage('Round alerts are off.');}
      else setMessage('Test sent. Look for a notification on your device.');
    }catch(e){if(alive.current)setError(e instanceof Error?e.message:'Could not update notifications. Try again.');}
    finally{if(alive.current)setBusy(false);}
  }
  return <div className="round-alert-settings">
    <p className="modal-description">Get a notification when the roundtable opens, even with the game closed.</p>
    {support==='loading'?<p role="status">Checking this device…</p>:support==='install'?<p>On iPhone or iPad, open the game’s invite link in Safari, tap Share, then <b>Add to Home Screen</b>. Open the saved game, sign in and enable notifications.</p>:support==='demo'?<p>Round alerts are available in a real game.</p>:support==='unsupported'?<p>This browser can’t receive round alerts. Try opening the game in Safari, Chrome, Firefox or Edge.</p>:<>
      <p className="alert-setting-status"><b>Round alerts: {enabled?'On':'Off'}</b></p>
      {permission==='denied'&&<p>Notifications are blocked. Allow them in your browser or phone settings to turn alerts on.</p>}
      {enabled?<><button className="button primary full" disabled={busy} onClick={()=>change('testNotification')}>{busy?<LoaderCircle size={16} className="spin"/>:<Bell size={16}/>} Send test notification</button><button className="button secondary full" disabled={busy} onClick={()=>change('disableNotifications')}><BellOff size={16}/> Turn off alerts</button></>:<button className="button primary full" disabled={busy||permission==='denied'} onClick={enable}>{busy?<LoaderCircle size={16} className="spin"/>:<Bell size={16}/>} Enable notifications</button>}
      <p className="fine">For this player on this device. Alerts turn off when you switch players or leave the game. Sound follows your device settings. Your phone may delay notifications.</p>
    </>}
    {message&&<p className="alert-setting-message" role="status">{message}</p>}{error&&<p className="form-error" role="alert">{error}</p>}
  </div>;
}
