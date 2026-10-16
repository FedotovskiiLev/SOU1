// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const source = await readFile(new URL('../docs/environment-audio.js', import.meta.url), 'utf8');
const {EnvironmentAudio} = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const n = 8000, buffer = size => new Float32Array(size);
const engine = (seed=7) => new EnvironmentAudio(n, seed);
let a = engine(), b = engine(), l = buffer(n), r = buffer(n), bl = buffer(n), br = buffer(n);
a.start(); a.render(l,r); assert(l.every(v=>v===0));
a.setParameters({rainType:0,rain:1}); a.render(l,r); assert(l.every(v=>v===0));
a.setParameters({rainType:3,rain:1,thunder:1,wind:1}); b.setParameters(a.parameters); b.start();
// Reset restores seeded transport exactly, preserving targets.
a.reset(); a.start();
for(let j=0;j<30;j++) {
  a.render(l,r);
  for(let i=0;i<n;i+=125) b.render(bl.subarray(i,i+125),br.subarray(i,i+125));
  assert.deepEqual(l,bl); assert.deepEqual(r,br);
  assert(l.every(v=>Number.isFinite(v)&&Math.abs(v)<.45));
}
assert(l.some(v=>v!==0)); a.stop(); for(let j=0;j<3;j++) a.render(l,r);
assert(a.isSilent()); assert(l.every(v=>v===0));
a.reset(); assert.equal(a.outputL,0); a.next(); assert.equal(a.outputL,0);
a.setParameters({rainType:99,rain:-9,thunder:Infinity,wind:NaN});
assert.deepEqual(a.parameters,{rainType:3,rain:0,thunder:1,wind:1});
assert.throws(()=>new EnvironmentAudio(7999)); assert.throws(()=>new EnvironmentAudio(44100.5));
assert.throws(()=>a.setParameters(null)); assert.throws(()=>a.render(l,l));
// Thunder alone must sound, and changing rain must not alter its clock or noise.
a=engine(); b=engine(); a.setParameters({thunder:1}); b.setParameters({thunder:1,rain:1,rainType:3}); a.start();b.start();
let energy=0, peak=0;
for(let j=0;j<60;j++) {a.render(l,r);b.render(bl,br);for(const v of l){energy+=v*v;peak=Math.max(peak,Math.abs(v));}
assert.equal(a.thunderState,b.thunderState);assert.equal(a.rollAge,b.rollAge);assert.equal(a.rollLength,b.rollLength);}
assert(energy>1); assert(peak<.45);
// Each rain variant differs; all invalid controls stay finite. Wind alone works.
const energies=[];
for(let type=1;type<=3;type++) { a=engine(); a.setParameters({rainType:type,rain:1});a.start();a.render(l,r);energies.push(l.reduce((s,v)=>s+v*v,0)); }
assert(energies[0]<energies[1]&&energies[1]<energies[2]);
for(const rate of [8000,44100,48000,96000,192000]) {
 a=new EnvironmentAudio(rate,0);a.setParameters({wind:1});a.start();let e=0;
 for(let i=0;i<rate*2;i++){a.next();assert(Number.isFinite(a.outputL)&&Math.abs(a.outputL)<.45);e+=a.outputL*a.outputL;}assert(e>0);
 a.setParameters({wind:0});for(let i=0;i<rate*3;i++)a.next();assert.equal(a.outputL,0);
}
a=engine();b=engine();a.setParameters({wind:1});b.setParameters(a.parameters);a.start();b.start();l.fill(.1);r.fill(.1);a.mix(l,r);b.render(bl,br);for(let i=0;i<n;i++)assert(Math.abs(l[i]-(.1+bl[i]))<1e-7);
// Ten-minute stress: repeated changes, all layers, stopping/restarting and seeds.
a = engine(0xffffffff); a.start(); let last=0, maxDelta=0;
for(let second=0;second<600;second++) {
 if(second%13===0) a.setParameters({rainType:second%4,rain:second%2,thunder:1,wind:1});
 if(second%97===0) a.stop(); if(second%97===3) a.start();
 a.render(l,r);
 for(const v of l) {assert(Number.isFinite(v)&&Math.abs(v)<.45);maxDelta=Math.max(maxDelta,Math.abs(v-last));last=v;}
}
assert(maxDelta<.9);
// At identical DSP state, a control jump changes only a smoothed fraction.
a=engine(); b=engine(); a.start(); b.start();
a.setParameters({rainType:3,rain:1,thunder:1,wind:1});
a.next();b.next();assert(Math.abs(a.outputL-b.outputL)<.001);
console.log('EnvironmentAudio JS: deterministic blocks/reset, independent thunder, rain variants, rates, finite headroom, smooth stop and silence passed');
// Sample-exact control discontinuity check against an otherwise identical engine.
for(const rate of [8000,48000,192000]) {
 a=new EnvironmentAudio(rate,17);b=new EnvironmentAudio(rate,17);
 a.setParameters({rainType:3,rain:1,thunder:1,wind:1});b.setParameters(a.parameters);a.start();b.start();
 for(let i=0;i<rate*2;i++){a.next();b.next();}
 a.stop();a.next();b.next();
 assert(Math.abs(a.outputL-b.outputL)<.001&&Math.abs(a.outputR-b.outputR)<.001,'stop must change gain smoothly');
 a.reset();b.reset();a.start();b.start();for(let i=0;i<rate/10;i++){a.next();b.next();assert.equal(a.outputL,b.outputL);}
}
// The first thunder frame has no impulsive discontinuity; later returns overlap.
a=engine(7);a.setParameters({thunder:1});a.start();
for(let i=0;i<n*1.5;i++)a.next();
assert.equal(a.outputL,0);assert.equal(a.rollDelay[0],0);
assert(a.rollDelay.slice(1).every((v,i)=>v>a.rollDelay[i]));
assert(a.rollDuration.every(v=>v>=1.4&&v<=3.2));
console.log('Weather event envelopes and sample-level control transitions passed');
