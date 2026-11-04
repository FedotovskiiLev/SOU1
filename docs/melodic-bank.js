// SPDX-License-Identifier: AGPL-3.0-only
// Worker-side only. No browser audio APIs or native plug-ins are needed.
import {boundedFetch,sha256} from './audio-kit/experiments/rack-browser/bank.mjs';
import {decodePcmWav} from './audio-kit/tools/instruments/wav.mjs';
import {LiveMelodicPool} from './live-melodic-pool.js';
import {MELODIC_ASSETS} from './melodic-catalog.js';
export const MELODIC_PRESETS=Object.freeze(['procedural',...Object.keys(MELODIC_ASSETS)]);
const hex=s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
export async function prepareMelodicBank(preset,sampleRate,{fetcher=fetch,assetBaseUrl=new URL('./melodic-assets/',import.meta.url),signal}={}){
 if(!Object.hasOwn(MELODIC_ASSETS,preset)||!Number.isInteger(sampleRate)||sampleRate<8000||sampleRate>192000)throw new RangeError('Melodic preset/rate');
 const check=()=>{if(signal?.aborted)throw new DOMException('Melodic bank preparation cancelled','AbortError');};
 const assetFetch=(url,options)=>fetcher(url,{...options,signal});
 const locked=MELODIC_ASSETS[preset];check();const bytes=await boundedFetch(new URL(preset+'.json',assetBaseUrl),locked.bytes,{fetcher:assetFetch});check();
 if(bytes.length!==locked.bytes||await sha256(bytes)!==locked.sha256)throw new Error('Melodic manifest integrity mismatch');
 const m=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
 if(m.schema!=='sou1.melodic-bank.v1'||m.id!==preset||m.license!=='CC0-1.0'||!Array.isArray(m.samples)||m.samples.length<1||m.samples.length>96||!Array.isArray(m.instruments)||m.instruments.length!==5)throw new TypeError('Melodic manifest');
 let encoded=0,decoded=0;
 for(const s of m.samples){if(typeof s.file!=='string'||!/^[-a-z0-9]+\.wav$/.test(s.file)||!hex(s.sha256)||!hex(s.sourceSha256)||s.license!=='CC0-1.0'||!Number.isSafeInteger(s.frames)||s.frames<2||!Number.isSafeInteger(s.bytes)||s.bytes<44||s.bytes>2*1024*1024)throw new TypeError('Melodic sample metadata');encoded+=s.bytes;decoded+=s.frames*4;}
 if(encoded>16*1024*1024||decoded>32*1024*1024||m.decodedBytes!==decoded||m.encodedBytes!==encoded)throw new RangeError('Melodic bank memory budget');
 const samples=[];
 for(const s of m.samples){check();const raw=await boundedFetch(new URL(s.file,assetBaseUrl),s.bytes,{fetcher:assetFetch});check();if(raw.length!==s.bytes||await sha256(raw)!==s.sha256)throw new Error('Melodic sample integrity mismatch');const d=decodePcmWav(raw,decoded);if(d.channels.length!==1||d.frames!==s.frames||d.sampleRate!==s.sampleRate)throw new Error('Melodic WAV metadata mismatch');samples.push({pcm:d.channels[0],sampleRate:s.sampleRate,rootNote:s.rootNote,loopStart:s.loopStart,loopEnd:s.loopEnd,crossfade:s.crossfade});}
 check();return {wireBank:LiveMelodicPool.prepare(sampleRate,{sampleRate,samples,instruments:m.instruments}),report:{schema:'sou1.prepared-melodic.v1',preset,sampleRate,encodedBytes:encoded,decodedBytes:decoded,manifestSha256:locked.sha256,ranges:m.instruments.map(d=>({layer:d.layer,id:d.id,keyLow:d.keyLow,keyHigh:d.keyHigh})),limitations:m.notes}};
}
