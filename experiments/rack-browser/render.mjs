// SPDX-License-Identifier: AGPL-3.0-only
import {InstrumentRack,SineInstrument} from '../../tools/instruments/rack.mjs';
export function renderBrowserPlan(plan,instruments,onProgress=()=>{}){
  if(!plan||!plan.options||![44100,48000].includes(plan.options.sampleRate)||!Number.isSafeInteger(plan.frames)||plan.frames<1||plan.frames>30*plan.options.sampleRate||!Number.isSafeInteger(plan.activeFrames)||plan.activeFrames<1||plan.activeFrames>=plan.frames)throw new RangeError('Browser prototype duration limit: 30 seconds with a finite release tail');
  const registry=new Map(instruments);for(const [id,gain] of [['sine-pad',.14],['sine-texture',.05],['sine-bass',.20],['sine-fallback',.14]])registry.set(id,new SineInstrument({gain}));
  const rack=new InstrumentRack(plan.options.sampleRate,registry,{polyphony:48});rack.schedule(plan.events);
  const left=new Float32Array(plan.frames),right=new Float32Array(plan.frames),gain=10**(plan.options.outputGainDb/20);let peak=0,sum=0;
  for(let at=0;at<plan.frames;){if(at===plan.activeFrames)rack.stop();const n=Math.min(256,plan.frames-at,at<plan.activeFrames?plan.activeFrames-at:plan.frames-at);rack.render(left.subarray(at,at+n),right.subarray(at,at+n));for(let i=at;i<at+n;i++){const fade=Math.min(1,(plan.frames-i-1)/128);for(const buffer of [left,right]){const x=buffer[i]*gain*fade;if(!Number.isFinite(x)||Math.abs(x)>=1)throw new Error('Non-finite or clipping output');peak=Math.max(peak,Math.abs(x));sum+=x*x;buffer[i]=x;}}at+=n;if(at%65536===0)onProgress(at/plan.frames);}
  if(rack.stats.dropped||rack.stats.unmapped)throw new Error('Lost/unmapped notes');onProgress(1);
  return {left,right,sampleRate:plan.options.sampleRate,report:{schema:'sou1.browser-rack.v1',...plan.stats,rack:{...rack.stats,activeVoices:rack.voices.length},frames:plan.frames,sampleRate:plan.options.sampleRate,peakDbfs:peak?20*Math.log10(peak):null,rmsDbfs:sum?10*Math.log10(sum/(2*plan.frames)):null,sourceCommit:plan.sourceCommit,sourceHashes:plan.sourceHashes,options:plan.options,qualification:'Worker pre-render + AudioBuffer playback, not a live AudioWorklet'}};
}
