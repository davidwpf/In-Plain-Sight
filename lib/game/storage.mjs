export const GAME_RETENTION_MS=7*24*60*60*1000;
export const CLEANUP_CRON='*/5 * * * *';
export function validInviteKey(value){return typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);}
export function makeInviteKey(){return Array.from(crypto.getRandomValues(new Uint8Array(32)),x=>x.toString(16).padStart(2,'0')).join('');}
export async function hashSecret(value){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return Array.from(new Uint8Array(bytes),x=>x.toString(16).padStart(2,'0')).join('');}
export function validatePlayerCode(value){if(typeof value!=='string'||!/^\d{6}$/.test(value))throw new Error('Choose a six-digit player code.');return value;}
export async function deleteExpiredGames(database,now=Date.now()){
  const result=await database.prepare('DELETE FROM games WHERE expires_at <= ?').bind(now).run();
  return result.meta?.changes??0;
}
