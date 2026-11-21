export const TAB_SESSION_KEY='in-plain-sight.session.v2';
export const DEVICE_SESSION_KEY='in-plain-sight.device-sessions.v1';

function get(storage,key){try{return JSON.parse(storage?.getItem(key)??'null');}catch{return null;}}
function set(storage,key,value){try{if(!storage)return false;storage.setItem(key,JSON.stringify(value));return true;}catch{return false;}}
function remove(storage,key){try{storage?.removeItem(key);}catch{}}
function clean(value,now){
  if(!value||typeof value!=='object'||value.demo||typeof value.token!=='string'||!value.token||typeof value.code!=='string'||!/^[A-Z2-9]{6}$/.test(value.code)||typeof value.passcode!=='string'||!/^\d{6}$/.test(value.passcode))return null;
  if(value.expiresAt!==undefined&&(!Number.isFinite(value.expiresAt)||value.expiresAt<=now))return null;
  if(value.inviteKey!=null&&(typeof value.inviteKey!=='string'||!/^[a-f0-9]{64}$/.test(value.inviteKey)))return null;
  return {token:value.token,code:value.code,passcode:value.passcode,inviteKey:value.inviteKey??null,gameName:typeof value.gameName==='string'?value.gameName:'',...(typeof value.playerId==='string'?{playerId:value.playerId}:{}),...(value.expiresAt!==undefined?{expiresAt:value.expiresAt}:{}),storageVersion:3};
}
function device(storage,now){
  const raw=get(storage,DEVICE_SESSION_KEY),sessions=Object.create(null),forgottenCodes=Object.create(null);
  if(raw?.sessions&&typeof raw.sessions==='object')for(const [code,value] of Object.entries(raw.sessions)){const s=clean(value,now);if(s&&s.code===code)sessions[code]=s;}
  if(raw?.forgottenCodes&&typeof raw.forgottenCodes==='object')for(const [code,until] of Object.entries(raw.forgottenCodes))if(/^[A-Z2-9]{6}$/.test(code)&&Number.isFinite(until)&&until>now)forgottenCodes[code]=until;
  return {sessions,forgottenCodes,lastCode:Object.hasOwn(sessions,raw?.lastCode)?raw.lastCode:null};
}
export function samePlayerSession(a,b){return !!a&&!!b&&a.code===b.code&&(a.playerId&&b.playerId?a.playerId===b.playerId:a.passcode===b.passcode);}
export function rememberedPlayerForGame(storage,code,now=Date.now()){return device(storage,now).sessions[code]??null;}
export function rememberPlayerSession(value,{tab,remembered},now=Date.now()){
  const session=clean(value,now);if(!session)return {tabSaved:false,deviceSaved:false};
  const saved=device(remembered,now);saved.sessions[session.code]=session;saved.lastCode=session.code;
  const deviceSaved=set(remembered,DEVICE_SESSION_KEY,saved);
  return {tabSaved:set(tab,TAB_SESSION_KEY,{...session,...(!deviceSaved?{tabOnly:true}:{})}),deviceSaved};
}
/** @param {{tab?:any,remembered?:any}} storage @param {{inviteKey?:string|null,code?:string|null}} query */
export function readPlayerSession({tab,remembered}, {inviteKey=null,code=null}={},now=Date.now()){
  const raw=get(tab,TAB_SESSION_KEY),inTab=clean(raw,now),saved=device(remembered,now);
  const matches=s=>!!s&&(inviteKey!==null?s.inviteKey===inviteKey:code?s.code===code.toUpperCase():true);
  let selected=null;
  if(matches(inTab)){
    const persistent=saved.sessions[inTab.code];
    if(raw.tabOnly||raw.storageVersion!==3&&!persistent&&!saved.forgottenCodes[inTab.code]){rememberPlayerSession(inTab,{tab,remembered},now);return inTab;}
    if(samePlayerSession(inTab,persistent))selected=persistent;
  }
  selected??=inviteKey!==null?Object.values(saved.sessions).find(s=>matches(s))??null:code?saved.sessions[code.toUpperCase()]??null:saved.lastCode?saved.sessions[saved.lastCode]:null;
  if(selected){set(tab,TAB_SESSION_KEY,selected);saved.lastCode=selected.code;}else remove(tab,TAB_SESSION_KEY);
  set(remembered,DEVICE_SESSION_KEY,saved);return selected;
}
export function forgetPlayerSession(session,{tab,remembered},{exactToken=false,keepRemembered=false}={},now=Date.now()){
  remove(tab,TAB_SESSION_KEY);if(keepRemembered||!session)return;
  const saved=device(remembered,now),stored=saved.sessions[session.code];
  if(stored&&(exactToken?stored.token===session.token:samePlayerSession(stored,session))){delete saved.sessions[session.code];if(saved.lastCode===session.code)saved.lastCode=null;saved.forgottenCodes[session.code]=session.expiresAt??now+7*24*60*60*1000;}
  set(remembered,DEVICE_SESSION_KEY,saved);
}
export function browserSessionStorage(){
  let tab,remembered;try{tab=window.sessionStorage;}catch{}try{remembered=window.localStorage;}catch{}
  return {tab,remembered};
}
