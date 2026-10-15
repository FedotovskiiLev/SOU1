// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const weather=await readFile(new URL('../docs/environment-audio.js',import.meta.url),'utf8');
const source=(await readFile(new URL('../docs/audio-engine.js',import.meta.url),'utf8')).replace("'./environment-audio.js'",JSON.stringify(`data:text/javascript;base64,${Buffer.from(weather).toString('base64')}`));
const {AmbientEngine,EventScore,DEFAULTS}=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const rate=8000;
function trace(composition,extra={},seed=91){const score=new EventScore(rate,seed),events=[];score.advanceTo(rate*120-1,{...DEFAULTS,composition,ambient:composition===0?1:0,counterpoint:composition===1?1:0,rhythmic:composition===2?1:0,arpeggio:composition===3?1:0,...extra},{noteOn(...event){events.push(event);}});return events;}
const longform=new EventScore(rate,91);longform.advanceTo(rate*10800-1,DEFAULTS,{noteOn(){}});assert.equal(longform.chordChanges,2,'three-hour pad endpoint preserves three harmonies');
const signatures=new Set();
for(let mode=0;mode<4;mode++){
 const events=trace(mode),same=trace(mode),other=trace(mode,{},92);assert.deepEqual(events,same);assert.notDeepEqual(events,other);
 signatures.add(JSON.stringify(events));let previous=-1;
 const scale=new Set([0,2,3,5,7,8,10].map(x=>(x+50+91%6)%12));
 for(const [frame,k,pitch,duration,velocity,pan]of events){assert(frame>=previous);previous=frame;assert(Number.isInteger(frame)&&Number.isInteger(duration));assert(duration>0);assert(velocity>0&&velocity<=1);assert(pan>=.15&&pan<=.85);assert(k<5);assert(scale.has(pitch%12),'diatonic pitch');assert(pitch>=33&&pitch<=98);}
 assert(events.some(e=>e[1]===0)&&events.some(e=>e[1]===1));
 const muted=trace(mode,{melodyEnabled:false});assert(!muted.some(e=>e[1]===1||e[1]===2));assert(muted.some(e=>e[1]===0));
 const drum=trace(mode,{drumsEnabled:true});assert.deepEqual([...new Set(drum.filter(e=>e[1]>=5).map(e=>e[1]))].sort(),[5,6,7,8,9]);
 const faster=trace(mode,{bpm:144});assert(faster.length>events.length*1.6,'BPM changes event density');
 console.log(`Mode ${mode}: ${events.length} musical events /120s, ${drum.length-events.length} drum events`);
}
assert.equal(signatures.size,4);
// Same tonic, different seeds must alter actual rhythmic/pitch structure, not merely mix.
for(let mode=0;mode<4;mode++){
 const structure=seed=>trace(mode,{},seed).filter(e=>e[1]===1||e[1]===2).map(e=>e.slice(0,4));
 assert.notDeepEqual(structure(91),structure(97),`mode ${mode} structural seed variation`);
}
const a=new AmbientEngine(rate,91),l=new Float32Array(128),r=new Float32Array(128);
a.setParameters({bpm:999,composition:99,polyphony:7,melodyEnabled:'false',drumsEnabled:true,kick:-4});assert.equal(a.parameters.bpm,180);assert.equal(a.parameters.composition,3);assert.equal(a.parameters.polyphony,16);assert.equal(a.parameters.melodyEnabled,true);assert.equal(a.parameters.kick,0);
a.setParameters({bpm:120,composition:1,polyphony:8});a.start();
let peak=0,delta=0,last=0;const active=new Map();
a.onNoteOn=(frame,k,p,d,v,pan,id)=>active.set(id,{frame,d,k});
a.onNoteOff=(frame,k,p,id)=>{const event=active.get(id);assert(event,'paired note-off');assert.equal(frame,event.frame+event.d,'sample-exact gate');active.delete(id);};
for(let i=0;i<rate*20/128;i++){a.render(l,r);assert(a.voices.slice(0,32).filter(v=>v.active).length<=8);assert(a.voices.slice(32).filter(v=>v.active).length<=12);for(const x of l){assert(Number.isFinite(x));peak=Math.max(peak,Math.abs(x));delta=Math.max(delta,Math.abs(x-last));last=x;}}
assert(peak>0&&peak<.85);assert(delta<.15);
a.onNoteOn=null;a.onNoteOff=null;
a.setParameters({melodyEnabled:false,drumsEnabled:false});for(let i=0;i<20;i++)a.render(l,r);assert(!a.voices.some(v=>v.active&&(v.instrument===1||v.instrument===2||v.instrument>=5)));
const saved=a.parameters;a.reseed(123);for(let i=0;i<20;i++)a.render(l,r);assert.equal(a.seed,123);assert.equal(a.parameters,saved);assert(a.playing);assert.equal(a.pendingSeed,null);assert.equal(a.seedGain,1);
a.stop();for(let i=0;i<130;i++)a.render(l,r);assert(a.isSilent());a.reseed(999);a.render(l,r);assert.equal(a.seed,999);assert(a.isSilent());assert(l.every(x=>x===0));a.start();a.render(l,r);assert(l.some(x=>x!==0));
console.log(`PASS four modes, key/phrase/BPM, reproducibility, melody mute, full drumkit, 8+12 bounded voices, exact note-off, live/stopped reseed; peak ${peak.toFixed(4)}, delta ${delta.toFixed(4)}`);

// Visible knobs, not preset names, determine composition. Legacy enum is migration only.
const silentWeights={ambient:0,counterpoint:0,rhythmic:0,arpeggio:0};
assert.equal(trace(0,silentWeights).length,0);
for(let mode=0;mode<4;mode++)assert(trace(mode,{density:1}).length>trace(mode,{density:0}).length,'density changes cadence');
assert.notDeepEqual(trace(1,{complexity:0}),trace(1,{complexity:1}),'complexity changes musical development');
const straight=trace(3,{density:1,swing:0}).filter(e=>e[1]===1),swung=trace(3,{density:1,swing:1}).filter(e=>e[1]===1);
assert.equal(swung[0][0],straight[0][0]);assert(swung[1][0]>straight[1][0]);assert.equal(swung[2][0],straight[2][0],'swing preserves complete beat');
const manual={ambient:.4,counterpoint:.8,rhythmic:.6,arpeggio:.7,density:.7,complexity:.9,swing:.3,bpm:113,polyphony:16};
const x=new AmbientEngine(rate,97),y=new AmbientEngine(rate,97);x.setParameters({...manual,preset:'Bach',composition:3});y.setParameters(manual);x.start();y.start();
const xl=new Float32Array(128),xr=new Float32Array(128),yl=new Float32Array(128),yr=new Float32Array(128);
for(let i=0;i<rate*15/128;i++){x.render(xl,xr);y.render(yl,yr);assert.deepEqual(xl,yl);assert.deepEqual(xr,yr);assert(x.voices.slice(0,32).filter(v=>v.active).length<=16);}
assert.equal(x.parameters.ambient,.4);assert.equal(x.parameters.arpeggio,.7);
const legacy=new AmbientEngine(rate,1);legacy.setParameters({composition:2});assert.equal(legacy.parameters.rhythmic,1);assert.equal(legacy.parameters.ambient,0);
legacy.setParameters({composition:0,...silentWeights});assert.equal(legacy.parameters.rhythmic,0);assert.equal(legacy.parameters.ambient,0);
console.log('PASS visible-knob contract: zero weights, additive mixtures, density, complexity, swing, manual/preset equality, legacy migration');
