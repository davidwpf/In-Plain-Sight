import {env} from 'cloudflare:workers';
import {makeGame,addPlayer,applyAction,tick,publicView,randomInt,validateRoundMinutes} from '../../../lib/game/engine.mjs';
import {GAME_RETENTION_MS,deleteExpiredGames,validInviteKey,makeInviteKey,hashSecret,validatePlayerCode} from '../../../lib/game/storage.mjs';
export const dynamic='force-dynamic';
type Outcome={body:any;status:number};
type GameRow={code:string;state:string;version:number;expires_at:number;invite_hash:string|null};
const headers={'Cache-Control':'no-store, private','Content-Type':'application/json','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
const ok=(body:any,status=200):Outcome=>({body,status});
const fail=(error:string,status=400):Outcome=>ok({error},status);
const unavailable=()=>fail('This invite is unavailable or the game has expired.',404);
const respond=(o:Outcome)=>new Response(JSON.stringify(o.body),{status:o.status,headers});
function db(){if(!env.DB)throw new Error('Game storage is unavailable. Please try again shortly.');return env.DB;}
const clean=(s:unknown,max=24)=>typeof s==='string'?s.trim().replace(/[\u0000-\u001f<>]/g,'').slice(0,max):'';
function code(){const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';return Array.from(crypto.getRandomValues(new Uint8Array(6)),x=>chars[x%32]).join('');}
function readCode(s:unknown){const v=typeof s==='string'?s.toUpperCase().trim():'';if(!/^[A-Z2-9]{6}$/.test(v))throw new Error('Open the game’s invite link or scan its QR code.');return v;}
function gameView(g:any,id:string,expiresAt:number){return {...publicView(g,id),inviteKey:g.inviteKey??null,expiresAt};}
async function newLogin(g:any,chosen?:unknown){
  if(chosen!==undefined){const passcode=validatePlayerCode(chosen);return {passcode,loginHash:await hashSecret(`${g.authSalt}:${passcode}`)};}
  for(let i=0;i<50;i++){const passcode=String(randomInt(1000000)).padStart(6,'0');const loginHash=await hashSecret(`${g.authSalt}:${passcode}`);if(!g.players.some((p:any)=>p.loginHash===loginHash))return {passcode,loginHash};}
  throw new Error('Could not create a player code. Try again.');
}
async function expired(row:GameRow){
  if(row.expires_at>Date.now())return false;
  await db().prepare('DELETE FROM games WHERE code = ? AND expires_at <= ?').bind(row.code,Date.now()).run();return true;
}
async function update(gameCode:string,operation:(g:any,row:GameRow)=>Outcome|Promise<Outcome>){
  for(let attempt=0;attempt<12;attempt++){
    const row=await db().prepare('SELECT code, state, version, expires_at, invite_hash FROM games WHERE code = ?').bind(gameCode).first<GameRow>();
    if(!row||await expired(row))return respond(unavailable());
    const g=JSON.parse(row.state);if(g.schemaVersion!==2)return respond(fail('This is an earlier prototype game. Please create a new game.',410));
    const result=await operation(g,row),state=JSON.stringify(g);if(state===row.state)return respond(result);
    const written=await db().prepare('UPDATE games SET state = ?, version = version + 1 WHERE code = ? AND version = ? AND expires_at > ?').bind(state,gameCode,row.version,Date.now()).run();
    if(written.meta.changes===1)return respond(result);
  }return respond(fail('Several players submitted at once. Please try again.',409));
}
async function tokenPlayer(req:Request,g:any){const token=req.headers.get('Authorization')?.replace(/^Bearer /,'');if(!token)return null;const digest=await hashSecret(token);return g.players.find((p:any)=>p.tokenHashes?.includes(digest));}
async function matchingInvite(row:GameRow,key:unknown){return !row.invite_hash||(validInviteKey(key)&&row.invite_hash===await hashSecret(key as string));}
export async function GET(req:Request){
  try{
    const query=new URL(req.url).searchParams;
    // An invite preview reveals only the game name and internal identifier.
    // Old six-character links remain valid only for games created before invites.
    if(query.get('preview')==='1'){
      const key=query.get('invite');let row:GameRow|null;
      if(key){if(!validInviteKey(key))return respond(unavailable());row=await db().prepare('SELECT code, state, version, expires_at, invite_hash FROM games WHERE invite_hash = ?').bind(await hashSecret(key)).first<GameRow>();}
      else{const gameCode=readCode(query.get('code'));row=await db().prepare('SELECT code, state, version, expires_at, invite_hash FROM games WHERE code = ? AND invite_hash IS NULL').bind(gameCode).first<GameRow>();}
      if(!row||await expired(row))return respond(unavailable());const g=JSON.parse(row.state);
      if(g.schemaVersion!==2)return respond(unavailable());
      return respond(ok({name:g.name,code:row.code,expiresAt:row.expires_at}));
    }
    const gameCode=readCode(query.get('code'));return await update(gameCode,async(g,row)=>{const p=await tokenPlayer(req,g);if(!p)return fail('Enter your player code to return to the game.',401);tick(g);return ok(gameView(g,p.id,row.expires_at));});
  }catch(e){return respond(fail(e instanceof Error?e.message:'Unable to load the game.'));}
}
export async function POST(req:Request){
  try{
    const origin=req.headers.get('Origin');if(origin&&origin!==new URL(req.url).origin)return respond(fail('Use the game website to make changes.',403));
    if(Number(req.headers.get('content-length'))>12000)return respond(fail('Request too large.',413));const raw=await req.text();if(raw.length>12000)return respond(fail('Request too large.',413));const body=JSON.parse(raw);
    if(body.type==='create'){
      const name=clean(body.name),gameName=clean(body.gameName,40);if(!name||!gameName)return respond(fail('Enter your name and a name for the game.'));
      const roundMinutes=validateRoundMinutes(body.roundMinutes);if(body.adminPasscode!==undefined)validatePlayerCode(body.adminPasscode);
      await deleteExpiredGames(db());
      for(let i=0;i<5;i++){
        const gameCode=code(),token=crypto.randomUUID()+crypto.randomUUID(),inviteKey=makeInviteKey(),expiresAt=Date.now()+GAME_RETENTION_MS;
        const player={id:crypto.randomUUID(),name,tokenHashes:[await hashSecret(token)]};
        const g:any=makeGame(gameCode,gameName,player,Date.now(),roundMinutes);g.authSalt=crypto.randomUUID();g.inviteKey=inviteKey;
        const login=await newLogin(g,body.adminPasscode);g.players[0].loginHash=login.loginHash;
        const r=await db().prepare('INSERT OR IGNORE INTO games (code, state, version, expires_at, invite_hash) VALUES (?, ?, 0, ?, ?)').bind(gameCode,JSON.stringify(g),expiresAt,await hashSecret(inviteKey)).run();
        if(r.meta.changes===1)return respond(ok({token,passcode:login.passcode,view:gameView(g,player.id,expiresAt)},201));
      }throw new Error('Could not create the game. Please try again.');
    }
    const gameCode=readCode(body.code);
    if(body.type==='join'){
      const name=clean(body.name);if(!name)return respond(fail('Enter your name.'));const token=crypto.randomUUID()+crypto.randomUUID(),tokenHash=await hashSecret(token),id=crypto.randomUUID();
      return await update(gameCode,async(g,row)=>{if(!await matchingInvite(row,body.invite))return unavailable();tick(g);const login=await newLogin(g);addPlayer(g,{id,name,loginHash:login.loginHash,tokenHashes:[tokenHash]});return ok({token,passcode:login.passcode,view:gameView(g,id,row.expires_at)});});
    }
    if(body.type==='login'){
      if(typeof body.passcode!=='string'||!/^\d{6}$/.test(body.passcode))return respond(fail('Enter your six-digit player code.'));
      const address=req.headers.get('CF-Connecting-IP')||'local-preview';const clientKey=(await hashSecret(`${gameCode}:${address}`)).slice(0,24);
      return await update(gameCode,async(g,row)=>{
        if(!await matchingInvite(row,body.invite))return unavailable();
        const now=Date.now(),attempts=g.loginAttempts[clientKey];
        if(attempts?.blockedUntil>now)return fail('Too many incorrect codes. Please wait a minute and try again.',429);
        const loginHash=await hashSecret(`${g.authSalt}:${body.passcode}`);const p=g.players.find((p:any)=>p.loginHash===loginHash);
        if(!p){const record=!attempts||now-attempts.since>300000?{count:0,since:now,blockedUntil:0}:attempts;record.count++;if(record.count>=8){record.blockedUntil=now+60000;record.count=0;}g.loginAttempts[clientKey]=record;return fail('That player code was not recognised. Check you opened the right game invite.',401);}
        delete g.loginAttempts[clientKey];const token=crypto.randomUUID()+crypto.randomUUID();p.tokenHashes=[...(p.tokenHashes||[]).slice(-4),await hashSecret(token)];tick(g);return ok({token,passcode:body.passcode,view:gameView(g,p.id,row.expires_at)});
      });
    }
    return await update(gameCode,async(g,row)=>{const p=await tokenPlayer(req,g);if(!p)return fail('Enter your player code to return to the game.',401);applyAction(g,p.id,body);return ok(gameView(g,p.id,row.expires_at));});
  }catch(e){return respond(fail(e instanceof Error?e.message:'Unable to update the game.'));}
}
