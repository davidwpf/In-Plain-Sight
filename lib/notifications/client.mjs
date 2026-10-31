export function notificationSupport(){
  const ios=/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
  const standalone=window.matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
  if(ios&&!standalone)return 'install';
  return window.isSecureContext&&'Notification' in window&&'serviceWorker' in navigator&&'PushManager' in window?'supported':'unsupported';
}
export async function notificationRequest(session,type,extra={},keepalive=false){
  const response=await fetch('/api/game',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.token}`},body:JSON.stringify({type,code:session.code,...extra}),cache:'no-store',keepalive,signal:AbortSignal.timeout(15000)});
  const data=await response.json();if(!response.ok)throw new Error(data.error||'Could not update notifications. Try again.');return data;
}
export async function notificationRegistration(){
  const registration=await navigator.serviceWorker.register('/sw.js',{scope:'/',updateViaCache:'none'});
  if(registration.active)return registration;
  return await Promise.race([navigator.serviceWorker.ready,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Notifications are not ready yet. Please try again.')),10000))]);
}
export function applicationKey(value){return Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));}
export function rememberNotificationGame(registration,session){
  // The invite stays on this device. It is never put into a push payload.
  registration.active?.postMessage({type:'remember-game',game:session.code,url:session.inviteKey?`/?invite=${session.inviteKey}`:`/?game=${session.code}`});
}
export async function detachNotifications(session){
  if(!session?.token||!('serviceWorker' in navigator))return;
  try{
    const registration=await navigator.serviceWorker.getRegistration('/');
    registration?.active?.postMessage({type:'forget-game',game:session.code});
    const subscription=await registration?.pushManager?.getSubscription();
    if(subscription)await notificationRequest(session,'disableNotifications',{endpoint:subscription.endpoint},true);
  }catch{/* A failed cleanup must never stop switching or leaving a game. */}
}
