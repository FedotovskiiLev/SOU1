// SPDX-License-Identifier: AGPL-3.0-only
import {readFile,open} from 'node:fs/promises';
import {prepareCustomDrumBank} from '../docs/custom-drum-bank.js';
const target=process.argv[2];if(!target)throw Error('Output required');
const base=new URL('https://sou1.invalid/audio-kit/');
const fetcher=async url=>{const u=new URL(url);if(!u.href.startsWith(base.href)||u.search||u.hash)throw Error('Fixture path');return new Response(await readFile(new URL('../docs/audio-kit/'+u.href.slice(base.href.length),import.meta.url)));};
const selections=[
 ['vcsl',{kick:'fsa-distkit',snare:'fsa-synthkit',hihat:'fsa-x0xproc2',toms:'guigui-soft',cymbal:'guigui-dynamic'}],
 ['guigui-dynamic',{kick:'fsa-x0xproc1',snare:'fsa-sdbkit',hihat:'vcsl',toms:'fsa-electronic',cymbal:'fsa-sdbkit'}],
 ['fsa-electronic',{kick:'guigui-dynamic',snare:'guigui-soft',hihat:'fsa-synthkit',toms:'fsa-distkit',cymbal:'fsa-x0xproc2'}],
 ['vcsl',{cymbal:'guigui-dynamic'}],
];
const cases=selections.flatMap(([kit,overrides])=>[44100,48000].map(rate=>[kit,overrides,rate]));cases.push(['vcsl',{cymbal:'guigui-dynamic'},8000],['vcsl',{cymbal:'guigui-dynamic'},192000]);
let chunks=[];const file=await open(target,'w');
const i32=n=>{const b=Buffer.alloc(4);b.writeInt32BE(n);chunks.push(b);};
const f64=n=>{const b=Buffer.alloc(8);b.writeDoubleBE(n);chunks.push(b);};
const str=s=>{const b=Buffer.from(s);i32(b.length);chunks.push(b);};
try{str('sou1.custom-drum-vectors.v1');i32(cases.length);for(const [kit,overrides,rate]of cases){
 const {wireBank:b,report:r}=await prepareCustomDrumBank(kit,overrides,rate,{fetcher,assetBaseUrl:base});
 str(r.kit);i32(rate);for(const name of ['encodedBytes','sourceDecodedBytes','sourceMappedBytes','preparedBytes'])i32(r[name]);f64(r.preparedPeak);i32(r.banks.length);
 for(const source of r.banks)for(const name of ['id','manifest','sha256','sourceCommit'])str(source[name]);
 for(const inst of b.instruments)str(r.instrumentBanks[inst.id]);
 for(const source of Object.values(r.roleSources))for(const name of ['kit','id','manifest','sha256','sourceCommit'])str(source[name]);
 i32(b.samples.length);for(let n=0;n<b.samples.length;n++){
  const sample=b.samples[n],c=r.converted[n];i32(sample.length);i32(c.sourceRate);i32(c.pitch??-1);f64(c.step);f64(c.peak);str(c.pcmSha256);
  i32(r.sampleOrigins[n].length);for(const origin of r.sampleOrigins[n]){for(const name of ['role','kit','bankId','manifest','manifestSha256','sourceCommit','sampleId','file','sha256'])str(origin[name]);i32(origin.sourceRate);i32(origin.rootNote);}
  const pcm=Buffer.alloc(sample.length*4);for(let j=0;j<sample.length;j++)pcm.writeFloatBE(sample[j],j*4);chunks.push(pcm);
 }
 i32(b.instruments.length);for(const inst of b.instruments){str(inst.id);f64(inst.gain);str(inst.chokeGroup??'');i32(inst.zones.length);for(const z of inst.zones){i32(z.sampleIndex);i32(z.keyLow);i32(z.keyHigh);f64(z.velocityLow);f64(z.velocityHigh);}}
 await file.write(Buffer.concat(chunks));chunks=[];console.log(`Custom JS oracle: ${r.kit} @ ${rate}, ${b.samples.length} samples, ${r.preparedBytes} bytes`);
}}finally{await file.close();}
