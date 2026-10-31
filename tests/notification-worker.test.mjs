import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {MessageChannel} from 'node:worker_threads';
const source=readFileSync(new URL('../public/sw.js',import.meta.url),'utf8');
function worker(windows=[]){
  const handlers={},shown=[],opened=[];
  const self={addEventListener:(type,handler)=>handlers[type]=handler,location:{origin:'https://game.test'},registration:{async showNotification(title,options){shown.push({title,options});}},clients:{async matchAll(){return windows;},async openWindow(url){opened.push(url);}}};
  vm.runInNewContext(source,{self,URL,MessageChannel,setTimeout,clearTimeout});
  async function event(type,value){let done;handlers[type]({...value,waitUntil:promise=>done=promise});await done;}
  return {event,shown,opened};
}
test('service worker shows a generic persistent notification using device sound settings with the correct dagger icon',async()=>{
  const w=worker();await w.event('push',{data:{json:()=>({type:'roundtable',game:'ABC234',tag:'roundtable-ABC234-2',title:'Private fake title',body:'Private fake body',url:'https://evil.test'})}});
  assert.equal(w.shown.length,1);const notification=w.shown[0];assert.equal(notification.title,'Roundtable is open');assert.equal(Object.hasOwn(notification.options,'silent'),false);assert.equal(notification.options.icon,'/icons/icon-192.png');assert.equal(notification.options.tag,'roundtable-ABC234-2');
  assert.ok(!JSON.stringify(notification).includes('Private'));assert.ok(!JSON.stringify(notification).includes('evil.test'));
  assert.equal(notification.options.renotify,undefined);
});
test('malformed push data still produces the visible fallback required by mobile browsers',async()=>{
  const w=worker();await w.event('push',{data:{json:()=>{throw new Error('broken');}}});assert.equal(w.shown.length,1);assert.equal(w.shown[0].title,'Roundtable is open');
});
test('notification click focuses the matching game instead of navigating a different game',async()=>{
  const actions=[];
  const client=(id,code)=>({url:'https://game.test/',postMessage(message,ports){if(message.type==='which-game')ports[0].postMessage({game:code});else actions.push(`${id}:${message.type}`);},async focus(){actions.push(`${id}:focus`);}});
  const w=worker([client('wrong','XYZ234'),client('right','ABC234')]);let closed=false;
  await w.event('notificationclick',{notification:{data:{game:'ABC234'},close(){closed=true;}}});assert.equal(closed,true);assert.deepEqual(actions,['right:roundtable-opened','right:focus']);assert.deepEqual(w.opened,[]);
});
test('a test notification uses the same push display path without private gameplay details',async()=>{
  const w=worker();await w.event('push',{data:{json:()=>({type:'test'})}});assert.equal(w.shown[0].title,'Notifications are working');assert.equal(Object.hasOwn(w.shown[0].options,'silent'),false);assert.equal(w.shown[0].options.renotify,true);
});
