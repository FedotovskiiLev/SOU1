// SPDX-License-Identifier: AGPL-3.0-only
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {InstrumentRack,SineInstrument} from './instruments/rack.mjs';
import {loadBank} from './instruments/load-bank.mjs';
import {composeScorePlan} from './instruments/event-score.mjs';
import {wavHeader,saveCue} from './render-cue.mjs';
export async function renderScoreCue(options={},blockSize=256){
  if(!Number.isInteger(blockSize)||blockSize<1||blockSize>2048)throw new RangeError('blockSize 1..2048');
  const plan=await composeScorePlan(options),o=plan.options;
  const bank=await loadBank(fileURLToPath(new URL('../assets/cc0-mini/manifest.json',import.meta.url)));
  for(const [id,gain] of [['sine-pad',.14],['sine-texture',.05],['sine-bass',.20],['sine-fallback',.14]])bank.instruments.set(id,new SineInstrument({gain}));
  const rack=new InstrumentRack(o.sampleRate,bank.instruments,{polyphony:48});rack.schedule(plan.events);
  const wav=Buffer.alloc(44+plan.frames*6);wavHeader(plan.frames,o.sampleRate).copy(wav);
  const left=new Float32Array(blockSize),right=new Float32Array(blockSize),gain=10**(o.outputGainDb/20);let peak=0,sum=0;
  for(let at=0;at<plan.frames;){
    if(at===plan.activeFrames)rack.stop();
    const n=Math.min(blockSize,plan.frames-at,at<plan.activeFrames?plan.activeFrames-at:plan.frames-at);
    rack.render(left.subarray(0,n),right.subarray(0,n));
    for(let i=0;i<n;i++)for(let channel=0;channel<2;channel++){
      const x=(channel?right[i]:left[i])*gain*Math.min(1,(plan.frames-at-i-1)/128);
      if(!Number.isFinite(x)||Math.abs(x)>=1)throw new Error('Non-finite/clipping score output; reduce outputGainDb');
      peak=Math.max(peak,Math.abs(x));sum+=x*x;wav.writeIntLE(Math.round(x*8388607),44+(at+i)*6+channel*3,3);
    }at+=n;
  }
  if(rack.stats.unmapped||rack.stats.dropped)throw new Error('Rack cannot preserve all routed notes (unmapped or polyphony drop)');
  const report={schema:'sou1.event-score-cue.v1',...o,frames:plan.frames,activeFrames:plan.activeFrames,sourceCommit:plan.sourceCommit,sourceHashes:plan.sourceHashes,bankId:bank.manifest.id,bankSourceCommit:bank.manifest.sourceCommit,...plan.stats,rack:{...rack.stats,activeVoices:rack.voices.length},peakDbfs:peak?20*Math.log10(peak):null,rmsDbfs:sum?10*Math.log10(sum/(2*plan.frames)):null,clippedSamples:0,nonfiniteSamples:0,sha256:createHash('sha256').update(wav).digest('hex'),sourceEvents:plan.sourceEvents,routingAudit:plan.audit,limitations:['Original EventScore timing/pitch/gates/pan are preserved for routed notes; only velocity is scaled by the layer gain.','Sound is a new arrangement: marimba replaces pluck/bell, sine substitutes pad/texture/bass. Original live DSP effects/weather are not reproduced.','Out-of-range marimba pitches use explicitly counted sine fallback without octave folding.','Tom/cymbal layers must be muted while drums are enabled; bank does not contain those instruments.','Percussion one-shots retain natural sample tails; stopping at duration minus 2 seconds explicitly releases all voices.','Offline Node qualification only; no PWA, Android, VST integration, listening approval or release claim.']};
  return {wav,report,events:plan.events};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const [config,out]=process.argv.slice(2);if(!config||!out)throw new Error('Usage: node tools/render-score-cue.mjs cue.json output/base');
  const result=await renderScoreCue(JSON.parse(await readFile(config,'utf8')));await mkdir(dirname(resolve(out)),{recursive:true});await saveCue(out,result);console.log(JSON.stringify({...result.report,sourceEvents:undefined,routingAudit:undefined},null,2));
}
