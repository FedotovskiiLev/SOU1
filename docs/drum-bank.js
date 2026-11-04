// SPDX-License-Identifier: AGPL-3.0-only
import {loadBrowserBank,sha256} from './audio-kit/experiments/rack-browser/bank.mjs';
import {PREPARED_DRUM_KITS,drumManifestPath} from './audio-kit/tools/instruments/drum-kits.mjs';
export const WEB_DRUM_KITS=Object.freeze(['procedural','vcsl',...PREPARED_DRUM_KITS]);
const IDS=['kick','snare','closed-hat','toms','short-clash'];
function sinc(x){return Math.abs(x)<1e-9?1:Math.sin(Math.PI*x)/(Math.PI*x);}
// Same bounded Hann-windowed reconstruction as tools/instruments/rack.mjs,
// evaluated once during preparation, never on the audio rendering thread.
function preparedSample(pcm,step){
 if(!Number.isFinite(step)||step<.125||step>8)throw new RangeError('Prepared sample ratio');
 const frames=Math.ceil(pcm.length/step),out=new Float32Array(frames),cut=Math.min(1,1/step)*.92;
 for(let n=0;n<frames;n++){
  const pos=n*step,base=Math.floor(pos);let sum=0,weights=0;
  for(let j=base-7;j<=base+8;j++){const d=pos-j;if(Math.abs(d)>=8)continue;const w=cut*sinc(d*cut)*(.5+.5*Math.cos(Math.PI*d/8));weights+=w;if(j>=0&&j<pcm.length)sum+=pcm[j]*w;}
  out[n]=Math.abs(weights)>1e-9?sum/weights:0;
  if(!Number.isFinite(out[n])||Math.abs(out[n])>2)throw new RangeError('Prepared PCM reconstruction range');
 }
 return out;
}
export async function prepareDrumBank(kit,rate,{fetcher=fetch,assetBaseUrl=new URL('./audio-kit/',import.meta.url)}={}){
 if(!WEB_DRUM_KITS.includes(kit)||kit==='procedural'||!Number.isInteger(rate)||rate<8000||rate>192000)throw new RangeError('Drum kit/sample rate');
 const paths=['assets/cc0-mini/manifest.json',...(kit==='vcsl'?[]:[drumManifestPath(kit)])];
 const instruments=new Map(),provenance={},banks=[];let encoded=0,decoded=0,mapped=0;
 for(const path of paths){
  const bank=await loadBrowserBank(new URL(path,assetBaseUrl),{fetcher,maxEncodedBytes:12*1024*1024-encoded,maxDecodedBytes:Math.min(8*1024*1024,16*1024*1024-decoded),maxMappedBytes:Math.min(8*1024*1024,16*1024*1024-mapped)});
  encoded+=bank.encodedBytes;decoded+=bank.decodedBytes;mapped+=bank.mappedBytes;
  for(const [id,instrument] of bank.instruments)if(IDS.includes(id)){instruments.set(id,instrument);provenance[id]=bank.manifest.id;}
  banks.push({id:bank.manifest.id,manifest:path,sha256:bank.manifestSha256,sourceCommit:bank.manifest.sourceCommit});
 }
 if(IDS.some(id=>!instruments.has(id)))throw new Error('Incomplete recorded drum bank');
 const samples=[],definitions=[],converted=[],cache=new Map();let preparedBytes=0,peak=0;
 for(const id of IDS){
  const inst=instruments.get(id),zones=[];
  if(!inst.oneShot)throw new Error('Live drum source must be one-shot');
  for(const zone of inst.zones){
   const keys=zone.pitched?Array.from({length:zone.keyHigh-zone.keyLow+1},(_,i)=>zone.keyLow+i):[null];
   if(keys.length>16)throw new RangeError('Pitched drum key range');
   for(const pitch of keys){
    const sample=zone.sample,step=sample.sampleRate/rate*(pitch===null?1:2**((pitch-sample.rootNote)/12));
    let byPitch=cache.get(sample);if(!byPitch){byPitch=new Map();cache.set(sample,byPitch);}
    const key=pitch===null?'unpitched':pitch;
    let index=byPitch.get(key);
    if(index===undefined){
     const frames=Math.ceil(sample.pcm.length/step);
     if(!Number.isSafeInteger(frames)||frames<2||frames>rate*10||samples.length>=32||preparedBytes+frames*4>16*1024*1024)throw new RangeError('Prepared drum bank memory');
     const pcm=preparedSample(sample.pcm,step);preparedBytes+=pcm.byteLength;index=samples.length;samples.push(pcm);byPitch.set(key,index);
     let localPeak=0;for(const v of pcm)localPeak=Math.max(localPeak,Math.abs(v));peak=Math.max(peak,localPeak);
     converted.push({sampleIndex:index,frames:pcm.length,sourceRate:sample.sampleRate,targetRate:rate,pitch,step,peak:localPeak,pcmSha256:await sha256(new Uint8Array(pcm.buffer))});
    }
    zones.push({keyLow:pitch??zone.keyLow,keyHigh:pitch??zone.keyHigh,velocityLow:zone.velocityLow,velocityHigh:zone.velocityHigh,sampleIndex:index});
   }
  }
  definitions.push({id,gain:inst.gain,oneShot:true,chokeGroup:inst.chokeGroup,zones});
 }
 return {wireBank:{sampleRate:rate,instruments:definitions,samples},report:{schema:'sou1.prepared-live-drums.v1',kit,sampleRate:rate,banks,instrumentBanks:provenance,encodedBytes:encoded,sourceDecodedBytes:decoded,sourceMappedBytes:mapped,preparedBytes,preparedPeak:peak,converted,limitations:['Prepared reconstruction can exceed source sample peaks; no clipping or normalization is applied.','Current live score still uses original melodic synthesis; this changes recorded percussion only.','Source hard-hit rail contacts remain documented in Guigui provenance.']}};
}
