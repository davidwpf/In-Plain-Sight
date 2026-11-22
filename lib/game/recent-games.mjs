export const RECENT_GAMES_KEY='in-plain-sight.recent-games.v1';
export const MAX_RECENT_GAMES=8;
const WEEK=7*24*60*60*1000;
function read(storage){try{return JSON.parse(storage?.getItem(RECENT_GAMES_KEY)??'[]');}catch{return [];}}
function write(storage,games){try{storage?.setItem(RECENT_GAMES_KEY,JSON.stringify(games));}catch{}}
function entry(value,now){
  if(!value||typeof value!=='object'||value.demo||typeof value.code!=='string'||!/^[A-Z2-9]{6}$/.test(value.code)||!Number.isFinite(value.expiresAt)||value.expiresAt<=now)return null;
  const gameName=typeof value.gameName==='string'?value.gameName.trim().slice(0,40):'';
  if(!gameName)return null;
  return {code:value.code,gameName,playerName:typeof value.playerName==='string'?value.playerName.trim().slice(0,24):'',expiresAt:value.expiresAt,lastOpenedAt:Number.isFinite(value.lastOpenedAt)?value.lastOpenedAt:now};
}
export function recentGames(storage,now=Date.now()){
  const raw=read(storage),unique=new Map();
  if(Array.isArray(raw))for(const value of raw){const game=entry(value,now);if(game&&(!unique.has(game.code)||unique.get(game.code).lastOpenedAt<game.lastOpenedAt))unique.set(game.code,game);}
  const games=[...unique.values()].sort((a,b)=>b.lastOpenedAt-a.lastOpenedAt).slice(0,MAX_RECENT_GAMES);write(storage,games);return games;
}
export function rememberRecentGame(value,storage,now=Date.now()){
  const games=recentGames(storage,now),old=games.find(g=>g.code===value?.code);
  const game=entry({...old,...value,expiresAt:value?.expiresAt??old?.expiresAt??now+WEEK,lastOpenedAt:now},now);
  if(game){const next=[game,...games.filter(g=>g.code!==game.code)].slice(0,MAX_RECENT_GAMES);write(storage,next);return next;}
  return games;
}
export function forgetRecentGame(code,storage,now=Date.now()){const games=recentGames(storage,now).filter(g=>g.code!==code);write(storage,games);return games;}

export function parseGameEntry(value,origin){
  const text=String(value??'').trim(),code=text.toUpperCase().replace(/\s/g,'');
  if(/^[A-Z2-9]{6}$/.test(code))return {code,inviteKey:''};
  try{
    const url=new URL(text);
    if(url.origin!==origin||url.username||url.password)throw Error();
    const invites=url.searchParams.getAll('invite'),codes=[...url.searchParams.getAll('game'),...url.searchParams.getAll('room')];
    if(invites.length===1&&!codes.length&&/^[a-f0-9]{64}$/.test(invites[0]))return {code:'',inviteKey:invites[0]};
    if(!invites.length&&codes.length===1&&/^[A-Z2-9]{6}$/.test(codes[0].toUpperCase()))return {code:codes[0].toUpperCase(),inviteKey:''};
  }catch{}
  throw new Error('Enter a game code or paste a full In Plain Sight invite link.');
}
