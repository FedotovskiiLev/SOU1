// SPDX-License-Identifier: AGPL-3.0-only
import {decodePcmWav} from '../../tools/instruments/wav.mjs';
import {SampleInstrument} from '../../tools/instruments/rack.mjs';
const hex=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
export async function boundedFetch(url,limit,{fetcher=fetch}={}){
  const r=await fetcher(url,{mode:'same-origin',credentials:'omit',redirect:'error',cache:'no-store'});
  if(!r.ok)throw new Error('HTTP '+r.status+' loading '+new URL(url).pathname);
  if(Number(r.headers.get('content-length'))>limit)throw new RangeError('Response exceeds size limit');
  const reader=r.body.getReader(),chunks=[];let n=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;n+=value.length;if(n>limit)throw new RangeError('Response exceeds size limit');chunks.push(value);}}
  catch(e){await reader.cancel();throw e;}finally{reader.releaseLock();}
  const out=new Uint8Array(n);let at=0;for(const chunk of chunks){out.set(chunk,at);at+=chunk.length;}return out;
}
export async function sha256(bytes){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');}
export async function loadBrowserBank(manifestUrl,{fetcher=fetch,onProgress=()=>{},maxEncodedBytes=8*1024*1024,maxDecodedBytes=8*1024*1024,maxMappedBytes=8*1024*1024}={}){
  for(const limit of [maxEncodedBytes,maxDecodedBytes,maxMappedBytes])if(!Number.isSafeInteger(limit)||limit<0||limit>64*1024*1024)throw new RangeError('Bank budgets');
  const base=new URL('.',manifestUrl);if(!['http:','https:'].includes(base.protocol))throw new Error('Serve this prototype over localhost HTTP or HTTPS');
  const manifestBytes=await boundedFetch(manifestUrl,128*1024,{fetcher});
  const m=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(manifestBytes));
  if(typeof m.id!=='string'||!/^[a-z0-9-]{1,64}$/.test(m.id)||m.schema!=='sou1.cc0-bank.v1'||m.license!=='CC0-1.0'||!Array.isArray(m.samples)||m.samples.length<1||m.samples.length>64||!Array.isArray(m.instruments)||m.instruments.length<1||m.instruments.length>32)throw new TypeError('Invalid bank manifest');
  // Reject the complete declared size before fetching even the first WAV.
  let declaredEncoded=0,declaredDecoded=0;
  for(const sample of m.samples){
    if(!Number.isSafeInteger(sample.bytes)||sample.bytes<44||sample.bytes>4*1024*1024||!Number.isSafeInteger(sample.frames)||sample.frames<2||sample.decodedBytes!==sample.frames*4)throw new TypeError('Sample size metadata');
    declaredEncoded+=sample.bytes;declaredDecoded+=sample.decodedBytes;
    if(declaredEncoded>maxEncodedBytes||declaredDecoded>maxDecodedBytes)throw new RangeError('Declared bank sample memory budget');
  }
  const samples=new Map();let decodedBytes=0,encodedBytes=0;
  for(const s of m.samples){
    if(typeof s.id!=='string'||!/^[a-z0-9-]{1,64}$/.test(s.id)||samples.has(s.id)||typeof s.file!=='string'||!/^[a-z0-9-]+\.wav$/.test(s.file)||!hex(s.sha256)||!hex(s.sourceSha256)||typeof s.sourcePath!=='string'||typeof s.sourceCommit!=='string'||!/^[a-f0-9]{40}$/.test(s.sourceCommit)||typeof s.sourceGitBlobSha1!=='string'||!/^[a-f0-9]{40}$/.test(s.sourceGitBlobSha1)||s.license!=='CC0-1.0'||!Number.isInteger(s.bytes)||s.bytes<44||s.bytes>4*1024*1024)throw new TypeError('Invalid sample provenance');
    const bytes=await boundedFetch(new URL(s.file,base),s.bytes,{fetcher});if(bytes.length!==s.bytes||await sha256(bytes)!==s.sha256)throw new Error('Sample size/checksum mismatch');
    const d=decodePcmWav(bytes,maxDecodedBytes-decodedBytes);
    if(d.channels.length!==1||s.channels!==1||d.sampleRate!==s.sampleRate||d.frames!==s.frames||d.decodedBytes!==s.decodedBytes)throw new Error('Sample metadata mismatch');
    samples.set(s.id,{pcm:d.channels[0],sampleRate:d.sampleRate,rootNote:s.rootNote});decodedBytes+=d.decodedBytes;encodedBytes+=bytes.length;onProgress(samples.size/m.samples.length);
  }
  const instruments=new Map();let mappedBytes=0;
  for(const d of m.instruments){if(typeof d.id!=='string'||!/^[a-z0-9-]{1,64}$/.test(d.id)||instruments.has(d.id)||!Array.isArray(d.zones))throw new TypeError('Instrument id/zones');for(const id of new Set(d.zones.map(z=>z.sample))){if(!samples.has(id))throw new Error('Missing sample');mappedBytes+=samples.get(id).pcm.byteLength;}if(mappedBytes>maxMappedBytes)throw new RangeError('Mapped bank memory budget');instruments.set(d.id,new SampleInstrument(d,samples));}
  return {instruments,manifest:m,decodedBytes,encodedBytes,mappedBytes,manifestSha256:await sha256(manifestBytes)};
}
