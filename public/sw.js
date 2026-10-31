/* Notifications only: game pages and API responses are never cached. */
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
function savedGame(mode,value){
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open('in-plain-sight-alerts',1);
    request.onupgradeneeded=()=>request.result.createObjectStore('settings');
    request.onerror=()=>reject(request.error);
    request.onsuccess=()=>{
      const db=request.result,transaction=db.transaction('settings',mode==='read'?'readonly':'readwrite'),store=transaction.objectStore('settings'),read=store.get('game');let result;
      read.onsuccess=()=>{result=read.result;if(mode==='write'){store.put(value,'game');result=value;}if(mode==='delete'&&result?.game===value)store.delete('game');};
      transaction.oncomplete=()=>{db.close();resolve(result);};transaction.onerror=()=>{db.close();reject(transaction.error);};
    };
  });
}
self.addEventListener('message',event=>{
  const data=event.data;
  if(data?.type==='remember-game'&&/^[A-Z2-9]{6}$/.test(data.game)&&typeof data.url==='string'&&/^\/\?(invite=[a-f0-9]{64}|game=[A-Z2-9]{6})$/.test(data.url))event.waitUntil(savedGame('write',{game:data.game,url:data.url}));
  if(data?.type==='forget-game')event.waitUntil(savedGame('delete',data.game));
});
self.addEventListener('push',event=>{
  let data={};try{data=event.data?.json()||{};}catch{}
  const test=data.type==='test';
  event.waitUntil(self.registration.showNotification(test?'Notifications are working':'Roundtable is open',{
    body:test?'You’ll be notified when the roundtable opens.':'The round has ended. Open In Plain Sight to vote.',
    icon:'/icons/icon-192.png',badge:'/icons/badge-96.png',silent:true,
    tag:test?'in-plain-sight-test':/^roundtable-[A-Z2-9]{6}-\d+$/.test(data.tag)?data.tag:'in-plain-sight-roundtable',
    data:{game:/^[A-Z2-9]{6}$/.test(data.game)?data.game:null},
  }));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  event.waitUntil((async()=>{
    const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    // Ask open game screens which game they hold. Never navigate a different
    // live game, expose a role or pass a session token into the worker.
    for(const client of windows){
      if(new URL(client.url).origin!==self.location.origin)continue;
      const channel=new MessageChannel();
      const code=await new Promise(resolve=>{const timeout=setTimeout(()=>resolve(null),250);channel.port1.onmessage=message=>{clearTimeout(timeout);resolve(message.data?.game);};client.postMessage({type:'which-game'},[channel.port2]);});
      channel.port1.close();
      if(code&&(event.notification.data?.game===code||!event.notification.data?.game)){client.postMessage({type:'roundtable-opened',game:code});await client.focus();return;}
    }
    // The return invite is stored only on this device, never sent through push.
    let saved;try{saved=await savedGame('read');}catch{}
    const target=saved&&(!event.notification.data?.game||saved.game===event.notification.data.game)?saved.url:'/';
    await self.clients.openWindow(target);
  })());
});
