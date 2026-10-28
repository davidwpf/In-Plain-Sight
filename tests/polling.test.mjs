import test from 'node:test';
import assert from 'node:assert/strict';
import {createGamePoller,pollDelay} from '../lib/game/polling.mjs';

function clock(){
  let now=0,id=0;const timers=new Map();
  return{
    now:()=>now,
    setTimer(callback,delay){const key=++id;timers.set(key,{at:now+delay,callback});return key;},
    clearTimer(key){timers.delete(key);},
    pending:()=>timers.size,
    async advance(ms){
      const end=now+ms;
      while(true){
        const next=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];
        if(!next||next[1].at>end)break;
        now=next[1].at;timers.delete(next[0]);next[1].callback();
        await flush();
      }
      now=end;await flush();
    },
  };
}
async function flush(){for(let i=0;i<5;i++)await Promise.resolve();}
function fixture({state={phase:'lobby',paused:false},refresh}={}){
  const time=clock(),calls=[];let visible=true,busy=false;
  const poller=createGamePoller({
    getState:()=>state,isVisible:()=>visible,isBusy:()=>busy,
    now:time.now,setTimer:time.setTimer,clearTimer:time.clearTimer,
    async refresh(signal){calls.push(time.now());return refresh?refresh(signal,state):'success';},
  });
  return{time,calls,poller,state,hide(){visible=false;poller.visibilityChanged();},show(){visible=true;poller.visibilityChanged();},busy(value){busy=value;}};
}

test('an hour of an unchanged visible round uses 120 checks; lobby, voting and results stay responsive',async()=>{
  const playing=fixture({state:{phase:'playing',paused:false,deadline:86_400_000}});
  await playing.time.advance(3_600_000);assert.equal(playing.calls.length,120);playing.poller.stop();
  for(const phase of ['lobby','voting','results']){
    const f=fixture({state:{phase,paused:false}});await f.time.advance(60_000);
    assert.equal(f.calls.length,10,phase);f.poller.stop();
  }
});
test('phase changes reschedule immediately, with slower checks while paused',async()=>{
  const f=fixture();await f.time.advance(5_000);
  f.state.phase='playing';f.poller.updated();
  await f.time.advance(29_999);assert.equal(f.calls.length,0);
  await f.time.advance(1);assert.deepEqual(f.calls,[35_000]);
  f.state.phase='voting';f.poller.updated();
  await f.time.advance(6_000);assert.equal(f.calls.at(-1),41_000);
  f.state.paused=true;f.poller.updated();
  await f.time.advance(29_999);assert.equal(f.calls.length,2);
  await f.time.advance(1);assert.equal(f.calls.at(-1),71_000);
  f.state.paused=false;f.poller.updated();
  await f.time.advance(6_000);assert.equal(f.calls.at(-1),77_000);f.poller.stop();
});
test('round and voting deadlines trigger checks without waiting for a full interval',async()=>{
  const f=fixture({state:{phase:'playing',paused:false,deadline:10_000},refresh(signal,state){state.phase='voting';state.voteDeadline=13_000;return 'success';}});
  await f.time.advance(10_099);assert.equal(f.calls.length,0);
  await f.time.advance(1);assert.deepEqual(f.calls,[10_100]);
  await f.time.advance(3_000);assert.deepEqual(f.calls,[10_100,13_100]);f.poller.stop();
  assert.equal(pollDelay({phase:'playing',deadline:0},0,1),6_000);
  assert.equal(pollDelay({phase:'playing',deadline:1,paused:true},0,0),30_000);
});
test('failed connections back off to one minute and recover the normal cadence after success',async()=>{
  let attempts=0;
  const f=fixture({refresh(){return ++attempts<=4?'failed':'success';}});
  await f.time.advance(150_000);
  assert.deepEqual(f.calls,[6_000,18_000,42_000,90_000,150_000]);
  await f.time.advance(6_000);assert.equal(f.calls.at(-1),156_000);f.poller.stop();
});
test('rejected requests also back off, even after a round deadline has expired',async()=>{
  const f=fixture({state:{phase:'playing',paused:false,deadline:10_000},refresh(){throw new Error('Network unavailable');}});
  await f.time.advance(70_099);assert.deepEqual(f.calls,[10_100]);
  await f.time.advance(1);assert.deepEqual(f.calls,[10_100,70_100]);f.poller.stop();
});
test('hidden screens make no new requests and returning checks immediately',async()=>{
  const f=fixture();f.hide();await f.time.advance(3_600_000);assert.equal(f.calls.length,0);
  f.show();await flush();assert.deepEqual(f.calls,[3_600_000]);
  await f.time.advance(6_000);assert.equal(f.calls.length,2);f.poller.stop();
});
test('slow refreshes never overlap, including repeated online or visibility events',async()=>{
  let resolve;const f=fixture({refresh:()=>new Promise(done=>{resolve=done;})});
  await f.time.advance(6_000);assert.equal(f.calls.length,1);
  for(let i=0;i<5;i++){f.poller.checkNow();f.show();}
  await f.time.advance(60_000);assert.equal(f.calls.length,1);
  resolve('success');await flush();
  await f.time.advance(5_999);assert.equal(f.calls.length,1);
  await f.time.advance(1);assert.equal(f.calls.length,2);f.poller.stop();
});
test('an in-flight response cannot restart polling after a screen is hidden or disposed',async()=>{
  let resolve,signal;const f=fixture({refresh:s=>{signal=s;return new Promise(done=>{resolve=done;});}});
  await f.time.advance(6_000);f.hide();resolve('success');await flush();
  assert.equal(f.time.pending(),0);
  f.show();await flush();assert.equal(f.calls.length,2);
  f.poller.stop();assert.equal(signal.aborted,true);resolve('success');await flush();
  await f.time.advance(3_600_000);assert.equal(f.calls.length,2);assert.equal(f.time.pending(),0);
});
test('ended games stop completely, including checks requested by returning or reconnecting',async()=>{
  const f=fixture();await f.time.advance(6_000);
  f.state.phase='ended';f.poller.updated();
  f.poller.checkNow();f.hide();f.show();await flush();await f.time.advance(86_400_000);
  assert.deepEqual(f.calls,[6_000]);assert.equal(f.time.pending(),0);f.poller.stop();
});
test('busy player actions suppress checks, and their successful response resets retry backoff',async()=>{
  let fail=true;const f=fixture({refresh:()=>fail?'failed':'success'});
  f.busy(true);await f.time.advance(12_000);assert.equal(f.calls.length,0);
  f.busy(false);await f.time.advance(6_000);assert.deepEqual(f.calls,[18_000]);
  fail=false;f.poller.updated();await f.time.advance(6_000);
  assert.deepEqual(f.calls,[18_000,24_000]);f.poller.stop();
});
test('an online event can recover immediately during backoff without leaving extra timers',async()=>{
  let fail=true;const f=fixture({refresh:()=>fail?'failed':'success'});
  await f.time.advance(6_000);fail=false;f.poller.checkNow();await flush();
  assert.deepEqual(f.calls,[6_000,6_000]);assert.equal(f.time.pending(),1);
  await f.time.advance(6_000);assert.deepEqual(f.calls,[6_000,6_000,12_000]);f.poller.stop();
});
