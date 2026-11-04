// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';import {createHash} from 'node:crypto';import vm from 'node:vm';
import {LiveMelodicPool} from '../docs/live-melodic-pool.js';
import {createInstrumentEngine} from '../docs/instrument-engine.js';
import {prepareMelodicBank} from '../docs/melodic-bank.js';import {NoteHistory} from '../docs/note-history.js';
const rate=8000,seed=0x4405a035,gains=new Float64Array([1,1,1,1,1]);
const fixture=()=>({sampleRate:rate,samples:[{pcm:Float32Array.from({length:8000},(_,i)=>Math.sin(i*.2)*.1),sampleRate:8000,rootNote:60,loopStart:1000,loopEnd:6000,crossfade:500}],instruments:Array.from({length:5},(_,layer)=>({layer,gain:.5,attack:.01,release:.1,zones:[{sampleIndex:0,keyLow:48,keyHigh:72,velocityLow:0,velocityHigh:127,gain:1}]}))});
const digest=a=>createHash('sha256').update(new Uint8Array(a.buffer)).digest('hex');
const fetcher=async url=>new Response(await readFile(url));let fluteBank;
async function bank(){return fluteBank??=(await prepareMelodicBank('chamber-flute',rate,{fetcher,assetBaseUrl:new URL('../docs/melodic-assets/',import.meta.url)})).wireBank;}
function poolRender(p,depth,frames=rate*2,seedValue=seed){const out=new Float64Array(frames*2);for(let i=0;i<frames;i++){p.next(gains,true,depth,i,seedValue);out[i*2]=p.outputL;out[i*2+1]=p.outputR;}return out;}
function fft(a){const n=a.length,r=Float64Array.from(a),im=new Float64Array(n);for(let i=1,j=0;i<n;i++){let b=n>>1;for(;j&b;b>>=1)j^=b;j^=b;if(i<j)[r[i],r[j]]=[r[j],r[i]];}for(let len=2;len<=n;len*=2){const w=-2*Math.PI/len;for(let a=0;a<n;a+=len)for(let j=0;j<len/2;j++){const c=Math.cos(w*j),s=Math.sin(w*j),k=a+j,l=k+len/2,x=r[l]*c-im[l]*s,y=r[l]*s+im[l]*c;r[l]=r[k]-x;im[l]=im[k]-y;r[k]+=x;im[k]+=y;}}return Float64Array.from({length:n/2},(_,i)=>r[i]*r[i]+im[i]*im[i]);}
function spectrum(a,second){const n=4096,p=fft(Float64Array.from({length:n},(_,i)=>a[(Math.round(second*rate)+i)*2]*(.5-.5*Math.cos(2*Math.PI*i/(n-1))))),sum=p.reduce((x,y)=>x+y,0);return p.map(x=>x/sum);}
test('zero sampler depth matches a frozen pre-morph PCM digest exactly',()=>{const p=new LiveMelodicPool(rate,fixture());p.trigger(1,60,10,.8,.5);assert.equal(digest(poolRender(p,0)),'9c768c64dc18c6a85705245b2418781be4ec6d70bd3539fdeb7e33c4cd1a5431');assert.equal(p.timbreDepth,0);});
test('recorded held cello changes spectral shape within one gate, without altering note count or sample position',async()=>{
 const a=LiveMelodicPool.fromPrepared(rate,await bank()),b=LiveMelodicPool.fromPrepared(rate,await bank());a.trigger(0,60,35,.7,.5);b.trigger(0,60,35,.7,.5);const dry=poolRender(a,0,rate*34),wet=poolRender(b,.9,rate*34);let maxShape=0,maxPeak=0;
 for(const second of [5,9,14,19,24,29]){const x=spectrum(dry,second),y=spectrum(wet,second);maxShape=Math.max(maxShape,x.reduce((n,v,i)=>n+Math.abs(v-y[i]),0));}
 for(const v of wet){assert.ok(Number.isFinite(v));maxPeak=Math.max(maxPeak,Math.abs(v));}console.log({maxShape,maxPeak});assert.ok(maxShape>.05);assert.ok(maxPeak<.3);assert.equal(a.stats.accepted,1);assert.equal(b.stats.accepted,1);assert.equal(a.activeVoices,1);assert.equal(b.activeVoices,1);assert.equal(b.stats.unmapped,0);
 console.log(JSON.stringify({scope:'one recorded cello gate',maxNormalizedSpectralDifference:maxShape,maxPeak,notes:b.stats.accepted}));
});
test('engine routes Evolution into recorded leads for hybrid and full recorded palettes, while zero remains compatible',()=>{
 const prepared=LiveMelodicPool.prepare(rate,fixture());
 for(const synthesizedBed of [false,true]){
  const make=enabled=>{const e=createInstrumentEngine(rate,seed,{melodicBank:prepared,synthesizedBed,evolvingTimbre:enabled});e.setParameters({evolution:.8});e.score.advanceTo=()=>{};e.start();e.noteOn(0,1,60,rate*10,.8,.5);return e;};
  const a=make(false),b=make(true),l=new Float32Array(rate*4),r=new Float32Array(l.length),x=new Float32Array(l.length),y=new Float32Array(l.length);a.render(l,r);b.render(x,y);assert.ok(b.recordedMelodies.timbreDepth>.7);assert.equal(a.recordedMelodies.timbreDepth,0);assert.notEqual(digest(l),digest(x));assert.equal(b.recordedMelodicAccepted,1);assert.equal(b.melodicFallbacks,0);
  const c=make(false),d=make(true);c.setParameters({evolution:0});d.setParameters({evolution:0});c.render(l,r);d.render(x,y);assert.deepEqual(l,x);assert.deepEqual(r,y);
 }
});
test('depth changes and Stop have bounded edges, no revived tails, and reset is reproducible',()=>{
 const f=fixture();f.samples[0].pcm.fill(.2);const p=new LiveMelodicPool(rate,f);p.trigger(1,60,20,1,0);let previous=0,maxStep=0;
 for(let i=0;i<rate*3;i++){if(i===rate*2.5)p.setEnabled(false);const depth=i<rate*.5?0:i<rate*1.5?1:0;p.next(gains,p.enabled,depth,i,seed);if(i>200)maxStep=Math.max(maxStep,Math.abs(p.outputL-previous));previous=p.outputL;assert.ok(Number.isFinite(previous));}
 console.log({maxStep});assert.ok(maxStep<.001);assert.equal(p.activeVoices,0);assert.equal(p.outputL,0);p.setEnabled(true);assert.equal(p.activeVoices,0);
 p.reset();p.trigger(1,60,10,.8,.5);const first=poolRender(p,.8);p.reset();p.trigger(1,60,10,.8,.5);assert.deepEqual(poolRender(p,.8),first);console.log(JSON.stringify({scope:'depth/Stop DC edge',maxStep}));
});
test('morph follows equal seed/control schedules across render blocks and click-free reseed/stop',()=>{
 const prepared=LiveMelodicPool.prepare(rate,fixture());
 function run(chunk){const e=createInstrumentEngine(rate,seed,{scoreMode:'developing',melodicBank:prepared,synthesizedBed:true,evolvingTimbre:true});e.setParameters({evolution:.8,ambient:.2,rhythmic:1,arpeggio:.3,polyphony:24});e.start();const out=[];
  for(let phase=0;phase<4;phase++){if(phase===1)e.reseed(42);if(phase===2)e.setParameters({evolution:0});if(phase===3)e.stop();const l=new Float32Array(rate*2),r=new Float32Array(l.length);for(let at=0;at<l.length;at+=chunk)e.render(l.subarray(at,Math.min(l.length,at+chunk)),r.subarray(at,Math.min(r.length,at+chunk)));out.push(l,r);}assert.equal(e.recordedMelodies.activeVoices,0);assert.ok(e.isSilent());return out;}
 assert.deepEqual(run(rate*2),run(97));
 const a=new LiveMelodicPool(rate,fixture()),b=new LiveMelodicPool(rate,fixture());a.trigger(1,60,10,.8,.5);b.trigger(1,60,10,.8,.5);assert.notEqual(digest(poolRender(a,.8,rate*2,1)),digest(poolRender(b,.8,rate*2,2)));
});
test('real worklet initialization and render path reaches the recorded morph, not only an oscillator fallback',async()=>{
 let Processor;class AP{constructor(){this.port={messages:[],postMessage(m){this.messages.push(m);}}}}
 const c={AudioWorkletProcessor:AP,registerProcessor:(name,p)=>Processor=p,NoteHistory,createInstrumentEngine,sampleRate:rate,Float32Array};vm.createContext(c);vm.runInContext((await readFile(new URL('../docs/instrument-worklet.js',import.meta.url),'utf8')).replace(/^import.*\n/gm,''),c);
 const p=new Processor({processorOptions:{seed,scoreMode:'original',synthesizedBed:true,evolvingTimbre:true}});p.port.onmessage({data:{type:'initialize',requestId:1,melodicBank:await bank()}});assert.equal(p.port.messages[0].type,'ready');p.port.onmessage({data:{type:'parameters',parameters:{evolution:.8}}});p.engine.score.advanceTo=()=>{};p.port.onmessage({data:{type:'start'}});p.engine.noteOn(0,1,72,rate*10,.7,.5);const l=new Float32Array(128),r=new Float32Array(128);let energy=0;for(let i=0;i<300;i++){p.process([],[[l,r]]);for(const x of l)energy+=x*x;}assert.ok(energy>0);assert.equal(p.engine.recordedMelodicAccepted,1);assert.equal(p.engine.melodicFallbacks,0);assert.ok(p.engine.recordedMelodies.timbreDepth>.7);
});
