// SPDX-License-Identifier: AGPL-3.0-only
import {readFile,mkdir,lstat} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {composeVarietyPlan} from './composition/variety-score.mjs';
import {composeExpressivePlan} from './composition/expressive-score.mjs';
import {summarizeVariety} from './composition/variety-metrics.mjs';
import {InstrumentRack,SineInstrument} from './instruments/rack.mjs';
import {loadBank} from './instruments/load-bank.mjs';
import {wavHeader,saveCue} from './render-cue.mjs';
import {readJson} from './bounded-json.mjs';
const digest=x=>createHash('sha256').update(x).digest('hex');
const FILES=['tools/render-variety-cue.mjs','tools/composition/variety-score.mjs','tools/composition/expressive-score.mjs','tools/composition/variety-metrics.mjs','tools/instruments/rack.mjs','tools/instruments/wav.mjs','tools/instruments/load-bank.mjs','tools/instruments/event-score.mjs','tools/instruments/event-score-core.mjs','tools/render-cue.mjs','tools/bounded-json.mjs','assets/cc0-mini/manifest.json'];
export async function varietyFingerprint(){const files={};for(const file of FILES)files[file]=digest(await readFile(new URL('../'+file,import.meta.url)));return files;}
export async function renderVarietyCue(options={},blockSize=256,expected={}) {
  return renderPlan(composeVarietyPlan(options),blockSize,expected);
}
export async function renderExpressiveCue(options={},blockSize=256,expected={}) {
  return renderPlan(composeExpressivePlan(options),blockSize,expected);
}
async function renderPlan(plan,blockSize,expected) {
  if(!Number.isInteger(blockSize)||blockSize<1||blockSize>2048)throw new RangeError('blockSize 1..2048');
  const o=plan.options,rendererFiles=await varietyFingerprint();
  if(expected.rendererFiles!==undefined && (!expected.rendererFiles||typeof expected.rendererFiles!=='object'||Array.isArray(expected.rendererFiles)||Object.keys(expected.rendererFiles).length!==Object.keys(rendererFiles).length||Object.keys(rendererFiles).some(k=>rendererFiles[k]!==expected.rendererFiles[k])))throw new Error('Composer/renderer/bank version differs from receipt');
  if(expected.sha256!==undefined && (typeof expected.sha256!=='string'||!/^[a-f0-9]{64}$/.test(expected.sha256)))throw new TypeError('Expected SHA-256 required');
  const bank=await loadBank(fileURLToPath(new URL('../assets/cc0-mini/manifest.json',import.meta.url)));
  for(const [id,gain] of [['sine-pad',.14],['sine-texture',.05],['sine-bass',.20]])bank.instruments.set(id,new SineInstrument({gain}));
  const rack=new InstrumentRack(o.sampleRate,bank.instruments,{polyphony:48});rack.schedule(plan.events);
  const wav=Buffer.alloc(44+plan.frames*6);wavHeader(plan.frames,o.sampleRate).copy(wav);
  const left=new Float32Array(blockSize),right=new Float32Array(blockSize),gain=10**(o.outputGainDb/20);let peak=0,sum=0;
  for(let at=0;at<plan.frames;){
    if(at===plan.activeFrames)rack.stop();
    const n=Math.min(blockSize,plan.frames-at,at<plan.activeFrames?plan.activeFrames-at:plan.frames-at);
    rack.render(left.subarray(0,n),right.subarray(0,n));
    for(let i=0;i<n;i++)for(let channel=0;channel<2;channel++){
      const x=(channel?right[i]:left[i])*gain*Math.min(1,(plan.frames-at-i-1)/128);
      if(!Number.isFinite(x)||Math.abs(x)>=1)throw new Error('Non-finite/clipping variety output; reduce outputGainDb');
      peak=Math.max(peak,Math.abs(x));sum+=x*x;wav.writeIntLE(Math.round(x*8388607),44+(at+i)*6+channel*3,3);
    }at+=n;
  }
  if(rack.stats.unmapped||rack.stats.dropped)throw new Error('Rack cannot preserve all composition events');
  const sha256=digest(wav);if(expected.sha256!==undefined && sha256!==expected.sha256)throw new Error('Replay is not byte-identical; no output saved');
  const report={schema:plan.expression?'sou1.expressive-cue.v1':'sou1.variety-cue.v1',composerVersion:plan.schema,options:o,...(plan.expression?{expression:plan.expression}:{}),rendererFiles,runtime:{node:process.version,platform:process.platform,arch:process.arch},frames:plan.frames,activeFrames:plan.activeFrames,duration:plan.frames/o.sampleRate,meter:plan.meter,motif:plan.motif,progression:plan.progression,barPlan:plan.barPlan,metrics:summarizeVariety(plan),bankId:bank.manifest.id,bankSourceCommit:bank.manifest.sourceCommit,...plan.stats,rack:{...rack.stats,activeVoices:rack.voices.length},peakDbfs:peak?20*Math.log10(peak):null,rmsDbfs:sum?10*Math.log10(sum/(2*plan.frames)):null,clippedSamples:0,nonfiniteSamples:0,sha256,replayVerified:expected.sha256!==undefined,sourceEvents:plan.sourceEvents,routingAudit:plan.audit,limitations:[...plan.limitations,'All styles use the same marimba, sine pad/bass and CC0 drum bank. The contrast is composition, not a change of sound library.','Original synth effects, browser/Android integration, realtime scheduling and REAPER were not tested here.','Two seconds after the final complete bar are reserved for transport release; this is not a mastering or loudness-normalization tool.','CC0 one-shot percussion keeps its recorded tail; composition gates apply to pitched voices.']};
  return {wav,report,events:plan.events};
}
export async function main(args=process.argv.slice(2)){
  let options,out,expected={},renderer=renderVarietyCue;
  if(args.length===3 && args[0]==='--replay'){
    const receipt=await readJson(args[1],8*1024*1024);
    if(!['sou1.variety-cue.v1','sou1.expressive-cue.v1'].includes(receipt.schema)||!receipt.rendererFiles||!receipt.options||!receipt.sha256)throw new TypeError('Not a variety cue receipt');
    if(receipt.schema==='sou1.expressive-cue.v1'){renderer=renderExpressiveCue;options={score:receipt.options,...receipt.expression};}else options=receipt.options;
    expected={rendererFiles:receipt.rendererFiles,sha256:receipt.sha256};out=args[2];
  }else if(args.length===3 && args[0]==='--expressive'){renderer=renderExpressiveCue;options=await readJson(args[1],64*1024);out=args[2];
  }else if(args.length===2){options=await readJson(args[0],64*1024);out=args[1];}
  else throw new Error('Usage: node tools/render-variety-cue.mjs options.json output/base | --expressive expression.json output/base | --replay receipt.json output/base');
  for(const suffix of ['.wav','.json']){try{await lstat(out+suffix);}catch(e){if(e.code==='ENOENT')continue;throw e;}throw new Error('Output exists; choose another file base: '+out+suffix);}
  const result=await renderer(options,256,expected);await mkdir(dirname(resolve(out)),{recursive:true});await saveCue(out,result);
  console.log(JSON.stringify({wav:out+'.wav',receipt:out+'.json',style:result.report.options.style,sha256:result.report.sha256,duration:result.report.duration,peakDbfs:result.report.peakDbfs,replayVerified:result.report.replayVerified}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(e=>{process.stderr.write('SOU1 variety: '+e.message+'\n');process.exitCode=1;});
