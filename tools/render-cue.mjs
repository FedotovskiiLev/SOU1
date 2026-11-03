// SPDX-License-Identifier: AGPL-3.0-only
// Local, dependency-free prototype using unmodified SOU1 0.2.0 DSP.
import {open, unlink, mkdir} from 'node:fs/promises';
import {resolve, dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {loadOriginalScore} from './instruments/event-score.mjs';
import {ENGINE_SHA,ENV_SHA} from './instruments/event-score-core.mjs';
import {readJson} from './bounded-json.mjs';

export const SOURCE_COMMIT='70bf98168b1c854f8ce79676e02acc4bc44bac93';
export const PROFILES=Object.freeze({
  documentary: {ambient:.75,counterpoint:0,rhythmic:0,arpeggio:.25,density:.36,complexity:.3,bpm:76,brightness:.32,timbre:.42,pad:.46,pluck:.29,bell:.12,texture:.16,pulse:.23,warmth:.26,wash:.25,width:.58,drumsEnabled:false},
  nocturne: {ambient:.72,counterpoint:.28,rhythmic:0,arpeggio:0,density:.30,complexity:.42,bpm:66,brightness:.27,timbre:.48,pad:.40,pluck:.30,bell:.19,texture:.12,pulse:.15,warmth:.34,wash:.32,width:.65,drumsEnabled:false},
  pulse: {ambient:.25,counterpoint:0,rhythmic:.5,arpeggio:.25,density:.53,complexity:.35,bpm:92,brightness:.44,timbre:.44,pad:.3,pluck:.4,bell:.1,texture:.1,pulse:.35,warmth:.20,wash:.16,width:.55,drumsEnabled:true,kick:.48,snare:.23,hihat:.18,toms:.16,cymbal:.12}
});
for(const profile of Object.values(PROFILES))Object.freeze(profile);
export function validateOptions(o={}) {
  const allowed=['duration','sampleRate','seed','profile','outputGainDb'];
  if(!o||typeof o!=='object'||Array.isArray(o)||Object.keys(o).some(k=>!allowed.includes(k)))throw new TypeError('Unknown cue option');
  const p={duration:30,sampleRate:48000,seed:20261103,profile:'documentary',outputGainDb:0,...o};
  if(!Number.isFinite(p.duration)||p.duration<4||p.duration>300)throw new RangeError('duration must be 4..300 seconds');
  if(![8000,16000,22050,24000,44100,48000,96000].includes(p.sampleRate))throw new RangeError('unsupported sampleRate');
  if(!Number.isInteger(p.seed)||p.seed<0||p.seed>0xffffffff)throw new RangeError('seed must be uint32');
  if(typeof p.profile!=='string'||!Object.hasOwn(PROFILES,p.profile))throw new RangeError('unknown profile');
  if(!Number.isFinite(p.outputGainDb)||p.outputGainDb < -60||p.outputGainDb > 24)throw new RangeError('outputGainDb must be -60..24');
  return p;
}
async function loadEngine() {
  // The report names a pinned source commit. Execute only its verified bytes.
  return loadOriginalScore();
}
export function wavHeader(frames,rate) {
  if(!Number.isSafeInteger(frames)||frames<0||frames*6>0xffffffff-36)throw new RangeError('WAV size');
  const b=Buffer.alloc(44);b.write('RIFF');b.writeUInt32LE(frames*6+36,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(2,22);b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*6,28);b.writeUInt16LE(6,32);b.writeUInt16LE(24,34);b.write('data',36);b.writeUInt32LE(frames*6,40);return b;
}
export async function renderCue(options={}) {
  const o=validateOptions(options),{AmbientEngine}=await loadEngine();
  const frames=Math.round(o.duration*o.sampleRate),endActive=frames-2*o.sampleRate;
  const dsp=new AmbientEngine(o.sampleRate,o.seed);
  dsp.setParameters({...PROFILES[o.profile],polyphony:32,rain:0,wind:0,thunder:0});
  // Avoid an unintended transition from live-app default layer gains.
  ['pad','pluck','bell','texture','pulse'].forEach((k,i)=>dsp.layerGains[i]=dsp.parameters[k]);
  ['kick','snare','hihat','toms','cymbal'].forEach((k,i)=>dsp.drumGains[i]=dsp.parameters[k]);
  const events=[];dsp.onNoteOn=(frame,instrument,pitch,duration,velocity,pan,id)=>events.push({frame,instrument,pitch,duration,velocity,pan,id});
  const wav=Buffer.alloc(44+frames*6);wavHeader(frames,o.sampleRate).copy(wav);
  const gain=10**(o.outputGainDb/20);
  let peak=0,sumSquares=0,nonfinite=0,clipped=0;
  const left=new Float32Array(256),right=new Float32Array(256);
  dsp.start();
  for(let at=0;at<frames;) {
    if(at===endActive)dsp.stop();
    const n=Math.min(256,frames-at,at<endActive?endActive-at:frames-at);
    dsp.render(left.subarray(0,n),right.subarray(0,n));
    for(let i=0;i<n;i++)for(let ch=0;ch<2;ch++) {
      let x=(ch?right[i]:left[i])*gain;
      if(!Number.isFinite(x)){nonfinite++;throw new Error('Non-finite DSP output');}
      // Deterministic endpoint guard, no automatic gain normalization.
      const remain=frames-(at+i)-1;if(remain<128)x*=remain/128;
      peak=Math.max(peak,Math.abs(x));sumSquares+=x*x;if(Math.abs(x)>=1)clipped++;
      const v=Math.round(Math.max(-1,Math.min(1,x))*8388607);
      wav.writeIntLE(v,44+(at+i)*6+ch*3,3);
    }
    at+=n;
  }
  if(clipped)throw new Error('Output gain causes clipping; reduce outputGainDb');
  const rms=Math.sqrt(sumSquares/(frames*2));
  const report={schema:'sou1.offline-cue.v1',sourceCommit:SOURCE_COMMIT,sourceHashes:{audioEngineSha256:ENGINE_SHA,environmentAudioSha256:ENV_SHA},...o,frames,channels:2,bitDepth:24,format:'PCM signed little-endian WAV',parameters:dsp.parameters,peak,peakDbfs:peak?20*Math.log10(peak):null,rmsDbfs:rms?20*Math.log10(rms):null,clippedSamples:clipped,nonfiniteSamples:nonfinite,acceptedNotes:dsp.noteOnCount,droppedNotes:dsp.droppedNotes,sha256:createHash('sha256').update(wav).digest('hex'),limitations:['Original SOU1 oscillator engine only; no external synth/sample bank is integrated.','RMS dBFS is not LUFS or a listening-quality judgment.','Final two seconds stop note scheduling and fade; note-event durations are the generated gates, not a lossless audio transcription.','No additive stems: shared nonlinear master and reverb cannot be reconstructed by summing separately rendered layers.']};
  return {wav,report,events};
}
export async function saveCue(outBase,{wav,report,events}) {
  // Reserve both files exclusively. A collision never removes an existing file.
  // Serialize before reserving: malformed/cyclic reports must create no files.
  const json=JSON.stringify({...report,events},null,2)+'\n';
  const paths=[outBase+'.wav',outBase+'.json'], handles=[];
  try {
    for(const p of paths)handles.push(await open(p,'wx'));
    await handles[0].writeFile(wav);
    await handles[1].writeFile(json);
    for(const h of handles)await h.close();
  } catch(error) {
    // One cleanup failure must not leave later handles open or hide the cause.
    const cleanupErrors=[];
    for(const h of handles)try{await h.close();}catch(e){cleanupErrors.push(e);}
    for(let i=0;i<handles.length;i++)try{await unlink(paths[i]);}catch(e){if(e.code!=='ENOENT')cleanupErrors.push(e);}
    if(cleanupErrors.length)error.cleanupErrors=cleanupErrors;
    throw error;
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const [configPath,outBase]=process.argv.slice(2);
  if(!configPath||!outBase)throw new Error('Usage: node render-cue.mjs cue.json output/base');
  const options=await readJson(configPath,64*1024);
  const {wav,report,events}=await renderCue(options);
  await mkdir(dirname(resolve(outBase)),{recursive:true});
  await saveCue(outBase,{wav,report,events});
  process.stdout.write(JSON.stringify(report,null,2)+'\n');
}
