// SPDX-License-Identifier: AGPL-3.0-only
import {mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {InstrumentRack,SineInstrument} from './instruments/rack.mjs';
import {loadBank} from './instruments/load-bank.mjs';
import {wavHeader,saveCue} from './render-cue.mjs';
export async function renderSampleCue(options={}){
  if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(k=>!['seed','duration','sampleRate','outputGainDb'].includes(k)))throw new TypeError('Unknown sample cue option');
  const {seed=20261103,duration=16,sampleRate=48000,outputGainDb=10}=options;
  if(!Number.isInteger(seed)||seed<0||seed>0xffffffff||!Number.isInteger(duration)||duration<4||duration>120||![44100,48000].includes(sampleRate)||!Number.isFinite(outputGainDb)||outputGainDb < -60||outputGainDb>24)throw new RangeError('Sample cue options');
  const bank=await loadBank(fileURLToPath(new URL('../assets/cc0-mini/manifest.json',import.meta.url)));
  bank.instruments.set('sine',new SineInstrument({gain:.09}));
  const rack=new InstrumentRack(sampleRate,bank.instruments),events=[];
  // Deterministic original miniature: one clock and event contract for PCM + sine.
  const pitches=[72,74,79,76,74,81,79,76],step=60/88/2;let state=seed;
  const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
  for(let tick=0;tick*step<duration-2;tick++){
    const frame=Math.round(tick*step*sampleRate),emit=(instrument,pitch,seconds,velocity,pan=.5)=>events.push({frame,instrument,pitch,duration:Math.round(seconds*sampleRate),velocity,pan});
    if(tick%2===0)emit('marimba',pitches[(tick/2+seed%8)%8],.6,.55+.14*random(),.35+.3*random());
    if(tick%8===0){emit('kick',36,1,.65);emit('sine',48+(tick%16?7:0),2.2,.65);}
    if(tick%8===4)emit('snare',38,1,.42);
    emit('closed-hat',42,.4,tick%2?.27:.38,.60);
    if(tick%4===3)emit('shaker-double',70,.5,.4,.30);
  }
  rack.schedule(events);
  const frames=duration*sampleRate,wav=Buffer.alloc(44+frames*6);wavHeader(frames,sampleRate).copy(wav);let peak=0,sum=0;
  const l=new Float32Array(256),r=new Float32Array(256);
  for(let at=0;at<frames;at+=256){const n=Math.min(256,frames-at);rack.render(l.subarray(0,n),r.subarray(0,n));for(let i=0;i<n;i++)for(let ch=0;ch<2;ch++){
    let x=(ch?r[i]:l[i])*10**(outputGainDb/20)*Math.min(1,(frames-at-i-1)/256);
    if(!Number.isFinite(x)||Math.abs(x)>=1)throw new Error('Non-finite/clipping output');peak=Math.max(peak,Math.abs(x));sum+=x*x;wav.writeIntLE(Math.round(x*8388607),44+(at+i)*6+3*ch,3);
  }}
  const report={schema:'sou1.sample-cue.v1',sampleRate,seed,duration,outputGainDb,frames,channels:2,bitDepth:24,peak,peakDbfs:20*Math.log10(peak),rmsDbfs:10*Math.log10(sum/(2*frames)),bankId:bank.manifest.id,sourceCommit:bank.manifest.sourceCommit,bankEncodedBytes:bank.encodedBytes,bankDecodedBytes:bank.decodedBytes,sha256:createHash('sha256').update(wav).digest('hex'),...rack.stats,activeVoices:rack.voices.length,clippedSamples:0,nonfiniteSamples:0,limitations:['Offline prototype, not integrated into the shipping PWA or Android app.','Single velocity layer; only the closed hi-hat has two round robins.','Mono derived samples; 16-tap preview resampler is not mastering-grade.','Marimba root MIDI notes 72 and 79 correspond to measured ~525/783 Hz despite source filenames C4/G4.','No desktop VST host, subjective listening approval, browser/mobile qualification or release claim.']};
  return {wav,report,events};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const out=process.argv[2];if(!out)throw new Error('Usage: node tools/render-sample-cue.mjs output/base');
 const result=await renderSampleCue();await mkdir(dirname(resolve(out)),{recursive:true});await saveCue(out,result);console.log(JSON.stringify(result.report,null,2));
}
