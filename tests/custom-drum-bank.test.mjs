// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {normalizeCustomDrumSelection,customDrumSelectionKey,parseCustomDrumSelection,prepareCustomDrumBank,CUSTOM_DRUM_ROLES,CUSTOM_DRUM_KITS,CUSTOM_DRUM_INSTRUMENTS} from '../docs/custom-drum-bank.js';
import {prepareDrumBank,WEB_DRUM_KITS} from '../docs/drum-bank.js';
import {isSupportedDrumSelection} from '../docs/custom-drum-selection.js';
import {LiveDrumPool} from '../docs/live-drum-pool.js';
const base=new URL('https://sou1.invalid/audio-kit/'),root=new URL('../docs/audio-kit/',import.meta.url);
const calls=[];
const fetcher=async url=>{const actual=new URL(url);assert.ok(actual.href.startsWith(base.href)&&!actual.search&&!actual.hash);calls.push(actual.href.slice(base.href.length));return new Response(await readFile(new URL(actual.href.slice(base.href.length),root)));};
const options={fetcher,assetBaseUrl:base};
const mixed={kick:'fsa-distkit',snare:'fsa-synthkit',hihat:'fsa-x0xproc2',toms:'guigui-soft',cymbal:'guigui-dynamic'};
const sha=pcm=>createHash('sha256').update(new Uint8Array(pcm.buffer)).digest('hex');
function roleView(bank,i){const definition=bank.instruments[i];return {...definition,zones:definition.zones.map(({sampleIndex,...zone})=>({...zone,pcm:sha(bank.samples[sampleIndex])}))};}
test('closed immutable selection and canonical token roundtrip',()=>{
 assert.deepEqual(CUSTOM_DRUM_KITS,WEB_DRUM_KITS.filter(k=>k!=='procedural'));assert.equal(isSupportedDrumSelection('procedural'),false);assert.equal(isSupportedDrumSelection('vcsl'),true);assert.equal(isSupportedDrumSelection('http://x'),false);
 const selection=normalizeCustomDrumSelection('vcsl',mixed);assert.equal(selection.key,'custom-v1|vcsl|fsa-distkit|fsa-synthkit|fsa-x0xproc2|guigui-soft|guigui-dynamic');assert.deepEqual(parseCustomDrumSelection(selection.key),selection);assert.ok(Object.isFrozen(selection)&&Object.isFrozen(selection.overrides)&&Object.isFrozen(selection.resolvedKits));
 for(const kit of CUSTOM_DRUM_KITS){assert.equal(customDrumSelectionKey(kit),kit);assert.equal(customDrumSelectionKey(kit,{kick:kit,snare:'inherit'}),kit);assert.equal(parseCustomDrumSelection(kit).key,kit);}
 const reversed=Object.fromEntries(Object.entries(mixed).reverse());assert.deepEqual(normalizeCustomDrumSelection('vcsl',reversed),selection);
 const changed={...mixed};const saved=normalizeCustomDrumSelection('vcsl',changed);changed.kick='vcsl';assert.equal(saved.overrides.kick,'fsa-distkit');
});
test('invalid types, prototype fields, getters, URLs and procedural mixtures reject before I/O',async()=>{
 let opens=0;const never={fetcher:async()=>{opens++;throw Error('unexpected I/O');}};
 for(const baseKit of [null,undefined,[],{},0,'','procedural','../vcsl','https://x','VCSL'])await assert.rejects(()=>prepareCustomDrumBank(baseKit,{},48000,never));
 for(const overrides of [null,[],0,'vcsl',{unknown:'vcsl'},{hihat:'procedural'},{kick:undefined},{kick:null},{kick:true},{kick:'https://x'},{kick:'../vcsl'},Object.create({kick:'vcsl'}),{get kick(){throw Error('getter ran');}},{[Symbol('kick')]:'vcsl'}])await assert.rejects(()=>prepareCustomDrumBank('vcsl',overrides,48000,never));
 for(const rate of [null,0,7999,192001,48000.5,NaN,Infinity])await assert.rejects(()=>prepareCustomDrumBank('vcsl',mixed,rate,never));
 for(const key of [null,{},'procedural','custom-v1|vcsl|inherit|inherit|inherit|inherit|inherit','custom-v1|vcsl|vcsl|fsa-distkit|inherit|inherit|inherit','custom-v1|vcsl|fsa-distkit|inherit|inherit|inherit','custom-v1|vcsl|fsa-distkit|inherit|inherit|inherit|inherit|extra','custom-v1|vcsl|fsa-distkit%2f|inherit|inherit|inherit|inherit'])assert.throws(()=>parseCustomDrumSelection(key));
 assert.equal(opens,0);
});
test('all inherited/default selections preserve every original PCM byte and report across nine banks',async()=>{
 for(const kit of CUSTOM_DRUM_KITS){const old=await prepareDrumBank(kit,48000,options),custom=await prepareCustomDrumBank(kit,{},48000,options);assert.deepEqual(custom,old);}
});
test('five distinct source kits preserve exact role PCM, gains, velocities, keys and source attribution',async()=>{
 calls.length=0;const result=await prepareCustomDrumBank('vcsl',mixed,48000,options),{wireBank:bank,report}=result;
 assert.equal(bank.instruments.length,5);assert.deepEqual(bank.instruments.map(i=>i.id),CUSTOM_DRUM_INSTRUMENTS);assert.ok(bank.samples.length<=32);assert.ok(report.preparedBytes<=16*1024*1024);assert.equal(report.banks.length,5);assert.ok(!calls.includes('assets/cc0-mini/manifest.json'));assert.equal(new Set(calls.filter(p=>p.endsWith('.json'))).size,5);
 for(let i=0;i<5;i++){const role=CUSTOM_DRUM_ROLES[i],old=await prepareDrumBank(mixed[role],48000,options);assert.deepEqual(roleView(bank,i),roleView(old.wireBank,i));assert.equal(report.roleSources[role].kit,mixed[role]);assert.equal(report.instrumentBanks[CUSTOM_DRUM_INSTRUMENTS[i]],old.report.instrumentBanks[CUSTOM_DRUM_INSTRUMENTS[i]]);for(const z of bank.instruments[i].zones){const origin=report.sampleOrigins[z.sampleIndex].find(o=>o.role===role);assert.ok(origin);const source=report.banks.find(s=>s.manifest===origin.manifest);assert.equal(origin.manifestSha256,source.sha256);assert.match(origin.sha256,/^[a-f0-9]{64}$/);}}
 assert.equal(report.preparedBytes,bank.samples.reduce((n,s)=>n+s.byteLength,0));for(const c of report.converted)assert.equal(c.pcmSha256,sha(bank.samples[c.sampleIndex]));
 const repeated=await prepareCustomDrumBank('vcsl',Object.fromEntries(Object.entries(mixed).reverse()),48000,options);assert.deepEqual(repeated,result);
 const pool=new LiveDrumPool(48000,bank),gains=new Float64Array(5).fill(1);for(const [layer,pitch]of [[5,36],[6,38],[7,42],[8,45],[8,47],[8,49],[9,49]])assert.ok(pool.trigger(layer,pitch,.8,.5));let energy=0;for(let n=0;n<4800;n++){pool.next(gains,true);energy+=pool.outputL**2;assert.ok(Number.isFinite(pool.outputL));}assert.ok(energy>0);assert.equal(pool.stats.unmapped,0);
});
test('existing incomplete-kit fallback is explicit; VCSL RR and Guigui velocity order survive',async()=>{
 const {wireBank:b,report:r}=await prepareCustomDrumBank('guigui-dynamic',{hihat:'vcsl',toms:'fsa-electronic',cymbal:'fsa-sdbkit'},44100,options);
 assert.equal(r.roleSources.toms.kit,'fsa-electronic');assert.equal(r.roleSources.toms.id,'vcsl-mini-v2');assert.equal(r.roleSources.cymbal.kit,'fsa-sdbkit');assert.equal(r.roleSources.cymbal.id,'vcsl-mini-v2');
 assert.equal(b.instruments[2].zones.length,2);assert.equal(b.instruments[1].zones[0].velocityHigh,.6);assert.equal(b.instruments[1].zones[1].velocityLow,.6000000000000001);
 const hashes=b.instruments[2].zones.map(z=>sha(b.samples[z.sampleIndex]));assert.notEqual(hashes[0],hashes[1]);
});
test('exact sample identities share slots but preserve gains, RR zones and every role origin',async()=>{
 const shared=async url=>{const r=await fetcher(url);if(new URL(url).pathname.endsWith('/fsa-drums/distkit/manifest.json')){const m=await r.json(),kick=m.instruments.find(i=>i.id==='kick'),snare=m.instruments.find(i=>i.id==='snare');snare.zones=[{...kick.zones[0]},{...kick.zones[0]}];return new Response(JSON.stringify(m));}return r;};
 const {wireBank:b,report:r}=await prepareCustomDrumBank('vcsl',{kick:'fsa-distkit',snare:'fsa-distkit'},48000,{...options,fetcher:shared});
 const k=b.instruments[0],s=b.instruments[1];assert.notEqual(k.gain,s.gain);assert.equal(s.zones.length,2);assert.equal(k.zones[0].sampleIndex,s.zones[0].sampleIndex);assert.equal(s.zones[0].sampleIndex,s.zones[1].sampleIndex);assert.deepEqual(r.sampleOrigins[k.zones[0].sampleIndex].map(o=>o.role),['kick','snare']);
});
test('checked WAV corruption rejects instead of silently swapping the requested role',async()=>{
 const corrupted=async url=>{const r=await fetcher(url);if(new URL(url).pathname.endsWith('/fsa-drums/distkit/kick.wav')){const bytes=new Uint8Array(await r.arrayBuffer());bytes[bytes.length-1]^=1;return new Response(bytes);}return r;};await assert.rejects(()=>prepareCustomDrumBank('vcsl',mixed,48000,{...options,fetcher:corrupted}),/checksum/);
});
test('32-slot cap rejects expanded source mappings without changing published banks',async()=>{
 const expanded=async url=>{const r=await fetcher(url);if(new URL(url).pathname.endsWith('/fsa-drums/distkit/manifest.json')){const m=await r.json();for(const i of m.instruments)if(['kick','snare','closed-hat'].includes(i.id))for(const z of i.zones){z.pitched=true;z.keyLow=60;z.keyHigh=75;}return new Response(JSON.stringify(m));}return r;};
 await assert.rejects(()=>prepareCustomDrumBank('vcsl',{kick:'fsa-distkit',snare:'fsa-distkit',hihat:'fsa-distkit'},48000,{...options,fetcher:expanded}),/memory/);
});
test('16 MiB final PCM cap is enforced independently of decoded source cap',async()=>{
 const frames=240000,bytes=Buffer.alloc(44+frames*2);bytes.write('RIFF');bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);bytes.writeUInt32LE(24000,24);bytes.writeUInt32LE(48000,28);bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(frames*2,40);
 const m=JSON.parse(await readFile(new URL('assets/fsa-drums/distkit/manifest.json',root)));const seed=m.samples[0],data=new Map();m.samples=['kick','snare','hat'].map((id,i)=>{const wav=Buffer.from(bytes);wav.writeInt16LE(i+1,44);data.set(id+'.wav',wav);return {...seed,id,file:id+'.wav',bytes:wav.length,frames,decodedBytes:frames*4,sampleRate:24000,rootNote:60,sha256:createHash('sha256').update(wav).digest('hex')};});m.instruments=['kick','snare','closed-hat'].map((id,i)=>({id,gain:.3,oneShot:true,zones:[{sample:m.samples[i].id,keyLow:0,keyHigh:127,pitched:false}]}));
 const oversized=async url=>{const path=new URL(url).pathname;if(path.endsWith('/fsa-drums/distkit/manifest.json'))return new Response(JSON.stringify(m));if(path.includes('/fsa-drums/distkit/'))return new Response(data.get(path.split('/').at(-1)));return fetcher(url);};
 await assert.rejects(()=>prepareCustomDrumBank('vcsl',{kick:'fsa-distkit',snare:'fsa-distkit',hihat:'fsa-distkit'},192000,{...options,fetcher:oversized}),/memory/);
});
test('every current per-role combination fits final caps over the complete supported rate range',async()=>{
 // Conservative sum of per-role maxima covers all 9^5 resolved selections.
 // Frame counts increase with target rate; ratio extrema occur at endpoints.
 const {drumManifestPath}=await import('../docs/audio-kit/tools/instruments/drum-kits.mjs');
 const baseline=JSON.parse(await readFile(new URL('assets/cc0-mini/manifest.json',root))),banks=new Map([['vcsl',baseline]]);
 for(const kit of CUSTOM_DRUM_KITS)if(kit!=='vcsl')banks.set(kit,JSON.parse(await readFile(new URL(drumManifestPath(kit),root))));
 const maxima=CUSTOM_DRUM_INSTRUMENTS.map(()=>({bytes:0,slots:0}));
 for(const bank of banks.values())for(let i=0;i<5;i++){
  let source=bank,definition=bank.instruments.find(d=>d.id===CUSTOM_DRUM_INSTRUMENTS[i]);if(!definition){source=baseline;definition=baseline.instruments.find(d=>d.id===CUSTOM_DRUM_INSTRUMENTS[i]);}
  const seen=new Set();let bytes=0;
  for(const z of definition.zones){const s=source.samples.find(s=>s.id===z.sample);for(let pitch=z.pitched?z.keyLow:-1;pitch<=(z.pitched?z.keyHigh:-1);pitch++){
   const identity=[s.sha256,s.sampleRate,s.rootNote,pitch].join('|');if(seen.has(identity))continue;seen.add(identity);
   const ratio=pitch<0?1:2**((pitch-s.rootNote)/12);for(const rate of [8000,192000])assert.ok(s.sampleRate/rate*ratio>=.125&&s.sampleRate/rate*ratio<=8);
   bytes+=Math.ceil(s.frames/(s.sampleRate/192000*ratio))*4;
  }}
  maxima[i].bytes=Math.max(maxima[i].bytes,bytes);maxima[i].slots=Math.max(maxima[i].slots,seen.size);
 }
 assert.equal(maxima.reduce((n,m)=>n+m.bytes,0),14367656);assert.equal(maxima.reduce((n,m)=>n+m.slots,0),14);
 assert.ok(maxima.reduce((n,m)=>n+m.bytes,0)<=16*1024*1024);assert.ok(maxima.reduce((n,m)=>n+m.slots,0)<=32);
});

test('lightweight selection module has no audio, fetch or asset imports',async()=>{const source=await readFile(new URL('../docs/custom-drum-selection.js',import.meta.url),'utf8');assert.doesNotMatch(source,/\b(?:import|fetch|prepareDrumBank|loadBrowserBank)\s*[({]/);assert.doesNotMatch(source,/from\s*['"]/);});
