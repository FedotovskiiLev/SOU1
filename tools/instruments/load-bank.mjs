// SPDX-License-Identifier: AGPL-3.0-only
import {readFile,realpath,stat} from 'node:fs/promises';
import {resolve,dirname,basename} from 'node:path';
import {createHash} from 'node:crypto';
import {decodePcmWav} from './wav.mjs';
import {SampleInstrument} from './rack.mjs';
const sha=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const id=x=>typeof x==='string'&&/^[a-z0-9-]{1,64}$/.test(x);
export async function loadBank(manifestPath,{maxDecodedBytes=8*1024*1024,maxFileBytes=4*1024*1024}={}){
  if(!Number.isSafeInteger(maxDecodedBytes)||maxDecodedBytes<4||maxDecodedBytes>64*1024*1024||!Number.isSafeInteger(maxFileBytes)||maxFileBytes<44||maxFileBytes>16*1024*1024)throw new RangeError('Bank budgets');
  const base=await realpath(dirname(resolve(manifestPath)));const mstat=await stat(manifestPath);if(!mstat.isFile()||mstat.size>128*1024)throw new RangeError('Manifest size');
  const m=JSON.parse(await readFile(manifestPath,'utf8'));
  if(m.schema!=='sou1.cc0-bank.v1'||!id(m.id)||m.license!=='CC0-1.0'||!Array.isArray(m.samples)||m.samples.length<1||m.samples.length>64||!Array.isArray(m.instruments)||m.instruments.length<1||m.instruments.length>32)throw new TypeError('CC0 manifest');
  const samples=new Map();let decodedBytes=0,encodedBytes=0;
  for(const s of m.samples){
    if(!id(s.id)||samples.has(s.id)||typeof s.file!=='string'||basename(s.file)!==s.file||!s.file.endsWith('.wav')||s.file.includes('\\')||!sha(s.sha256)||!sha(s.sourceSha256)||!/^[a-f0-9]{40}$/.test(s.sourceGitBlobSha1)||s.license!=='CC0-1.0'||typeof s.sourcePath!=='string'||typeof s.sourceCommit!=='string'||!/^[a-f0-9]{40}$/.test(s.sourceCommit)||!Number.isSafeInteger(s.bytes)||s.bytes<44||s.bytes>maxFileBytes)throw new TypeError('Sample provenance');
    const path=await realpath(resolve(base,s.file));if(dirname(path)!==base)throw new Error('Sample path escapes bank');
    const st=await stat(path);if(!st.isFile()||st.size!==s.bytes)throw new Error('Sample file size mismatch');
    const bytes=await readFile(path);if(createHash('sha256').update(bytes).digest('hex')!==s.sha256)throw new Error('Sample checksum mismatch');
    const decoded=decodePcmWav(bytes,maxDecodedBytes-decodedBytes);
    if(decoded.channels.length!==1||decoded.frames!==s.frames||decoded.sampleRate!==s.sampleRate||decoded.decodedBytes!==s.decodedBytes||s.channels!==1)throw new Error('Sample metadata mismatch');
    samples.set(s.id,{pcm:decoded.channels[0],sampleRate:decoded.sampleRate,rootNote:s.rootNote});decodedBytes+=decoded.decodedBytes;encodedBytes+=bytes.length;
  }
  const instruments=new Map();let mappedBytes=0;for(const d of m.instruments){if(!id(d.id)||instruments.has(d.id)||!Array.isArray(d.zones))throw new TypeError('Instrument id/zones');const mapped=new Set(d.zones.map(z=>z.sample));for(const key of mapped){const sample=samples.get(key);if(!sample)throw new TypeError('Unknown sample');mappedBytes+=sample.pcm.byteLength;}if(mappedBytes>maxDecodedBytes)throw new RangeError('Mapped sample budget');instruments.set(d.id,new SampleInstrument(d,samples));}
  return {instruments,manifest:m,decodedBytes,encodedBytes};
}
