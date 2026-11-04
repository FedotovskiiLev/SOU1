// SPDX-License-Identifier: AGPL-3.0-only
// Render supplied note events without generating or quantizing any rhythm.
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {FSA_KITS,drumManifestUrl,drumManifestPath} from './instruments/drum-kits.mjs';
import {loadBank} from './instruments/load-bank.mjs';
import {InstrumentRack,validateEvent} from './instruments/rack.mjs';
import {wavHeader} from './render-cue.mjs';
export async function renderDrumStem(input,blockSize=256){
  const keys=['kit','events','sampleRate','frames','activeFrames','outputGainDb'];
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!keys.includes(k)))throw new TypeError('Drum stem options');
  const {kit='fsa-x0xproc1',events,sampleRate=48000,frames,activeFrames,outputGainDb=0}=input;
  if(!FSA_KITS.includes(kit)||![44100,48000].includes(sampleRate)||!Number.isInteger(frames)||frames<1||frames>300*sampleRate||!Number.isInteger(activeFrames)||activeFrames<1||frames-activeFrames<Math.ceil(sampleRate*.05)+1||!Number.isFinite(outputGainDb)||outputGainDb< -60||outputGainDb>18||!Number.isInteger(blockSize)||blockSize<1||blockSize>2048||!Array.isArray(events)||events.length>16384)throw new RangeError('Drum stem bounds');
  const notes=events.map(validateEvent);
  if(notes.some(e=>e.frame>=activeFrames||e.velocity<=0))throw new RangeError('Events must have positive velocity and precede stop');
  const bank=await loadBank(fileURLToPath(drumManifestUrl(kit)));
  const rack=new InstrumentRack(sampleRate,bank.instruments,{polyphony:48,queueLimit:16384});rack.schedule(notes);
  const wav=Buffer.alloc(44+frames*6);wavHeader(frames,sampleRate).copy(wav);
  const left=new Float32Array(blockSize),right=new Float32Array(blockSize),gain=10**(outputGainDb/20);let peak=0,sum=0;
  for(let at=0;at<frames;){
    if(at===activeFrames)rack.stop();
    const n=Math.min(blockSize,frames-at,at<activeFrames?activeFrames-at:frames-at);
    rack.render(left.subarray(0,n),right.subarray(0,n));
    for(let i=0;i<n;i++)for(let ch=0;ch<2;ch++){
      const x=(ch?right[i]:left[i])*gain*Math.min(1,(frames-at-i-1)/128);
      if(!Number.isFinite(x)||Math.abs(x)>=1)throw new Error('Clipping/nonfinite drum stem; reduce outputGainDb');
      peak=Math.max(peak,Math.abs(x));sum+=x*x;wav.writeIntLE(Math.round(x*8388607),44+(at+i)*6+ch*3,3);
    }at+=n;
  }
  if(rack.stats.accepted!==notes.length||rack.stats.dropped||rack.stats.unmapped||rack.voices.length)throw new Error('Incomplete drum stem event rendering');
  const rendererFiles={};for(const path of ['tools/render-drum-stem.mjs','tools/render-cue.mjs','tools/instruments/drum-kits.mjs','tools/instruments/load-bank.mjs','tools/instruments/wav.mjs','tools/instruments/rack.mjs',drumManifestPath(kit)])rendererFiles[path]=createHash('sha256').update(await readFile(new URL('../'+path,import.meta.url))).digest('hex');
  return {wav,events:notes,report:{schema:'sou1.drum-stem.v1',kit,sampleRate,frames,activeFrames,outputGainDb,events:notes,bankId:bank.manifest.id,sourceCommit:bank.manifest.sourceCommit,rendererFiles,rack:{...rack.stats,activeVoices:rack.voices.length},peakDbfs:peak?20*Math.log10(peak):null,rmsDbfs:sum?10*Math.log10(sum/(frames*2)):null,clippedSamples:0,nonfiniteSamples:0,sha256:createHash('sha256').update(wav).digest('hex'),limitations:['Offline prepared CC0 samples only. Input timing, pitch, gates, velocity, pan and stable event order are preserved; no new rhythm is composed.','One sample per articulation; no velocity layers or round robin. Hat choking is symmetric and stable-order dependent.','No automatic fallback for missing cymbals or unmapped tom keys: rendering fails. EventScore adapter has its own explicitly reported VCSL fallback.','Stopping at activeFrames releases voices over 50ms. Output duration includes the supplied tail. No normalization or listening-quality approval.']}};
}
