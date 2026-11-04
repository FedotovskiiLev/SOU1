// SPDX-License-Identifier: AGPL-3.0-only
// Closed per-role assembly. Preparation only, never import into an audio callback.
import {prepareDrumBank} from './drum-bank.js';
import {loadBrowserBank,sha256} from './audio-kit/experiments/rack-browser/bank.mjs';
import {drumManifestPath,drumKitCapabilities} from './audio-kit/tools/instruments/drum-kits.mjs';
import {CUSTOM_DRUM_ROLES,CUSTOM_DRUM_INSTRUMENTS,normalizeCustomDrumSelection} from './custom-drum-selection.js';
export {CUSTOM_DRUM_ROLES,CUSTOM_DRUM_INSTRUMENTS,CUSTOM_DRUM_KITS,normalizeCustomDrumSelection,customDrumSelectionKey,parseCustomDrumSelection,isSupportedDrumSelection,deterministicRandomDrumOverrides} from './custom-drum-selection.js';
const BASE_MANIFEST='assets/cc0-mini/manifest.json',MIB=1024*1024;
function manifestFor(kit,role){
 if(kit==='vcsl')return BASE_MANIFEST;
 const capabilities=drumKitCapabilities(kit);
 if(role==='toms'&&!capabilities.toms||role==='cymbal'&&!capabilities.cymbal)return BASE_MANIFEST;
 return drumManifestPath(kit);
}
function sinc(x){return Math.abs(x)<1e-9?1:Math.sin(Math.PI*x)/(Math.PI*x);}
// Deliberately the same Float32 reconstruction as prepareDrumBank, without gain,
// clipping, trimming, source replacement, normalization or random decisions.
function reconstruct(pcm,step){
 const out=new Float32Array(Math.ceil(pcm.length/step)),cut=Math.min(1,1/step)*.92;
 for(let n=0;n<out.length;n++){
  const pos=n*step,base=Math.floor(pos);let sum=0,weights=0;
  for(let j=base-7;j<=base+8;j++){const d=pos-j;if(Math.abs(d)>=8)continue;const w=cut*sinc(d*cut)*(.5+.5*Math.cos(Math.PI*d/8));weights+=w;if(j>=0&&j<pcm.length)sum+=pcm[j]*w;}
  out[n]=Math.abs(weights)>1e-9?sum/weights:0;
  if(!Number.isFinite(out[n])||Math.abs(out[n])>2)throw new RangeError('Prepared PCM reconstruction range');
 }
 return out;
}
const sampleKey=(s,pitch)=>[s.sha256,s.sampleRate,s.rootNote,pitch??'unpitched'].join('|');
export async function prepareCustomDrumBank(baseKit,overrides,rate,{fetcher=fetch,assetBaseUrl=new URL('./audio-kit/',import.meta.url)}={}){
 const selection=normalizeCustomDrumSelection(baseKit,overrides);
 if(!Number.isInteger(rate)||rate<8000||rate>192000)throw new RangeError('Drum sample rate');
 // Preserve the original output/report/provenance, not a reconstructed imitation.
 if(selection.key===baseKit)return prepareDrumBank(baseKit,rate,{fetcher,assetBaseUrl});
 const paths=CUSTOM_DRUM_ROLES.map(role=>manifestFor(selection.resolvedKits[role],role));
 const prepared=new Map(),byRole=new Map(),banks=[],roleSources={},instrumentBanks={};
 let encoded=0,decoded=0,mapped=0,preparedBytes=0,peakDecoded=0,peakMapped=0,maxWav=0,peakSourcePcm=0;
 for(const path of new Set(paths)){
  // One source bank at a time. Only materialized selected PCM escapes this scope.
  const bank=await loadBrowserBank(new URL(path,assetBaseUrl),{fetcher,maxEncodedBytes:12*MIB-encoded,maxDecodedBytes:8*MIB,maxMappedBytes:8*MIB});
  encoded+=bank.encodedBytes;decoded+=bank.decodedBytes;mapped+=bank.mappedBytes;
  peakDecoded=Math.max(peakDecoded,bank.decodedBytes);peakMapped=Math.max(peakMapped,bank.mappedBytes);peakSourcePcm=Math.max(peakSourcePcm,bank.decodedBytes+bank.mappedBytes);
  const source={id:bank.manifest.id,manifest:path,sha256:bank.manifestSha256,sourceCommit:bank.manifest.sourceCommit};banks.push(source);
  const metadata=new Map(bank.manifest.samples.map(sample=>[sample.id,sample]));
  for(const sample of bank.manifest.samples)maxWav=Math.max(maxWav,sample.bytes);
  for(let i=0;i<CUSTOM_DRUM_ROLES.length;i++){
   if(paths[i]!==path)continue;
   const role=CUSTOM_DRUM_ROLES[i],id=CUSTOM_DRUM_INSTRUMENTS[i],inst=bank.instruments.get(id);
   if(!inst||!inst.oneShot)throw new Error('Incomplete one-shot custom drum bank');
   const declared=bank.manifest.instruments.find(d=>d.id===id),zones=[];
   roleSources[role]={kit:selection.resolvedKits[role],...source};instrumentBanks[id]=source.id;
   for(let z=0;z<inst.zones.length;z++){
    const zone=inst.zones[z],meta=metadata.get(declared.zones[z].sample),sample=zone.sample;
    const pitches=zone.pitched?Array.from({length:zone.keyHigh-zone.keyLow+1},(_,n)=>zone.keyLow+n):[null];
    if(pitches.length>16)throw new RangeError('Pitched drum key range');
    for(const pitch of pitches){
     const key=sampleKey(meta,pitch),step=sample.sampleRate/rate*(pitch===null?1:2**((pitch-sample.rootNote)/12));
     if(!Number.isFinite(step)||step<.125||step>8)throw new RangeError('Prepared sample ratio');
     const origin={role,kit:selection.resolvedKits[role],bankId:source.id,manifest:path,manifestSha256:source.sha256,sourceCommit:source.sourceCommit,sampleId:meta.id,file:meta.file,sha256:meta.sha256,sourceRate:meta.sampleRate,rootNote:meta.rootNote};
     let entry=prepared.get(key);
     if(!entry){
      const frames=Math.ceil(sample.pcm.length/step);
      if(!Number.isSafeInteger(frames)||frames<2||frames>rate*10||prepared.size>=32||preparedBytes+frames*4>16*MIB)throw new RangeError('Prepared custom drum bank memory');
      const pcm=reconstruct(sample.pcm,step);preparedBytes+=pcm.byteLength;
      let peak=0;for(const value of pcm)peak=Math.max(peak,Math.abs(value));
      entry={pcm,conversion:{frames:pcm.length,sourceRate:sample.sampleRate,targetRate:rate,pitch,step,peak,pcmSha256:await sha256(new Uint8Array(pcm.buffer))},origins:[]};prepared.set(key,entry);
     }
     if(!entry.origins.some(o=>o.role===role&&o.manifest===path&&o.sampleId===meta.id))entry.origins.push(origin);
     zones.push({keyLow:pitch??zone.keyLow,keyHigh:pitch??zone.keyHigh,velocityLow:zone.velocityLow,velocityHigh:zone.velocityHigh,key});
     if(zones.length>64)throw new RangeError('Custom drum zone count');
    }
   }
   byRole.set(role,{id,gain:inst.gain,oneShot:true,chokeGroup:inst.chokeGroup,zones});
  }
 }
 // Canonical instrument/zone order, independent of manifest grouping or object key order.
 const samples=[],instruments=[],converted=[],sampleOrigins=[],indices=new Map();
 for(const role of CUSTOM_DRUM_ROLES){
  const definition=byRole.get(role),zones=[];
  for(const {key,...zone} of definition.zones){
   let index=indices.get(key);
   if(index===undefined){const entry=prepared.get(key);index=samples.length;indices.set(key,index);samples.push(entry.pcm);converted.push({sampleIndex:index,...entry.conversion});sampleOrigins.push(entry.origins.slice().sort((a,b)=>CUSTOM_DRUM_ROLES.indexOf(a.role)-CUSTOM_DRUM_ROLES.indexOf(b.role)));}
   zones.push({...zone,sampleIndex:index});
  }
  instruments.push({...definition,zones});
 }
 const orderedRoles=Object.fromEntries(CUSTOM_DRUM_ROLES.map(role=>[role,roleSources[role]]));
 const orderedBanks=Object.fromEntries(CUSTOM_DRUM_INSTRUMENTS.map(id=>[id,instrumentBanks[id]]));
 return {wireBank:{sampleRate:rate,instruments,samples},report:{schema:'sou1.prepared-custom-drums.v1',kit:selection.key,selection,sampleRate:rate,banks,instrumentBanks:orderedBanks,roleSources:orderedRoles,sampleOrigins,encodedBytes:encoded,sourceDecodedBytes:decoded,sourceMappedBytes:mapped,preparedBytes,preparedPeak:Math.max(...converted.map(c=>c.peak)),converted,memory:{peakSourceDecodedBytes:peakDecoded,peakSourceMappedBytes:peakMapped,transientPcmBytesUpperBound:preparedBytes+peakSourcePcm,transientEncodedBytesUpperBound:Math.max(256*1024,2*maxWav),publicationCopyBytes:preparedBytes},limitations:['Only the five existing live drum roles are assembled; missing kit articulations retain that kit’s existing VCSL fallback.','Source banks load sequentially. Memory estimates bound live sample buffers, not GC timing, object overhead or browser internals. Publication may make one additional prepared PCM copy.','Prepared reconstruction can exceed source sample peaks; no clipping or normalization is applied.','Source hard-hit rail contacts remain documented in Guigui provenance.']}};
}
