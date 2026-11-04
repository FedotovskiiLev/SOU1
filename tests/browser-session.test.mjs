// SPDX-License-Identifier: AGPL-3.0-only
// Deterministic Node tests, mock Web Audio and Node workers, NOT an actual browser/listening test.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Worker} from 'node:worker_threads';
import {createServer} from 'node:http';
import {SessionController,SESSION_HEADROOM} from '../experiments/rack-browser/session-controller.mjs';
import {sessionPhrase,validateSessionRecipe} from '../experiments/rack-browser/session-plan.mjs';
import {composeExpressivePlan} from '../tools/composition/expressive-score.mjs';
import {exportScoreMidi} from '../tools/composition/score-midi.mjs';
const recipe={composer:'expressive',drumKit:'guigui-dynamic',score:{style:'waltz',bars:2,bpm:180,sampleRate:48000,seed:7311,drums:true},phrasing:'lyrical',drumVelocityScale:1.6};
class WorkerFake{constructor(){this.sent=[];}postMessage(v){this.sent.push(v);}terminate(){this.terminated=true;}send(data){this.onmessage?.({data});}}
class ContextFake{
 constructor(){this.state='suspended';this.currentTime=0;this.destination={};this.sources=[];this.gains=[];}
 async resume(){if(this.wait)await this.wait;this.state='running';}
 createBuffer(channels,frames,rate){return{channels,frames,rate,copyToChannel(pcm){assert.equal(pcm.length,frames);}};}
 createGain(){const gain={gain:{value:0,setValueAtTime(v){this.value=v;},linearRampToValueAtTime(v){this.value=v;},setTargetAtTime(v){this.value=v;},cancelScheduledValues(){}},connect(){},disconnect(){this.disconnected=true;}};this.gains.push(gain);return gain;}
 createBufferSource(){const source={connect(){},disconnect(){this.disconnected=true;},start(at){this.startAt=at;this.started=true;},stop(at=0){this.stopAt=at;this.stopped=true;},end(){if(this.ended)return;this.ended=true;this.onended?.();}};this.sources.push(source);return source;}
 advance(time){this.currentTime=time;for(const s of this.sources)if(!s.ended&&s.started&&time>=Math.min(s.stopAt??Infinity,s.startAt+s.buffer.frames/s.buffer.rate))s.end();}
 async close(){this.state='closed';}
}
function fixture(){const workers=[],contexts=[],timers=new Set(),updates=[];const c=new SessionController({makeWorker:()=>{const w=new WorkerFake();workers.push(w);return w;},makeContext:()=>{const a=new ContextFake();contexts.push(a);return a;},setTimer:fn=>{timers.add(fn);return fn;},clearTimer:fn=>timers.delete(fn),onChange:x=>updates.push(x)});return{c,workers,contexts,timers,updates};}
function payload(index,input=recipe){const phrase=sessionPhrase(input,index),{composer,drumKit,...expression}=phrase.recipe,plan=composeExpressivePlan(expression);return{type:'phrase',phrase,left:new Float32Array(plan.frames).fill(.01),right:new Float32Array(plan.frames).fill(.01),sampleRate:plan.options.sampleRate,midiBytes:exportScoreMidi(plan).bytes,report:{options:plan.options,midi:{sourceNotes:plan.sourceEvents.length}}};}
function prepared(){const f=fixture();f.c.prepare(recipe);f.workers[0].send(payload(0));f.workers[0].send(payload(1));return f;}

test('phrase adapter is deterministic, keeps original seed for first phrase, key/meter/tempo fixed',()=>{
 const seeds=new Set();for(let i=0;i<500;i++){const a=sessionPhrase(recipe,i);assert.deepEqual(a,sessionPhrase(recipe,i));assert.equal(a.startBeat,i*6);assert.equal(a.startSeconds,i*2);assert.equal(a.recipe.score.root,60);assert.equal(a.recipe.score.bpm,180);assert.equal(a.recipe.score.style,'waltz');seeds.add(a.seed);}assert.equal(seeds.size,500);assert.equal(sessionPhrase(recipe,0).seed,7311);
 const a=sessionPhrase({...recipe,score:{...recipe.score,sampleRate:44100,bpm:137.25}},1_000_000),b=sessionPhrase({...recipe,score:{...recipe.score,bpm:137.25}},1_000_000);assert.equal(a.seed,b.seed);assert.equal(a.startSeconds,b.startSeconds);
 for(const bad of [-1,NaN,1.1,1_000_001])assert.throws(()=>sessionPhrase(recipe,bad));
 for(const bad of [{composer:'legacy'}, {...recipe,score:{bars:32,bpm:40}}, {...recipe,drumKit:'unknown'}])assert.throws(()=>validateSessionRecipe(bad));
});
test('two phrases are prefetched without context or autoplay and score is not retained as PCM',()=>{const f=prepared();assert.equal(f.c.state,'ready');assert.equal(f.contexts.length,0);assert.equal(f.workers[0].sent.length,2);assert.equal(f.c.queue.length,2);assert.equal(f.c.latest.left,undefined);assert.equal(f.c.latest.phrase.index,0);});
test('start schedules on exact musical grid, fixed overlap headroom, no repeated Play',async()=>{const f=prepared();assert.equal(await f.c.play(),true);assert.equal(await f.c.play(),false);const ctx=f.contexts[0];assert.equal(ctx.sources.length,2);assert.equal(ctx.sources[0].startAt,.1);assert.equal(ctx.sources[1].startAt,2.1);assert.equal(ctx.gains[0].gain.value,.35*SESSION_HEADROOM);assert.equal(f.c.queue.length,0);assert.equal(f.workers[0].sent.length,3);f.c.setVolume(1);assert.equal(ctx.gains[0].gain.value,SESSION_HEADROOM);});
test('long simulated session stays bounded, preserves sequential phrases and never slips its clock',async()=>{
 const f=prepared();await f.c.play();const w=f.workers[0],ctx=f.contexts[0];
 for(let i=2;i<180;i++){
  w.send(payload(i));assert.ok(f.c.queue.length<=1);ctx.advance(.1+(i-1)*2+1e-6);for(const tick of f.timers)tick();assert.equal(f.c.state,'playing');assert.equal(ctx.sources.at(-1).startAt,.1+i*2);assert.ok(f.c.nodes.length<=3);assert.ok(f.c.queue.length<=1);assert.equal(f.c.latest.phrase.index,i);assert.equal(f.c.latest.left,undefined);
 }
 f.c.stop();assert.equal(f.timers.size,0);assert.equal(f.c.nodes.length,0);assert.equal(f.c.queue.length,0);assert.ok(w.terminated);ctx.advance(ctx.currentTime+.04);assert.ok(ctx.gains[0].disconnected);
});
test('late preparation stops without skipping or changing musical time',async()=>{const f=prepared();await f.c.play();const ctx=f.contexts[0];ctx.advance(4.08);for(const tick of f.timers)tick();assert.equal(f.c.state,'error');assert.match(f.c.error,/deadline/);assert.equal(ctx.sources.length,2);assert.ok(f.workers[0].terminated);f.workers[0].send(payload(2));assert.equal(f.c.state,'error');});
test('late timer with a prepared phrase does not catch up by dropping notes',async()=>{const f=prepared();await f.c.play();f.workers[0].send(payload(2));f.contexts[0].advance(4.2);for(const tick of f.timers)tick();assert.equal(f.c.state,'error');assert.equal(f.contexts[0].sources.length,2);});
test('stale prepare, stop, error and resume cannot resurrect previous audio',async()=>{
 const f=prepared();let release;const ctx=new ContextFake();ctx.wait=new Promise(r=>release=r);f.c.makeContext=()=>ctx;const promise=f.c.play();assert.equal(f.c.state,'resuming');f.c.stop();release();assert.equal(await promise,false);assert.equal(ctx.sources.length,0);f.workers[0].send(payload(2));assert.equal(f.c.state,'idle');
 f.c.prepare({...recipe,score:{...recipe.score,seed:5}});f.workers[0].onerror({message:'stale'});assert.equal(f.c.state,'preparing');assert.equal(f.workers[1].sent[0].recipe.score.seed,5);f.c.cancel();assert.ok(f.workers[1].terminated);
});
test('interrupt/dispose stops scheduled nodes, clears timer and never plays on restore',async()=>{const f=prepared();await f.c.play();const ctx=f.contexts[0];ctx.state='suspended';ctx.onstatechange();assert.equal(f.c.state,'error');assert.match(f.c.error,/interrupted/);assert.ok(ctx.sources.every(s=>s.stopped&&s.disconnected));assert.ok(ctx.gains[0].disconnected);assert.equal(f.timers.size,0);await f.c.dispose();await f.c.dispose();assert.equal(ctx.state,'closed');assert.equal(f.c.state,'disposed');assert.throws(()=>f.c.prepare(recipe));});
test('invalid/unrequested worker data fails atomically, valid MIDI is copied',()=>{
 for(const alter of [x=>x.phrase.index++,x=>x.phrase.startSeconds=5,x=>x.left[0]=NaN,x=>x.left[0]=1,x=>x.sampleRate=8000,x=>x.right=new Float32Array(1),x=>x.midiBytes=new Uint8Array(30)]){const f=fixture();f.c.prepare(recipe);const p=payload(0);alter(p);f.workers[0].send(p);assert.equal(f.c.state,'error');assert.equal(f.c.queue.length,0);assert.ok(f.workers[0].terminated);}
 const f=prepared();const original=f.c.latest.midiBytes.slice();assert.ok(original.length>0);f.workers[0].send(payload(2));assert.equal(f.c.state,'error');assert.match(f.c.error,/Unexpected/);
 const g=fixture();g.c.prepare(recipe);const p=payload(0),expected=p.midiBytes.slice();g.workers[0].send(p);p.midiBytes[0]=0;g.workers[0].send(payload(1));assert.deepEqual(g.c.latest.midiBytes,expected);
});
test('construction, post, resume and schedule failures leave no active session',async()=>{
 for(const point of ['worker','post','resume','buffer','start']){const f=fixture();if(point==='worker')f.c.makeWorker=()=>{throw Error(point);};f.c.prepare(recipe);if(point==='post'){f.workers[0].postMessage=()=>{throw Error(point);};f.workers[0].send(payload(0));}else if(point!=='worker'){f.workers[0].send(payload(0));f.workers[0].send(payload(1));const ctx=new ContextFake();if(point==='resume')ctx.resume=async()=>{throw Error(point);};if(point==='buffer')ctx.createBuffer=()=>{throw Error(point);};if(point==='start')ctx.createBufferSource=()=>({connect(){},disconnect(){},start(){throw Error(point);},stop(){}});f.c.makeContext=()=>ctx;assert.equal(await f.c.play(),false);}assert.equal(f.c.state,'error');assert.equal(f.c.worker,null);assert.equal(f.c.queue.length,0);assert.equal(f.timers.size,0);}
});

test('actual Node worker caches verified samples once and sends canonical PCM/MIDI for changing phrases',async()=>{
 const root=new URL('../',import.meta.url);
 const server=createServer(async(req,res)=>{try{const p=new URL('.'+req.url,root);if(!p.href.startsWith(root.href))throw Error('path');res.end(await readFile(p));}catch{res.statusCode=404;res.end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+server.address().port+'/';
 const workerUrl=new URL('../experiments/rack-browser/session-worker.mjs',import.meta.url).href;
 const worker=new Worker(`const {parentPort}=require('node:worker_threads');let fetches=0;globalThis.crypto=require('node:crypto').webcrypto;const realFetch=fetch;globalThis.fetch=async (...args)=>{fetches++;return realFetch(...args);};globalThis.self={location:{href:${JSON.stringify(base+'experiments/rack-browser/session-worker.mjs')}},postMessage:(data,transfer)=>parentPort.postMessage({...data,fetches},transfer)};import(${JSON.stringify(workerUrl)}).then(()=>parentPort.on('message',data=>self.onmessage({data})));`,{eval:true});
 const pending=[];worker.on('message',m=>pending.shift()?.(m));
 const request=data=>new Promise((resolve,reject)=>{pending.push(resolve);worker.once('error',reject);worker.postMessage(data);});
 try{
  const first=await request({type:'init',recipe});assert.equal(first.type,'phrase',JSON.stringify(first));assert.ok(first.fetches>10);let fetches=first.fetches;
  const {loadScoreBank}=await import('../tools/render-score-cue.mjs'),{renderBrowserPlan}=await import('../experiments/rack-browser/render.mjs');const bank=await loadScoreBank(recipe.drumKit);
  for(let i=0;i<4;i++){
   const actual=i===0?first:await request({type:'next'});assert.equal(actual.type,'phrase');assert.equal(actual.fetches,fetches);assert.equal(actual.phrase.index,i);const {composer,drumKit,...options}=sessionPhrase(recipe,i).recipe,plan=composeExpressivePlan(options),reference=renderBrowserPlan(plan,bank.instruments);assert.deepEqual(actual.left,reference.left);assert.deepEqual(actual.right,reference.right);assert.deepEqual(actual.midiBytes,exportScoreMidi(plan).bytes);assert.equal(actual.report.rack.dropped,0);assert.equal(actual.report.rack.unmapped,0);
  }
 }finally{await worker.terminate();server.closeAllConnections();await new Promise(r=>server.close(r));}
});
test('session module graph stays browser-compatible',async()=>{
 const seen=new Set();async function visit(url){if(seen.has(url.href))return;seen.add(url.href);const s=await readFile(url,'utf8');for(const m of s.matchAll(/(?:import|export)\s[^;\n]*?from\s*['"]([^'"]+)['"]/g)){assert.ok(m[1].startsWith('.'));await visit(new URL(m[1],url));}}await visit(new URL('../experiments/rack-browser/session-worker.mjs',import.meta.url));await visit(new URL('../experiments/rack-browser/session-controller.mjs',import.meta.url));assert.ok(seen.size>=10);
});

test('fractional BPM preserves canonical active-frame rounding',()=>{
 const input={...recipe,score:{...recipe.score,style:'song',bpm:179.98382957781138}};
 const p=payload(0,input),expected=sessionPhrase(input,0);assert.equal(expected.frames,224012);assert.equal(p.left.length,expected.frames);
 const f=fixture();f.c.prepare(input);f.workers[0].send(p);f.workers[0].send(payload(1,input));assert.equal(f.c.state,'ready');
});
test('allocation or copy delay is checked again before starting each AudioBuffer',async()=>{
 for(const trigger of [1,2]){const f=prepared(),ctx=new ContextFake();let count=0;const create=ctx.createBuffer.bind(ctx);ctx.createBuffer=(...args)=>{const buffer=create(...args);if(++count===trigger)ctx.currentTime=trigger===1?.2:2.2;return buffer;};f.c.makeContext=()=>ctx;assert.equal(await f.c.play(),false);assert.equal(f.c.state,'error');assert.match(f.c.error,/deadline/);assert.ok(ctx.sources.every(s=>!s.started||s.stopped));assert.equal(f.timers.size,0);}
});
test('session UI keeps prepare/play explicit, stops on hide, restores empty, and exports only a phrase on click',async()=>{
 const originals={document:globalThis.document,window:globalThis.window,Worker:globalThis.Worker,AudioContext:globalThis.AudioContext,setInterval:globalThis.setInterval,clearInterval:globalThis.clearInterval,setTimeout:globalThis.setTimeout},create=URL.createObjectURL,revoke=URL.revokeObjectURL;
 const elements=new Map(),workers=[],contexts=[],downloads=[],blobs=[],docEvents=new Map(),windowEvents=new Map(),timers=new Set();
 const values={style:'waltz',phrasing:'lyrical',bars:'2',bpm:'180',seed:'7311','drum-kit':'guigui-dynamic','drum-velocity':'1.6','render-gain':'4',volume:'35'};
 function element(id){if(!elements.has(id))elements.set(id,{value:values[id]??'',checked:true,events:new Map(),addEventListener:(name,fn)=>elements.get(id).events.set(name,fn),reportValidity:()=>true});return elements.get(id);}
 globalThis.document={hidden:false,getElementById:element,addEventListener:(k,fn)=>docEvents.set(k,fn),body:{append(){}},createElement:()=>({click(){downloads.push(this.download);},remove(){}})};
 globalThis.window={isSecureContext:true,addEventListener:(k,fn)=>windowEvents.set(k,fn)};globalThis.Worker=class extends WorkerFake{constructor(){super();workers.push(this);}};globalThis.AudioContext=class extends ContextFake{constructor(){super();contexts.push(this);}};
 globalThis.setInterval=fn=>{timers.add(fn);return fn;};globalThis.clearInterval=fn=>timers.delete(fn);globalThis.setTimeout=fn=>{fn();return 0;};URL.createObjectURL=blob=>{blobs.push(blob);return 'blob:test';};URL.revokeObjectURL=()=>{};
 try{
  await import('../experiments/rack-browser/session-app.mjs?test-ui');const submit=()=>element('settings').events.get('submit')({preventDefault(){},target:element('settings')});submit();workers[0].send(payload(0));workers[0].send(payload(1));assert.equal(contexts.length,0);assert.equal(element('play').disabled,false);assert.equal(downloads.length,0);
  element('midi').events.get('click')();assert.deepEqual(downloads,['sou1-phrase-0-seed-7311.mid']);assert.equal(blobs[0].type,'audio/midi');assert.deepEqual(new Uint8Array(await blobs[0].arrayBuffer()),payload(0).midiBytes);
  element('play').events.get('click')();await new Promise(r=>setImmediate(r));assert.equal(contexts[0].sources.length,2);assert.equal(timers.size,1);
  document.hidden=true;docEvents.get('visibilitychange')();assert.ok(workers[0].terminated);assert.ok(contexts[0].sources.every(s=>s.stopped));assert.equal(timers.size,0);assert.equal(element('play').disabled,true);
  windowEvents.get('pagehide')();windowEvents.get('pageshow')({persisted:true});await new Promise(r=>setImmediate(r));assert.equal(contexts[0].state,'closed');assert.equal(contexts.length,1);assert.equal(element('midi').disabled,true);assert.match(element('status').textContent,/Nothing plays/);element('seed').value='2';submit();assert.equal(workers[1].sent[0].recipe.score.seed,2);windowEvents.get('pagehide')();
 }finally{URL.createObjectURL=create;URL.revokeObjectURL=revoke;for(const [k,v] of Object.entries(originals)){if(v===undefined)delete globalThis[k];else globalThis[k]=v;}}
});
