// SPDX-License-Identifier: AGPL-3.0-only
// Offline step sequencer for prepared CC0 one-shots, plus an honest old-DSP A/B.
import {fileURLToPath,pathToFileURL} from 'node:url';
import {resolve,dirname} from 'node:path';
import {mkdir,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {loadBank} from './instruments/load-bank.mjs';
import {FSA_KITS,FSA_FULL_KITS,drumManifestPath,drumManifestUrl} from './instruments/drum-kits.mjs';
import {InstrumentRack} from './instruments/rack.mjs';
import {loadOriginalScore,SCORE_SOURCE_COMMIT} from './instruments/event-score.mjs';
import {readJson} from './bounded-json.mjs';
import {wavHeader,saveCue} from './render-cue.mjs';

export function validateDrumOptions(input={}){
  const allowed=['kit','fills','source','pattern','bars','bpm','sampleRate','extended','outputGainDb'];
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!allowed.includes(k)))throw new TypeError('Drum options object');
  const o={kit:'fsa-electronic',fills:false,source:'fsa',pattern:'broken-beat',bars:8,bpm:112,sampleRate:48000,extended:true,outputGainDb:0,...input};
  if(!FSA_KITS.includes(o.kit)||typeof o.fills!=='boolean'||!['fsa','procedural'].includes(o.source)||!['four-on-floor','broken-beat'].includes(o.pattern)||!Number.isInteger(o.bars)||o.bars<1||o.bars>32||!Number.isInteger(o.bpm)||o.bpm<60||o.bpm>180||![44100,48000].includes(o.sampleRate)||typeof o.extended!=='boolean'||!Number.isFinite(o.outputGainDb)||o.outputGainDb< -60||o.outputGainDb>18)throw new RangeError('Invalid drum options');
  if(o.source==='procedural'&&o.extended)throw new Error('Procedural comparison has no clap/open hat: set extended:false');
  if(o.fills&&(!FSA_FULL_KITS.includes(o.kit)||o.source!=='fsa'))throw new Error('Fills require a full prepared kit');
  if(o.source==='procedural'&&o.kit!=='fsa-electronic')throw new Error('Kit selection applies only to prepared samples');
  return o;
}
export function composeDrumPattern(input={}){
  const o=validateDrumOptions(input),events=[];
  const activeFrames=Math.round(o.bars*4*60/o.bpm*o.sampleRate),frames=activeFrames+2*o.sampleRate;
  const add=(bar,step,instrument,velocity,pan=.5)=>events.push({frame:Math.round((bar*16+step)*60/o.bpm/4*o.sampleRate),instrument,pitch:{kick:36,snare:38,'closed-hat':42,'open-hat':46,clap:39,'tom-high':49,'tom-mid':47,'tom-low':45}[instrument]??60,duration:Math.round(.22*o.sampleRate),velocity,pan});
  for(let bar=0;bar<o.bars;bar++){
    for(const s of (o.pattern==='four-on-floor'?[0,4,8,12]:[0,6,8,...(bar%2?[11]:[])]))add(bar,s,'kick',s===0?.88:.76);
    for(const s of [4,12])add(bar,s,'snare',s===4?.72:.80);
    if(o.pattern==='broken-beat'&&bar%2)add(bar,10,'snare',.24);
    for(let s=0;s<16;s+=2){
      const open=o.extended&&s===14&&bar%2===1;
      add(bar,s,open?'open-hat':'closed-hat',open?.32:(s%4===0?.30:.20),.58);
    }
    if(o.extended&&bar>=Math.floor(o.bars/2))add(bar,12,'clap',.30,.45);
    if(o.fills){
      if(bar%4===3)for(const [step,id,pan] of [[13,'tom-high',.35],[14,'tom-mid',.5],[15,'tom-low',.65]])add(bar,step,id,.48,pan);
      // sdbkit has no cymbal. Never substitute an unnamed sample inside this kit demo.
      if(bar%4===0&&o.kit!=='fsa-sdbkit')add(bar,0,o.kit==='fsa-x0xproc2'?'cymbal':'crash',.36,.6);
    }
  }
  // Stable order: kick, snare, hats, clap. There is never a simultaneous open/closed hat.
  events.sort((a,b)=>a.frame-b.frame);
  return {options:o,events,activeFrames,frames};
}
export async function renderDrumPattern(input={},blockSize=256){
  if(!Number.isInteger(blockSize)||blockSize<1||blockSize>2048)throw new RangeError('blockSize 1..2048');
  const plan=composeDrumPattern(input),o=plan.options;
  let backend,bank,atEvent=0;
  if(o.source==='fsa'){
    bank=await loadBank(fileURLToPath(drumManifestUrl(o.kit)));
    backend=new InstrumentRack(o.sampleRate,bank.instruments,{polyphony:48});backend.schedule(plan.events);
  }else{
    const {AmbientEngine}=await loadOriginalScore();backend=new AmbientEngine(o.sampleRate,20261104);
    backend.setParameters({pad:0,pluck:0,bell:0,texture:0,pulse:0,melodyEnabled:false,drumsEnabled:true,kick:1,snare:1,hihat:1,toms:0,cymbal:0,rain:0,wind:0,thunder:0,warmth:0,strength:0,width:.5,wash:0});
    backend.layerGains.fill(0);backend.drumGains.set([1,1,1,0,0]);
    // The tested original oscillator voices/master remain. Only replace its note scheduler
    // with the identical explicit pattern and skip the app's two-second startup fade.
    backend.score={advanceTo(){},beatNext:0};backend.start();backend.fade=1;
  }
  const wav=Buffer.alloc(44+plan.frames*6);wavHeader(plan.frames,o.sampleRate).copy(wav);
  const l=new Float32Array(blockSize),r=new Float32Array(blockSize),gain=10**(o.outputGainDb/20);let peak=0,sum=0;
  for(let at=0;at<plan.frames;){
    if(at===plan.activeFrames)backend.stop();
    if(o.source==='procedural')while(atEvent<plan.events.length&&plan.events[atEvent].frame===at){const e=plan.events[atEvent++];backend.noteOn(e.frame,{kick:5,snare:6,'closed-hat':7}[e.instrument],e.pitch,e.duration,e.velocity,e.pan);}
    const next=o.source==='procedural'&&atEvent<plan.events.length?plan.events[atEvent].frame:plan.frames;
    const n=Math.min(blockSize,plan.frames-at,next-at,at<plan.activeFrames?plan.activeFrames-at:plan.frames-at);
    if(n<1)throw new Error('Non-progressing render');
    backend.render(l.subarray(0,n),r.subarray(0,n));
    for(let i=0;i<n;i++)for(let ch=0;ch<2;ch++){
      const x=(ch?r[i]:l[i])*gain*Math.min(1,(plan.frames-at-i-1)/128);
      if(!Number.isFinite(x)||Math.abs(x)>=1)throw new Error('Clipping/nonfinite drum output; reduce outputGainDb');
      peak=Math.max(peak,Math.abs(x));sum+=x*x;wav.writeIntLE(Math.round(x*8388607),44+(at+i)*6+3*ch,3);
    }at+=n;
  }
  const stats=o.source==='fsa'?{...backend.stats,activeVoices:backend.voices.length}:{accepted:backend.noteOnCount,dropped:backend.droppedNotes,unmapped:0};
  if(stats.dropped||stats.unmapped||stats.accepted!==plan.events.length)throw new Error('Incomplete drum event rendering');
  const rendererFiles={};for(const path of ['tools/drum-machine.mjs','tools/render-cue.mjs','tools/bounded-json.mjs','tools/instruments/event-score.mjs','tools/instruments/event-score-core.mjs','tools/instruments/rack.mjs',...(o.source==='fsa'?['tools/instruments/load-bank.mjs','tools/instruments/wav.mjs','tools/instruments/drum-kits.mjs',drumManifestPath(o.kit)]:['docs/audio-engine.js','docs/environment-audio.js'])])rendererFiles[path]=createHash('sha256').update(await readFile(new URL('../'+path,import.meta.url))).digest('hex');
  const report={schema:'sou1.drum-machine.v1',...o,rendererFiles,proceduralSourceCommit:o.source==='procedural'?SCORE_SOURCE_COMMIT:null,proceduralSeed:o.source==='procedural'?20261104:null,frames:plan.frames,activeFrames:plan.activeFrames,bankId:bank?.manifest.id??null,bankSourceCommit:bank?.manifest.sourceCommit??null,events:plan.events,rack:stats,peakDbfs:peak?20*Math.log10(peak):null,rmsDbfs:sum?10*Math.log10(sum/(plan.frames*2)):null,sha256:createHash('sha256').update(wav).digest('hex'),clippedSamples:0,nonfiniteSamples:0,limitations:['Offline fixed-pattern sequencer, not EventScore and not a shipped app feature.','FSA uses prepared authored electronic one-shots, not recordings of a certified hardware 808/909. One sample per articulation, no velocity layers or round robins.','Procedural comparison uses original SOU1 oscillator voices/master, identical common-note events and a disabled startup fade. It has no clap/open-hat equivalent.','Hat choke is symmetric and stable-order dependent; patterns never schedule zero-velocity or simultaneous open/closed events. Full polyphony would be rejected, not silently stolen.','Includes a two-second transport tail. No automatic loudness matching or subjective quality approval.']};
  return {wav,report,events:plan.events};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const [config,out,...extra]=process.argv.slice(2);if(!config||!out||extra.length)throw new Error('Usage: node tools/drum-machine.mjs recipe.json output/base');
  const result=await renderDrumPattern(await readJson(config,64*1024));await mkdir(dirname(resolve(out)),{recursive:true});await saveCue(out,result);console.log(JSON.stringify({...result.report,events:undefined}));
}
