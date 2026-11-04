// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';import assert from 'node:assert/strict';
import {createDevelopingEngine} from '../docs/developing-engine.js';
import {DevelopmentScore} from '../docs/development-score.js';
import {DEFAULTS} from '../docs/audio-engine.js';
import {encodeMidi} from '../docs/midi-export.js';
const bank=()=>({sampleRate:48000,samples:[Float32Array.from({length:9600},(_,i)=>.4*Math.sin(i*.2)*Math.exp(-i/2000))],instruments:['kick','snare','closed-hat','toms','short-clash'].map(id=>({id,gain:.4,oneShot:true,chokeGroup:id==='closed-hat'?'hat':null,zones:[{keyLow:0,keyHigh:127,velocityLow:0,velocityHigh:1,sampleIndex:0}]}))});
const knobs={...DEFAULTS,ambient:.15,counterpoint:.6,rhythmic:1,arpeggio:.35,density:.85,complexity:.85,evolution:.8,bpm:112,drumsEnabled:true,polyphony:24,wash:.25,warmth:.3,rainType:2,rain:.12};
test('continuous score is the exact note source for procedural and recorded engine paths',()=>{
 for(const prepared of [undefined,bank()]){
  const engine=createDevelopingEngine(48000,7311,prepared),events=[];const original=engine.noteOn.bind(engine);engine.noteOn=(...event)=>{events.push(event);original(...event);};engine.setParameters(knobs);engine.start();
  const left=new Float32Array(128),right=new Float32Array(128);let energy=0;
  for(let n=0;n<1200;n++){engine.render(left,right);for(const value of left){assert.ok(Number.isFinite(value)&&Math.abs(value)<.85);energy+=value*value;}}
  const source=new DevelopmentScore(48000,7311),expected=[];source.advanceTo(engine.frame-1,knobs,{noteOn:(...event)=>expected.push(event)});assert.deepEqual(events,expected);assert.ok(events.some(e=>e[1]>=5));assert.ok(events.some(e=>e[1]<5));assert.ok(energy>1);
 }
});
test('reset, reseed and early stop preserve the developing score identity and clear tails',()=>{
 for(const prepared of [undefined,bank()]){
  const e=createDevelopingEngine(48000,7311,prepared),a=new Float32Array(128),b=new Float32Array(128);e.setParameters(knobs);e.start();e.render(a,b);e.reseed(77);for(let n=0;n<40;n++)e.render(a,b);assert.equal(e.seed,77);assert.ok(e.score instanceof DevelopmentScore);assert.equal(e.score.seed,77);
  e.stop();for(let n=0;n<900;n++)e.render(a,b);assert.ok(e.isSilent());if(e.recordedDrums)assert.equal(e.recordedDrums.activeVoices,0);e.reset();assert.equal(e.frame,0);assert.equal(e.score.tick,0);assert.ok(e.score instanceof DevelopmentScore);
  e.start();e.render(new Float32Array(1),new Float32Array(1));e.stop();e.render(new Float32Array(1),new Float32Array(1));assert.ok(e.isSilent());if(e.recordedDrums)assert.equal(e.recordedDrums.activeVoices,0);
 }
});
test('developing Worklet retains generated MIDI history, seed switching and request correlation',async()=>{
 const saved={AudioWorkletProcessor:globalThis.AudioWorkletProcessor,registerProcessor:globalThis.registerProcessor,sampleRate:globalThis.sampleRate};let Processor;
 globalThis.sampleRate=48000;globalThis.AudioWorkletProcessor=class{constructor(){this.messages=[];this.port={postMessage:m=>this.messages.push(m)};}};globalThis.registerProcessor=(name,cls)=>{assert.equal(name,'sou1-developing');Processor=cls;};
 try{
  await import('../docs/developing-worklet.js?development-test');
  for(const wireBank of [undefined,bank()]){const p=new Processor({processorOptions:{seed:7311,wireBank}}),channels=[new Float32Array(128),new Float32Array(128)];p.port.onmessage({data:{type:'parameters',parameters:knobs}});p.port.onmessage({data:{type:'start'}});for(let n=0;n<3000;n++)p.process([],[channels]);
   p.port.onmessage({data:{type:'score-export',requestId:42}});const message=p.messages.at(-1);assert.equal(message.requestId,42);assert.equal(message.score.seed,7311);assert.ok(message.score.events.length>20&&message.score.events.length<=512);const midi=encodeMidi(message.score);assert.ok(midi.noteCount>20);assert.equal(Buffer.from(midi.bytes).subarray(0,4).toString(),'MThd');
   p.port.onmessage({data:{type:'reseed',seed:17}});for(let n=0;n<40;n++)p.process([],[channels]);p.port.onmessage({data:{type:'score'}});assert.equal(p.messages.at(-1).score.seed,17);p.port.onmessage({data:{type:'stop'}});for(let n=0;n<900;n++)p.process([],[channels]);assert.equal(p.messages.at(-1).type,'silent');
  }
 }finally{for(const [k,v] of Object.entries(saved)){if(v===undefined)delete globalThis[k];else globalThis[k]=v;}}
});
