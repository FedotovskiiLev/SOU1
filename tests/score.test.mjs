// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const weather=await readFile(new URL('../docs/environment-audio.js',import.meta.url),'utf8');
const source=(await readFile(new URL('../docs/audio-engine.js',import.meta.url),'utf8')).replace("'./environment-audio.js'",JSON.stringify(`data:text/javascript;base64,${Buffer.from(weather).toString('base64')}`));
const {AmbientEngine,EventScore,DEFAULTS}=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const collect=(e,seconds,seed=91)=>{const s=new EventScore(8000,seed),events=[];s.advanceTo(seconds*8000-1,e,{noteOn(...event){events.push(event);}});return {s,events};};
const slow=collect(0,10800),fast=collect(1,600);
assert.equal(DEFAULTS.evolution,0);assert.equal(slow.s.chordChanges,2);assert(fast.s.chordChanges>=20);
assert.deepEqual(slow.events,collect(0,10800).events);assert.notDeepEqual(fast.events,collect(1,600,92).events);
for(const data of [slow,fast]){
 const layers=new Set(),pitches=new Set();let previous=-1;
 for(const [at,k,pitch,duration,velocity,pan] of data.events){assert(at>=previous);previous=at;assert(Number.isInteger(at)&&Number.isInteger(duration));assert(pitch>=50&&pitch<=89);assert(duration>0&&duration<=32*8000);assert(velocity>0&&velocity<=1);assert(pan>=.15&&pan<=.85);layers.add(k);pitches.add(pitch);}
 assert.equal(layers.size,5);assert(pitches.size>=10);
 // Compute exact theoretical polyphony including instrument release tails.
 const boundaries=data.events.flatMap(([at,k,p,d])=>[[at,1],[at+d+Math.round(8000*(k===0?4:k===3?6:.8)),-1]]).sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
 let active=0,max=0;for(const [,d]of boundaries){active+=d;max=Math.max(max,active);}assert(max<=32);assert.equal(active,0);
}
// Chunk-independent event clock, including 3-hour texture mode.
const chunked=new EventScore(8000,91),events=[];for(let t=0;t<10800*8000;t+=8000*71)chunked.advanceTo(t,0,{noteOn(...e){events.push(e);}});chunked.advanceTo(10800*8000-1,0,{noteOn(...e){events.push(e);}});assert.deepEqual(events,slow.events);
const a=new AmbientEngine(8000,91),l=new Float32Array(8000),r=new Float32Array(8000);a.setParameters({evolution:1,density:1,rainType:3,rain:1,thunder:1,wind:1,pad:1,pluck:1,bell:1,texture:1,pulse:1,wash:1,strength:1});a.start();
let energy=0;for(let t=0;t<180;t++){a.render(l,r);for(let i=0;i<l.length;i++){assert(Number.isFinite(l[i])&&Math.abs(l[i])<.85);assert(Number.isFinite(r[i])&&Math.abs(r[i])<.85);energy+=l[i]**2+r[i]**2;}}
assert(energy>10);assert(a.noteOnCount>150);assert(a.noteOffCount>140);assert.equal(a.droppedNotes,0);
a.stop();for(let t=0;t<3;t++)a.render(l,r);assert(a.isSilent());assert(l.every(v=>v===0));const frozen=a.frame;a.render(l,r);assert.equal(a.frame,frozen);a.start();a.render(l,r);assert(l.some(v=>v!==0));a.reset();assert(a.isSilent());assert.equal(a.frame,0);assert.equal(a.noteOnCount,0);assert(a.voices.every(v=>!v.active));a.render(l,r);assert(l.every(v=>v===0));a.start();a.render(l,r);assert(l.some(v=>v!==0));
console.log(`PASS event score: 3h slow ${slow.events.length} events/2 changes; 10m evolving ${fast.events.length} events/${fast.s.chordChanges} changes; finite full mix, polyphony, note-offs, reset/restart`);
