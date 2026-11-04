// SPDX-License-Identifier: AGPL-3.0-only
// Real JS DSP plus a Node AudioWorkletProcessor double; not a device playback test.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import vm from 'node:vm';
import {createInstrumentEngine} from '../docs/instrument-engine.js';
import {LiveMelodicPool,melodicTransferList} from '../docs/live-melodic-pool.js';
import {AmbientEngine} from '../docs/audio-engine.js';
import {NoteHistory} from '../docs/note-history.js';
const fixture=()=>({sampleRate:8000,samples:[{pcm:Float32Array.from({length:8000},(_,i)=>Math.sin(i*.2)*.1),sampleRate:8000,rootNote:60,loopStart:1000,loopEnd:6000,crossfade:500}],instruments:Array.from({length:5},(_,layer)=>({layer,gain:.5,attack:.01,release:.1,zones:[{sampleIndex:0,keyLow:60,keyHigh:60,velocityLow:0,velocityHigh:127,gain:1}]}))});
const bank=()=>{const p=LiveMelodicPool.prepare(8000,fixture());return structuredClone(p,{transfer:melodicTransferList(p)})};
const render=(e,n)=>{e.render(new Float32Array(n),new Float32Array(n))};
test('instrument engine shared voice budgets, legacy PCM, and worklet initialization',()=>{
for(const scoreMode of ['original','developing']){
 for(const limit of [8,16,24,32]){
  const e=createInstrumentEngine(8000,42,{scoreMode,scoreConfig:{tonic:4,mode:2,meter:4},melodicBank:bank()});e.setParameters({polyphony:limit});e.score.advanceTo=()=>{};e.start();
  for(let i=0;i<limit;i++)e.noteOn(0,0,i%2?61:60,80000,.8,.5);
  assert.equal(e.getActiveMelodicVoiceCount(),limit);assert.equal(e.recordedMelodicAccepted,limit/2);assert.equal(e.melodicFallbacks,limit/2);
  e.noteOn(0,0,60,80000,.8,.5);e.noteOn(0,0,61,80000,.8,.5);assert.equal(e.getActiveMelodicVoiceCount(),limit);
  render(e,100);e.setParameters({polyphony:8});render(e,800);assert.ok(e.getActiveMelodicVoiceCount()<=8);e.setParameters({polyphony:32});render(e,800);assert.ok(e.getActiveMelodicVoiceCount()<=8);
  e.stop();render(e,10000);assert.equal(e.recordedMelodies.activeVoices,0);e.reset();assert.equal(e.getActiveMelodicVoiceCount(),0);
 }
 console.log('PASS '+scoreMode+' shared sampler+oscillator caps, decrease/reincrease, stop/reset');
}
{
 const e=createInstrumentEngine(8000,42),a=new AmbientEngine(8000,42);e.start();a.start();const l=new Float32Array(32000),r=new Float32Array(32000),ll=new Float32Array(32000),rr=new Float32Array(32000);e.render(l,r);a.render(ll,rr);assert.deepEqual(l,ll);assert.deepEqual(r,rr);console.log('PASS no-melodic/no-drum creation matches legacy PCM');
}
{
 let Processor;class AP{constructor(){this.port={messages:[],postMessage(m){this.messages.push(m)}}}}
 const ctx={AudioWorkletProcessor:AP,registerProcessor:(name,c)=>Processor=c,NoteHistory,createInstrumentEngine,sampleRate:8000,Float32Array};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync(new URL('../docs/instrument-worklet.js',import.meta.url),'utf8').replace(/^import.*\n/gm,''),ctx);
 const bad=new Processor({processorOptions:{seed:42}});const l=new Float32Array(128).fill(1),r=new Float32Array(128).fill(1);bad.process([],[[l,r]]);assert.ok(l.every(x=>x===0));bad.port.onmessage({data:{type:'initialize',requestId:77,melodicBank:{bad:true}}});assert.equal(bad.port.messages[0].type,'initialization-error');bad.port.onmessage({data:{type:'initialize',requestId:78,melodicBank:bank()}});bad.port.onmessage({data:{type:'start'}});assert.equal(bad.engine,null);console.log('PASS rejected worklet cannot activate from later initialize/start');
 const good=new Processor({processorOptions:{seed:42,scoreMode:'developing',scoreConfig:{tonic:7,harmony:'fixed'}}});good.port.onmessage({data:{type:'initialize',requestId:79,melodicBank:bank()}});assert.equal(good.port.messages[0].requestId,79);assert.equal(good.port.messages[0].type,'ready');good.port.onmessage({data:{type:'start'}});for(let i=0;i<100;i++)good.process([],[[l,r]]);assert.ok(l.every(Number.isFinite));good.port.onmessage({data:{type:'reseed',seed:9}});for(let i=0;i<100;i++)good.process([],[[l,r]]);assert.equal(good.engine.seed,9);assert.equal(good.engine.score.config.tonic,7);console.log('PASS initialized worklet renders and reseed preserves manual tonic');
}

});
