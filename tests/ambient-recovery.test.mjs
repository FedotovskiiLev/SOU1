// SPDX-License-Identifier: AGPL-3.0-only
// CPU DSP/score regressions. No device, listening or AudioWorklet deadline claims.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {AmbientEngine,EventScore} from '../docs/audio-engine.js';
import {DevelopmentScore} from '../docs/development-score.js';
import {createDevelopingEngine} from '../docs/developing-engine.js';
import {createInstrumentEngine} from '../docs/instrument-engine.js';
import {prepareMelodicBank} from '../docs/melodic-bank.js';
const rate=8000,seed=0x4405a035;
const app=await readFile(new URL('../docs/app.js',import.meta.url),'utf8');
const focus=vm.runInNewContext(app.match(/const extraDefaults=.*\nconst presets=.*\nfor\(const key of Object.keys\(presets\)\).*\n/)[0]+';presets.focus');
const fetcher=async url=>new Response(await readFile(url));
const banks=new Map();
async function bank(palette){if(!banks.has(palette))banks.set(palette,(await prepareMelodicBank(palette,rate,{fetcher,assetBaseUrl:new URL('../docs/melodic-assets/',import.meta.url)})).wireBank);return banks.get(palette);}
function render(e,p,n=rate*45,chunk=n){e.setParameters(p);e.start();const l=new Float32Array(n),r=new Float32Array(n);for(let at=0;at<n;at+=chunk){const end=Math.min(n,at+chunk);e.render(l.subarray(at,end),r.subarray(at,end));}return {l,r};}
function fft(a){const n=a.length,r=Float64Array.from(a),im=new Float64Array(n);for(let i=1,j=0;i<n;i++){let b=n>>1;for(;j&b;b>>=1)j^=b;j^=b;if(i<j)[r[i],r[j]]=[r[j],r[i]];}for(let len=2;len<=n;len*=2){const w=-2*Math.PI/len;for(let a=0;a<n;a+=len)for(let j=0;j<len/2;j++){const c=Math.cos(w*j),s=Math.sin(w*j),k=a+j,l=k+len/2,x=r[l]*c-im[l]*s,y=r[l]*s+im[l]*c;r[l]=r[k]-x;im[l]=im[k]-y;r[k]+=x;im[k]+=y;}}return Float64Array.from({length:n/2},(_,i)=>r[i]*r[i]+im[i]*im[i]);}
function spectrum(samples,at,n=8192){const p=fft(Float64Array.from({length:n},(_,i)=>samples[at+i]*(.5-.5*Math.cos(2*Math.PI*i/(n-1))))),sum=p.reduce((a,b)=>a+b,0);return p.map(x=>x/sum);}
function isolated(layer,pitch,morph,{seconds=1,gate=.18,settled=true}={}){const e=new AmbientEngine(rate,seed);e.evolvingTimbre=morph;e.score.advanceTo=()=>{};e.setParameters({...focus,melodyEnabled:true,evolution:.8,pad:0,pluck:0,bell:0,texture:0,pulse:0,[['pad','pluck','bell','texture','pulse'][layer]]:1});e.intensity=focus.intensity;e.brightness=focus.brightness;e.motion=focus.motion;e.timbre=focus.timbre;e.layerGains.fill(0);e.layerGains[layer]=1;if(settled)e.evolution=.8;e.start();e.fade=1;e.noteOn(0,layer,pitch,Math.round(gate*rate),.7,.5);const l=new Float32Array(rate*seconds),r=new Float32Array(l.length);e.render(l,r);return {e,l};}

test('explicit ambient palettes preserve synthesized background PCM and melodic score in both modes',async()=>{
 for(const scoreMode of ['original','developing'])for(const base of ['chamber','piano-room','chamber-flute']){
  const {wireBank,report}=await prepareMelodicBank(base+'-ambient',rate,{fetcher,assetBaseUrl:new URL('../docs/melodic-assets/',import.meta.url)});assert.equal(report.preset,base+'-ambient');
  const hybrid=createInstrumentEngine(rate,seed,{scoreMode,melodicBank:wireBank,synthesizedBed:true});
  const reference=scoreMode==='original'?new AmbientEngine(rate,seed):createDevelopingEngine(rate,seed);
  const a=render(hybrid,focus),b=render(reference,focus);assert.deepEqual(a,b,base+' '+scoreMode+' original synthesized bed retained');assert.equal(hybrid.recordedMelodicAccepted,0);assert.equal(hybrid.melodicFallbacks,0);assert.equal(hybrid.droppedNotes,0);
 }
});
test('ambient routing keeps acoustic melody, full recorded strings remain explicit, and the voice budget is shared',async()=>{
 for(const scoreMode of ['original','developing'])for(const synthesizedBed of [false,true]){
  const e=createInstrumentEngine(rate,seed,{scoreMode,melodicBank:await bank('piano-room'),synthesizedBed});e.setParameters({polyphony:8});e.score.advanceTo=()=>{};e.start();
  for(const [layer,pitch]of [[0,60],[1,72],[2,72],[3,72],[4,45]])e.noteOn(0,layer,pitch,rate*10,.7,.5);
  assert.equal(e.recordedMelodicAccepted,synthesizedBed?2:5);assert.equal(e.melodicFallbacks,0);assert.equal(e.getActiveMelodicVoiceCount(),5);
  for(let i=0;i<6;i++)e.noteOn(0,i%2?0:1,60,rate*10,.7,.5);assert.equal(e.getActiveMelodicVoiceCount(),8);assert.equal(e.droppedNotes,3);
  e.stop();const l=new Float32Array(rate*3),r=new Float32Array(l.length);e.render(l,r);assert.equal(e.recordedMelodies.activeVoices,0);assert.ok(e.isSilent());
 }
});
test('Eno default advances harmony slowly; screenshot mixed styles also advance on the reported seed',()=>{
 assert.equal(focus.evolution,.8);assert.equal(focus.melodyEnabled,false);
 for(const Score of [EventScore,DevelopmentScore])for(const mixed of [false,true]){
  const p=mixed?{...focus,ambient:.38,counterpoint:0,rhythmic:.5,arpeggio:.33,density:.25,complexity:1,swing:0,evolution:.8}:focus;
  const score=new Score(rate,seed),events=[];score.advanceTo(rate*600-1,p,{noteOn(...e){events.push(e);}});
  assert.ok(score.chordChanges>=5);if(!mixed)assert.ok(score.chordChanges<=12,'ambient harmony should breathe for roughly a minute');
  assert.ok(new Set(events.filter(e=>e[1]===0).map(e=>e[2])).size>=7);assert.ok(events.every(e=>e[2]>=24&&e[2]<=96));
 }
});
test('held ambient note changes normalized spectrum, remains bounded and is deterministic across render blocks',()=>{
 const a=isolated(0,55,true,{seconds:36,gate:35}),b=isolated(0,55,false,{seconds:36,gate:35});
 assert.equal(a.e.noteOnCount,1);let difference=0;const fingerprints=[];
 for(const second of [8,15,22,29]){const x=spectrum(a.l,rate*second),y=spectrum(b.l,rate*second);difference=Math.max(difference,x.reduce((n,v,i)=>n+Math.abs(v-y[i]),0));fingerprints.push(x);}
 const movement=fingerprints[0].reduce((n,v,i)=>n+Math.abs(v-fingerprints[3][i]),0);assert.ok(difference>.03,'change must affect spectral shape, not just level');assert.ok(movement>.03);
 let peak=0,maxStep=0;for(let i=0;i<a.l.length;i++){assert.ok(Number.isFinite(a.l[i]));peak=Math.max(peak,Math.abs(a.l[i]));if(i)maxStep=Math.max(maxStep,Math.abs(a.l[i]-a.l[i-1]));}assert.ok(peak<.3&&maxStep<.05);
 const p={...focus,evolution:.8,melodyEnabled:true,ambient:.38,rhythmic:.5,arpeggio:.33,complexity:1};const e1=new AmbientEngine(rate,seed),e2=new AmbientEngine(rate,seed);e1.evolvingTimbre=e2.evolvingTimbre=true;assert.deepEqual(render(e1,p,rate*6),render(e2,p,rate*6,97));
 console.log(JSON.stringify({scope:'held-note normalized spectrum',difference,movement,peak,maxStep}));
});
test('rhythmic high oscillator gains body and texture with a gentler transient while retaining pitch clarity',()=>{
 const old=isolated(1,83,false).l,next=isolated(1,83,true).l;
 const p0=spectrum(old,Math.round(rate*.04),1024),p1=spectrum(next,Math.round(rate*.04),1024);const frequency=440*2**((83-69)/12),bin=frequency/rate*1024;
 const around=(p,k)=>p.reduce((n,v,i)=>n+(Math.abs(i-k)<3?v:0),0);const pure0=around(p0,bin),pure1=around(p1,bin),body0=around(p0,bin/2),body1=around(p1,bin/2);
 const early=a=>Math.sqrt(a.subarray(0,rate*.02).reduce((n,v)=>n+v*v,0)/(rate*.02));
 assert.ok(pure1<pure0-.03&&pure1>.65,'more texture while the scored pitch stays dominant');assert.ok(body1>body0+.015);assert.ok(early(next)<early(old)*.8);
 console.log(JSON.stringify({scope:'rhythmic oscillator MIDI83',pure0,pure1,body0,body1,early0:early(old),early1:early(next)}));
});
test('Evolution zero keeps legacy PCM even with new tone motion enabled',()=>{
 const p={...focus,evolution:0},a=new AmbientEngine(rate,seed),b=new AmbientEngine(rate,seed);b.evolvingTimbre=true;assert.deepEqual(render(a,p,rate*8),render(b,p,rate*8));
});
test('actual fresh hybrid Eno render changes chords within about one minute without drum or lead leakage',async()=>{
 const e=createInstrumentEngine(rate,seed,{melodicBank:await bank('chamber'),synthesizedBed:true,evolvingTimbre:true}),pitches=new Set(),changes=[];e.setParameters(focus);e.onNoteOn=(frame,layer,pitch)=>{if(layer===0)pitches.add(pitch);};e.start();const l=new Float32Array(rate),r=new Float32Array(rate);let last=0,peak=0;
 for(let second=0;second<600;second++){e.render(l,r);for(let i=0;i<rate;i++)peak=Math.max(peak,Math.abs(l[i]),Math.abs(r[i]));if(e.score.chordChanges!==last){changes.push({second:second+1,degree:e.score.chord});last=e.score.chordChanges;}}
 assert.equal(changes.length,10);assert.ok(changes[0].second<90);assert.ok(changes.slice(1).every((v,i)=>v.second-changes[i].second<90));assert.ok(pitches.size>=7);assert.equal(e.recordedMelodicAccepted,0);assert.equal(e.droppedNotes,0);assert.ok(peak<.3);console.log(JSON.stringify({scope:'actual fresh Eno hybrid600s',seed,changes,pitches:[...pitches].sort((a,b)=>a-b),peak,recordedLeads:e.recordedMelodicAccepted,drumsEnabled:e.parameters.drumsEnabled}));
});
