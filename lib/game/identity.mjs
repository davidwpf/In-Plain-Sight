import {hashSecret} from './storage.mjs';

export function cleanPlayerName(value){return typeof value==='string'?value.trim().replace(/\s+/g,' ').replace(/[\u0000-\u001f<>]/g,'').slice(0,24):'';}
export function playerNameKey(value){return typeof value==='string'?value.normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase():'';}
export function validateChosenPlayerCode(value){
  if(typeof value!=='string'||!/^\d{4}$/.test(value))throw new Error('Choose a four-digit player code.');
  return value;
}
export function validLoginCode(value){return typeof value==='string'&&/^(?:\d{4}|\d{6})$/.test(value);}
export async function chosenLogin(g,name,value){
  const passcode=validateChosenPlayerCode(value),key=playerNameKey(name);
  if(!key)throw new Error('Enter your name.');
  return {passcode,loginVersion:2,loginHash:await hashSecret(JSON.stringify(['name-code-v2',g.authSalt,key,passcode]))};
}
export async function findLoginPlayer(g,name,passcode){
  if(!validLoginCode(passcode))return null;
  const key=playerNameKey(cleanPlayerName(name));
  if(passcode.length===4){
    if(!key)return null;
    const login=await chosenLogin(g,key,passcode);
    return g.players.find(p=>p.loginVersion===2&&playerNameKey(p.name)===key&&p.loginHash===login.loginHash)??null;
  }
  const hash=await hashSecret(`${g.authSalt}:${passcode}`);
  return g.players.find(p=>p.loginVersion!==2&&p.loginHash===hash&&(!key||playerNameKey(p.name)===key))??null;
}
