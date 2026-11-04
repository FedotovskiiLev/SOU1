// SPDX-License-Identifier: AGPL-3.0-only
// Node/HTTP/Worklet shims only, not browser or device qualification.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,stat} from 'node:fs/promises';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import {prepareDrumBank,WEB_DRUM_KITS} from '../docs/drum-bank.js';
import {RecordedDrumEngine} from '../docs/recorded-drum-engine.js';
import {AmbientEngine} from '../docs/audio-engine.js';
import {LiveDrumPool} from '../docs/live-drum-pool.js';
import {loadRecordedDrums} from '../docs/drum-loader.js';
const root=new URL('../docs/',import.meta.url);
async function withServer(fn){const server=createServer(async(req,res)=>{try{const p=new URL('.'+req.url,root);if(!p.href.startsWith(root.href))throw Error('path');res.end(await readFile(p));}catch{res.statusCode=404;res.end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));try{return await fn('http://127.0.0.1:'+server.address().port+'/');}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}}
const bank=()=>({sampleRate:48000,samples:[Float32Array.from({length:9600},(_,i)=>.4*Math.sin(i*.2)*Math.exp(-i/2000))],instruments:['kick','snare','closed-hat','toms','short-clash'].map(id=>({id,gain:.4,oneShot:true,chokeGroup:id==='closed-hat'?'hat':null,zones:[{keyLow:0,keyHigh:127,velocityLow:0,velocityHigh:1,sampleIndex:0}]}))});
test('web package has exact source hashes, notices and closed docs module graph',async()=>{
 const lock=JSON.parse(await readFile(new URL('audio-kit/SOURCE_LOCK.json',root)));assert.equal(lock.sampleLicense,'CC0-1.0');assert.ok(lock.files.length>100);assert.ok(lock.files.some(f=>f.path==='LICENSE'));assert.equal(lock.codeLicense,'AGPL-3.0-only');
 for(const f of lock.files){const bytes=await readFile(new URL('audio-kit/'+f.path,root));assert.equal(bytes.length,f.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),f.sha256);assert.deepEqual(bytes,await readFile(new URL('../'+f.path,root)));}assert.ok(lock.files.some(f=>/LICENSE|COPYING|NOTICE/.test(f.path)));
 const seen=new Set();async function visit(url){if(seen.has(url.href))return;seen.add(url.href);assert.ok(url.href.startsWith(root.href));const s=await readFile(url,'utf8');for(const m of s.matchAll(/(?:import|export)\s[^;\n]*?from\s*['"]([^'"]+)['"]/g)){assert.ok(m[1].startsWith('.'));await visit(new URL(m[1],url));}}await visit(new URL('drum-loader-worker.js',root));await visit(new URL('recorded-drum-worklet.js',root));assert.ok(seen.size>9);
});
test('closed registry rejects before fetch; all nine actual banks fit and route every drum key',async()=>withServer(async base=>{
 let calls=0;await assert.rejects(()=>prepareDrumBank('../private',48000,{fetcher:async()=>calls++}));assert.equal(calls,0);
 for(const kit of WEB_DRUM_KITS.filter(k=>k!=='procedural')){const {wireBank,report}=await prepareDrumBank(kit,48000,{assetBaseUrl:new URL('audio-kit/',base)});assert.equal(wireBank.instruments.length,5);assert.ok(wireBank.samples.length<=32);assert.ok(report.preparedBytes<=16*1024*1024);assert.ok(report.preparedPeak<=2);const pool=new LiveDrumPool(48000,wireBank),gains=new Float64Array(5).fill(1);for(const [layer,pitch] of [[5,36],[6,38],[7,42],[8,45],[8,47],[8,49],[9,49]])assert.equal(pool.trigger(layer,pitch,.8,.5),true);let energy=0;for(let n=0;n<48000;n++){pool.next(gains,true);assert.ok(Number.isFinite(pool.outputL));energy+=pool.outputL**2;}assert.ok(energy>0);assert.equal(pool.stats.unmapped,0);}
}));
test('44.1/48 kHz acoustic preparation keeps velocity layers and exact converted-buffer hashes',async()=>withServer(async base=>{
 for(const rate of [44100,48000]){const {wireBank,report}=await prepareDrumBank('guigui-dynamic',rate,{assetBaseUrl:new URL('audio-kit/',base)});const snare=wireBank.instruments.find(i=>i.id==='snare');assert.ok(snare.zones.some(z=>z.velocityHigh<=.6));assert.ok(snare.zones.some(z=>z.velocityLow>.6));for(const c of report.converted)assert.equal(c.pcmSha256,createHash('sha256').update(new Uint8Array(wireBank.samples[c.sampleIndex].buffer)).digest('hex'));}
}));
test('corrupt selected sample fails atomically without procedural fallback',async()=>withServer(async base=>{
 const fetcher=async(url,options)=>{const r=await fetch(url,options);if(new URL(url).pathname.endsWith('/guigui-drums/snare-hard.wav')){const b=new Uint8Array(await r.arrayBuffer());b[b.length-1]^=1;return new Response(b);}return r;};await assert.rejects(()=>prepareDrumBank('guigui-dynamic',48000,{assetBaseUrl:new URL('audio-kit/',base),fetcher}),/checksum/);
}));
test('old melody, shared effects and weather PCM are byte-identical with recorded drums disabled',()=>{
 for(const params of [{drumsEnabled:false},{drumsEnabled:false,wash:.7,warmth:.6,width:1,rain:.3,rainType:2,wind:.4,thunder:.2}]){const a=new AmbientEngine(48000,7311),b=new RecordedDrumEngine(48000,7311,bank());a.setParameters(params);b.setParameters(params);a.start();b.start();const x=Array.from({length:4},()=>new Float32Array(128));for(let i=0;i<450;i++){a.render(x[0],x[1]);b.render(x[2],x[3]);assert.deepEqual(x[0],x[2]);assert.deepEqual(x[1],x[3]);}}
});
test('old generator events preserved; live enable, stop, reseed and limiter remain effective',()=>{
 const a=new AmbientEngine(48000,7311),b=new RecordedDrumEngine(48000,7311,bank()),ea=[],eb=[];
 for(const [engine,events] of [[a,ea],[b,eb]]){const note=engine.noteOn.bind(engine);engine.noteOn=(...e)=>{events.push(e);note(...e);};engine.setParameters({ambient:0,rhythmic:1,bpm:180,drumsEnabled:true,melodyEnabled:false,warmth:1,wash:.5});engine.start();}
 const x=Array.from({length:4},()=>new Float32Array(128));let diff=0;for(let i=0;i<900;i++){a.render(x[0],x[1]);b.render(x[2],x[3]);for(let j=0;j<128;j++){assert.ok(Math.abs(x[2][j])<.85);diff+=Math.abs(x[0][j]-x[2][j]);}}assert.deepEqual(ea,eb);assert.ok(diff>1);assert.ok(b.recordedDrums.stats.accepted>0);assert.equal(b.recordedDrums.stats.unmapped,0);
 b.setParameters({drumsEnabled:false});for(let i=0;i<30;i++)b.render(x[2],x[3]);assert.equal(b.recordedDrums.activeVoices,0);b.setParameters({drumsEnabled:true});b.noteOn(b.frame,5,36,100,.8,.5);assert.ok(b.recordedDrums.activeVoices>0);b.reseed(99);for(let i=0;i<40;i++)b.render(x[2],x[3]);assert.equal(b.seed,99);b.stop();for(let i=0;i<900;i++)b.render(x[2],x[3]);assert.equal(b.isSilent(),true);assert.equal(b.recordedDrums.activeVoices,0);assert.ok(x[2].every(v=>v===0));b.reset();assert.equal(b.frame,0);
});
test('real new Worklet module honors original start/stop/reseed/score protocol under host shim',async()=>{
 const old={AudioWorkletProcessor:globalThis.AudioWorkletProcessor,registerProcessor:globalThis.registerProcessor,sampleRate:globalThis.sampleRate};let Processor;globalThis.sampleRate=48000;globalThis.AudioWorkletProcessor=class{constructor(){this.messages=[];this.port={postMessage:m=>this.messages.push(m)};}};globalThis.registerProcessor=(name,cls)=>{assert.equal(name,'sou1-recorded-drums');Processor=cls;};
 try{await import('../docs/recorded-drum-worklet.js?test');const p=new Processor({processorOptions:{seed:7,wireBank:bank()}}),channels=[new Float32Array(128),new Float32Array(128)];p.port.onmessage({data:{type:'parameters',parameters:{drumsEnabled:true,rhythmic:1,ambient:0,bpm:180}}});p.port.onmessage({data:{type:'start'}});for(let i=0;i<600;i++)p.process([], [channels]);p.port.onmessage({data:{type:'score-export',requestId:42}});assert.equal(p.messages.at(-1).requestId,42);assert.ok(p.messages.at(-1).score.events.some(e=>e[1]>=5));p.port.onmessage({data:{type:'reseed',seed:8}});for(let i=0;i<40;i++)p.process([], [channels]);p.port.onmessage({data:{type:'stop'}});for(let i=0;i<900;i++)p.process([], [channels]);assert.equal(p.messages.at(-1).type,'silent');assert.equal(p.messages.at(-2).score.seed,8);}
 finally{for(const [k,v] of Object.entries(old)){if(v===undefined)delete globalThis[k];else globalThis[k]=v;}}
});
test('async loader cancellation and errors terminate worker; late results cannot revive it',async()=>{
 class W{postMessage(v){this.request=v;}terminate(){this.terminated=true;}}
 const w=new W(),abort=new AbortController(),pending=loadRecordedDrums('guigui-soft',48000,{signal:abort.signal,makeWorker:()=>w});abort.abort();await assert.rejects(()=>pending,/cancelled/);assert.ok(w.terminated);w.onmessage({data:{type:'ready',wireBank:bank()}});const bad=new W(),promise=loadRecordedDrums('vcsl',48000,{makeWorker:()=>bad});bad.onmessage({data:{type:'error',message:'checksum'}});await assert.rejects(()=>promise,/checksum/);assert.ok(bad.terminated);let created=false;await assert.rejects(()=>loadRecordedDrums('vcsl',48000,{signal:AbortSignal.abort(),makeWorker:()=>{created=true;}}));assert.equal(created,false);
});
test('SW pre-cache contains every bundled drum file and refuses incomplete installs',async()=>{
 const handlers=new Map(),requests=[];let rejectAsset=false;const self={addEventListener:(k,fn)=>handlers.set(k,fn)},assets=Object.fromEntries(await Promise.all(['drum-assets.js','melodic-assets-list.js'].map(async name=>[name,await readFile(new URL(name,root),'utf8')])));
 const context={self,location:{origin:'https://local.test'},Request:class{constructor(path){this.path=path;}},caches:{open:async()=>({addAll:async paths=>{requests.push(...paths.map(p=>p.path));if(rejectAsset)throw Error('asset missing');}})},importScripts(...paths){for(const path of paths){const code=assets[path.replace(/^\.\//,'')];assert.equal(typeof code,'string');vm.runInContext(code,context);}}};vm.createContext(context);vm.runInContext(await readFile(new URL('sw.js',root),'utf8'),context);let promise;handlers.get('install')({waitUntil:p=>promise=p});await promise;for(const path of requests)await stat(new URL(path==='./'?'index.html':path.slice(2),root));assert.ok(requests.includes('./recorded-drum-worklet.js'));assert.ok(requests.includes('./instrument-worklet.js'));assert.ok(requests.some(p=>p.includes('/melodic-assets/')&&p.endsWith('.wav')));assert.ok(requests.some(p=>p.endsWith('/snare-hard.wav')));rejectAsset=true;handlers.get('install')({waitUntil:p=>promise=p});await assert.rejects(()=>promise,/asset missing/);
});

test('early stop cannot freeze and resurrect recorded tails after global silence',()=>{
 for(const rate of [8000,44100,48000]){
  const source=bank();source.sampleRate=rate;
  const engine=new RecordedDrumEngine(rate,7311,source);
  engine.setParameters({drumsEnabled:true,melodyEnabled:false,ambient:0,counterpoint:0,rhythmic:0,arpeggio:0});
  const left=new Float32Array(1),right=new Float32Array(1);
  engine.start();engine.render(left,right);assert.ok(engine.recordedDrums.activeVoices>0);
  engine.stop();engine.render(left,right);assert.equal(engine.isSilent(),true);assert.equal(engine.recordedDrums.activeVoices,0);
  const frame=engine.frame;engine.render(new Float32Array(128),new Float32Array(128));assert.equal(engine.frame,frame);
  engine.start();engine.render(left,right);assert.equal(engine.recordedDrums.activeVoices,0);assert.equal(engine.frame,frame+1);
 }
});
