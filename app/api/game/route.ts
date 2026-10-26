import {env} from 'cloudflare:workers';
import {makeGame,addPlayer,applyAction,tick,publicView,randomInt} from '../../../lib/game/engine.mjs';
export const dynamic='force-dynamic';
type Outcome={body:any;status:number};
const headers={'Cache-Control':'no-store, private','Content-Type':'application/json','X-Content-Type-Options':'nosniff'};
const ok=(body:any,status=200):Outcome=>({body,status});
const fail=(error:string,status=400):Outcome=>ok({error},status);
const respond=(o:Outcome)=>new Response(JSON.stringify(o.body),{status:o.status,headers});
function db(){if(!env.DB)throw new Error('Game storage is unavailable. Please try again shortly.');return env.DB;}
async function hash(value:string){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return Array.from(new Uint8Array(bytes),x=>x.toString(16).padStart(2,'0')).join('');}
const clean=(s:unknown,max=24)=>typeof s==='string'?s.trim().replace(/[\u0000-\u001f<>]/g,'').slice(0,max):'';
function code(){const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';return Array.from(crypto.getRandomValues(new Uint8Array(6)),x=>chars[x%32]).join('');}
function readCode(s:unknown){const v=typeof s==='string'?s.toUpperCase().trim():'';if(!/^[A-Z2-9]{6}$/.test(v))throw new Error('Enter a six-character game code.');return v;}
async function newLogin(g:any){for(let i=0;i<50;i++){const passcode=String(randomInt(1000000)).padStart(6,'0');const loginHash=await hash(`${g.authSalt}:${passcode}`);if(!g.players.some((p:any)=>p.loginHash===loginHash))return {passcode,loginHash};}throw new Error('Could not create a player code. Try again.');}
async function update(gameCode:string,operation:(g:any)=>Outcome|Promise<Outcome>){
  for(let attempt=0;attempt<12;attempt++){
    const row=await db().prepare('SELECT state, version, expires_at FROM games WHERE code = ?').bind(gameCode).first<{state:string;version:number;expires_at:number}>();
    if(!row||row.expires_at<Date.now())return respond(fail('Game not found or expired. Check the game code.',404));
    const g=JSON.parse(row.state);if(g.schemaVersion!==2)return respond(fail('This is an earlier prototype game. Please create a new game.',410));
    const result=await operation(g),state=JSON.stringify(g);if(state===row.state)return respond(result);
    const written=await db().prepare('UPDATE games SET state = ?, version = version + 1 WHERE code = ? AND version = ?').bind(state,gameCode,row.version).run();
    if(written.meta.changes===1)return respond(result);
  }return respond(fail('Several players submitted at once. Please try again.',409));
}
async function tokenPlayer(req:Request,g:any){const token=req.headers.get('Authorization')?.replace(/^Bearer /,'');if(!token)return null;const digest=await hash(token);return g.players.find((p:any)=>p.tokenHashes?.includes(digest));}
export async function GET(req:Request){
  try{const gameCode=readCode(new URL(req.url).searchParams.get('code'));return await update(gameCode,async g=>{const p=await tokenPlayer(req,g);if(!p)return fail('Enter your player code to return to the game.',401);tick(g);return ok(publicView(g,p.id));});}
  catch(e){return respond(fail(e instanceof Error?e.message:'Unable to load the game.'));}
}
export async function POST(req:Request){
  try{
    const origin=req.headers.get('Origin');if(origin&&origin!==new URL(req.url).origin)return respond(fail('Use the game website to make changes.',403));
    if(Number(req.headers.get('content-length'))>12000)return respond(fail('Request too large.',413));const raw=await req.text();if(raw.length>12000)return respond(fail('Request too large.',413));const body=JSON.parse(raw);
    if(body.type==='create'){
      const name=clean(body.name),gameName=clean(body.gameName,40);if(!name||!gameName)return respond(fail('Enter your name and a name for the game.'));
      for(let i=0;i<5;i++){
        const gameCode=code(),token=crypto.randomUUID()+crypto.randomUUID();const player={id:crypto.randomUUID(),name,tokenHashes:[await hash(token)]};
        const g:any=makeGame(gameCode,gameName,player);g.authSalt=crypto.randomUUID();const login=await newLogin(g);g.players[0].loginHash=login.loginHash;
        const r=await db().prepare('INSERT OR IGNORE INTO games (code, state, version, expires_at) VALUES (?, ?, 0, ?)').bind(gameCode,JSON.stringify(g),Date.now()+7*86400000).run();
        if(r.meta.changes===1)return respond(ok({token,passcode:login.passcode,view:publicView(g,player.id)},201));
      }throw new Error('Could not create the game. Please try again.');
    }
    const gameCode=readCode(body.code);
    if(body.type==='join'){
      const name=clean(body.name);if(!name)return respond(fail('Enter your name.'));const token=crypto.randomUUID()+crypto.randomUUID(),tokenHash=await hash(token),id=crypto.randomUUID();
      return await update(gameCode,async g=>{tick(g);const login=await newLogin(g);addPlayer(g,{id,name,loginHash:login.loginHash,tokenHashes:[tokenHash]});return ok({token,passcode:login.passcode,view:publicView(g,id)});});
    }
    if(body.type==='login'){
      if(typeof body.passcode!=='string'||!/^\d{6}$/.test(body.passcode))return respond(fail('Enter your six-digit player code.'));
      const address=req.headers.get('CF-Connecting-IP')||'local-preview';const clientKey=(await hash(`${gameCode}:${address}`)).slice(0,24);
      return await update(gameCode,async g=>{
        const now=Date.now();const attempts=g.loginAttempts[clientKey];
        if(attempts?.blockedUntil>now)return fail('Too many incorrect codes. Please wait a minute and try again.',429);
        const loginHash=await hash(`${g.authSalt}:${body.passcode}`);const p=g.players.find((p:any)=>p.loginHash===loginHash);
        if(!p){const record=!attempts||now-attempts.since>300000?{count:0,since:now,blockedUntil:0}:attempts;record.count++;if(record.count>=8){record.blockedUntil=now+60000;record.count=0;}g.loginAttempts[clientKey]=record;return fail('That player code was not recognised. Check the game code too.',401);}
        delete g.loginAttempts[clientKey];const token=crypto.randomUUID()+crypto.randomUUID();p.tokenHashes=[...(p.tokenHashes||[]).slice(-4),await hash(token)];tick(g);return ok({token,passcode:body.passcode,view:publicView(g,p.id)});
      });
    }
    return await update(gameCode,async g=>{const p=await tokenPlayer(req,g);if(!p)return fail('Enter your player code to return to the game.',401);applyAction(g,p.id,body);return ok(publicView(g,p.id));});
  }catch(e){return respond(fail(e instanceof Error?e.message:'Unable to update the game.'));}
}
