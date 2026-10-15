// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const weather=await readFile(new URL('../docs/environment-audio.js',import.meta.url),'utf8');
const source=(await readFile(new URL('../docs/audio-engine.js',import.meta.url),'utf8')).replace("'./environment-audio.js'",JSON.stringify(`data:text/javascript;base64,${Buffer.from(weather).toString('base64')}`));
const {AmbientEngine,DEFAULTS}=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const layers=['pad','pluck','bell','texture','pulse'],results={};
for(const layer of [...layers,'mix']) {
 const e=new AmbientEngine(44100,91),p={};for(const key of layers)p[key]=layer==='mix'||key===layer?DEFAULTS[key]:0;e.setParameters(p);e.start();const l=new Float32Array(44100),r=new Float32Array(44100);let energy=0,peak=0,delta=0,lastL=0,lastR=0;
 for(let t=0;t<60;t++){e.render(l,r);if(t<20)continue;for(let i=0;i<44100;i++){energy+=l[i]**2+r[i]**2;peak=Math.max(peak,Math.abs(l[i]),Math.abs(r[i]));delta=Math.max(delta,Math.abs(l[i]-lastL),Math.abs(r[i]-lastR));lastL=l[i];lastR=r[i];}}
 results[layer]={rms:Math.sqrt(energy/(40*44100*2)),peak,delta};assert(results[layer].rms>1e-5,`${layer} audible nonzero stream`);assert(peak<.85&&delta<.1,`${layer} bounded/smooth`);
}
for(const layer of [...layers,'mix']){const v=results[layer];console.log(`${layer}: RMS ${v.rms.toFixed(6)}, peak ${v.peak.toFixed(5)}, RMS/mix ${(v.rms/results.mix.rms).toFixed(3)}`);}
assert(results.pluck.rms/results.pad.rms>.08,'plucks have measurable presence versus bed');
console.log('PASS layer numerical balance: seed91,44100Hz,default slowmode,20–60s; ratios are not a listening assessment');
