import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import {fileURLToPath} from 'node:url';import {spawnSync} from 'node:child_process';import os from 'node:os';
import {prepareMelodicBank,MELODIC_PRESETS} from '../docs/melodic-bank.js';import {LiveMelodicPool} from '../docs/live-melodic-pool.js';import {MELODIC_ASSETS} from '../docs/melodic-catalog.js';
const ROOT=fileURLToPath(new URL('../',import.meta.url));
const fetcher=async(url,opts)=>{if(opts.signal?.aborted)throw new DOMException('aborted','AbortError');const b=await fs.readFile(path.join(ROOT,'docs',new URL(url).pathname));return new Response(b,{headers:{'content-length':String(b.length)}});};
const options={fetcher,assetBaseUrl:new URL('https://sou1.invalid/melodic-assets/')};
const selected=new Map();
async function bank(id,rate=48000){const k=id+rate;if(!selected.has(k))selected.set(k,await prepareMelodicBank(id,rate,options));return selected.get(k);}
const ranges=[[45,74],[57,88],[48,88],[62,86],[33,52]];
test('all three actual palettes have checked WAVs, budgets and expected full source ranges',async()=>{
 for(const id of MELODIC_PRESETS.slice(1)){const {wireBank,report}=await bank(id);const p=LiveMelodicPool.fromPrepared(48000,wireBank);assert.ok(report.decodedBytes<=32*1024*1024);assert.ok(p.kernelBytes<=128*129*16*8);for(let layer=0;layer<5;layer++)for(let key=ranges[layer][0];key<=ranges[layer][1];key++)for(const velocity of [0,65/127,66/127,99/127,100/127,1]){p.reset();const ok=p.trigger(layer,key,.1,velocity,.5);if(id==='chamber-flute'&&layer===1&&(key<60||key>78))assert.equal(ok,false);else assert.ok(ok,id+' '+layer+' '+key+' '+velocity);}}
});
test('integrity, traversal/unknown bank, pre-aborted and missing assets fail closed',async()=>{
 await assert.rejects(prepareMelodicBank('../chamber',48000,options));await assert.rejects(prepareMelodicBank('procedural',48000,options));await assert.rejects(prepareMelodicBank('chamber',48000,{...options,signal:AbortSignal.abort()}),{name:'AbortError'});
 let calls=0;const poison=async(u,o)=>{calls++;const r=await fetcher(u,o),b=new Uint8Array(await r.arrayBuffer());b[b.length-2]^=1;return new Response(b);};await assert.rejects(prepareMelodicBank('chamber',48000,{...options,fetcher:poison}),/integrity/);assert.equal(calls,1);
});
test('catalog is deterministic and source assets retain exact licenses/provenance',async()=>{
 for(const id of Object.keys(MELODIC_ASSETS)){const m=JSON.parse(await fs.readFile(path.join(ROOT,'docs/melodic-assets',id+'.json')));for(const s of m.samples){assert.equal(s.license,'CC0-1.0');assert.match(s.sourceCommit,/^[a-f0-9]{40}$/);assert.match(s.sourceGitBlobSha1,/^[a-f0-9]{40}$/);assert.match(s.sourceSha256,/^[a-f0-9]{64}$/);assert.equal(s.transforms.normalization,false);}}
 const before=await fs.readFile(path.join(ROOT,'docs/melodic-catalog.js'));const r=spawnSync('python',['tools/generate-melodic-catalog.py','--check'],{cwd:ROOT,encoding:'utf8'});assert.equal(r.status,0,r.stderr);assert.deepEqual(await fs.readFile(path.join(ROOT,'docs/melodic-catalog.js')),before);
});
test('actual JS/Java PCM parity for three palettes at44.1/48k, loop/mute/stop, native hot-loop allocation',async()=>{
 const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'sou1-melodic-'));const files=['LiveMelodicPool','NativeMelodicBankLoader','NativeMelodicCatalog'].map(n=>path.join(ROOT,'app/src/main/java/org/sou1/audio',n+'.java'));files.push(path.join(ROOT,'tests/MelodicParity.java'));
 const compile=spawnSync('java',['-m','jdk.compiler/com.sun.tools.javac.Main','-source','17','-target','17','-Xlint:all,-options','-Werror','-d',tmp,...files],{encoding:'utf8'});assert.equal(compile.status,0,compile.stderr);const results=[];
 for(const id of MELODIC_PRESETS.slice(1))for(const rate of [44100,48000]){
  const output=path.join(tmp,id+rate+'.bin'),native=spawnSync('java',['-cp',tmp,'org.sou1.audio.MelodicParity',path.join(ROOT,'docs'),id,String(rate),output],{encoding:'utf8',timeout:120000});assert.equal(native.status,0,native.stderr);const info=JSON.parse(native.stdout);const expected=await fs.readFile(output),view=new DataView(expected.buffer,expected.byteOffset,expected.byteLength);const {wireBank}=await bank(id,rate),pool=LiveMelodicPool.fromPrepared(rate,wireBank),gains=new Float64Array([.65,.55,.35,.2,.15]);let max=0,energy=0;const start=performance.now();
  for(let i=0;i<rate*12;i++){
   if(i===0){pool.trigger(0,57,7,.6,.3);pool.trigger(0,62,7,.5,.6);pool.trigger(3,74,10,.35,.7);}
   if(i%(rate/2)===0&&i<rate*9){const n=i/(rate/2);pool.trigger(1,60+n%10,1.3,.3+(n%3)*.25,.2+(n%4)*.2);pool.trigger(2,72+n%8,.8,.55,.7);pool.trigger(4,36+n%12,.4,.6,.5);}
   if(i===rate*5)pool.setMelodyEnabled(false);if(i===rate*6)pool.setMelodyEnabled(true);if(i===rate*11)pool.stop();pool.next(gains,true);
   for(let channel=0;channel<2;channel++){const value=channel===0?pool.outputL:pool.outputR;assert.ok(Number.isFinite(value));max=Math.max(max,Math.abs(value-view.getFloat64((i*2+channel)*8,false)));energy+=value*value;}
  }
  assert.ok(max<1e-8,`${id} ${rate} max absolute JS/Java delta ${max}`);assert.ok(energy>1);assert.equal(pool.activeVoices,0);assert.ok(info.hotLoopAllocatedBytes===0||info.hotLoopAllocatedBytes===-1,'hot allocation '+info.hotLoopAllocatedBytes);results.push({...info,maxAbsolutePcmDelta:max,nodeRenderSeconds:(performance.now()-start)/1000,frames:rate*12});
 }
 await fs.writeFile(path.join(ROOT,'tests/melodic-verification.json'),JSON.stringify({schema:'sou1.melodic-validation.v1',scope:'Node/JVM actual recorded PCM only. NOT browser/AudioWorklet, Android, device or listening approval.',results},null,2)+'\n');
});
