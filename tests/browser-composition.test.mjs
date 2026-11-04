// SPDX-License-Identifier: AGPL-3.0-only
// Real loopback HTTP and Node execution of browser modules, NOT browser playback.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,stat} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve,sep,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {prepareBrowserRender,loadBrowserScoreBank,validateBrowserRequest,BROWSER_KITS} from '../experiments/rack-browser/prepare.mjs';
import {loadBrowserBank} from '../experiments/rack-browser/bank.mjs';
import {PlaybackController} from '../experiments/rack-browser/controller.mjs';
import {renderExpressiveCue} from '../tools/render-variety-cue.mjs';
import {renderScoreCue,loadScoreBank} from '../tools/render-score-cue.mjs';
import {loadOriginalScore} from '../tools/instruments/event-score.mjs';
import {composeExpressivePlan,PHRASINGS} from '../tools/composition/expressive-score.mjs';
import {exportScoreMidi} from '../tools/composition/score-midi.mjs';
import {VARIETY_STYLES} from '../tools/composition/variety-score.mjs';
const root=resolve(fileURLToPath(new URL('../',import.meta.url)));
async function httpTask(fn){
  const server=createServer(async(req,res)=>{try{const path=resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));if(path!==root&&!path.startsWith(root+sep))throw Error('path');const s=await stat(path);if(!s.isFile())throw Error('file');const bytes=await readFile(path);res.setHeader('Content-Type',({'.mjs':'text/javascript','.js':'text/javascript','.html':'text/html','.css':'text/css','.json':'application/json','.wav':'audio/wav'})[extname(path)]||'application/octet-stream');res.setHeader('Content-Length',bytes.length);res.end(bytes);}catch{res.statusCode=404;res.end('Not found');}});
  await new Promise((r,j)=>{server.once('error',j);server.listen(0,'127.0.0.1',r);});
  const url=`http://127.0.0.1:${server.address().port}/`;
  try{return await fn(url);}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
}
function comparePcm(browser,node){assert.equal(browser.left.length,(node.wav.length-44)/6);let maxError=0;for(let i=0;i<browser.left.length;i++)for(let ch=0;ch<2;ch++){const x=node.wav.readIntLE(44+i*6+ch*3,3)/8388607,actual=ch?browser.right[i]:browser.left[i];maxError=Math.max(maxError,Math.abs(x-actual));}assert.ok(maxError<1.3e-7,'PCM24/Float32 error '+maxError);assert.equal(browser.report.rack.accepted,node.report.rack.accepted);assert.equal(browser.report.rack.dropped,0);assert.equal(browser.report.rack.unmapped,0);assert.equal(browser.report.rack.activeVoices,0);}

test('invalid browser requests fail before any source or bank loading',async()=>{
  for(const input of [null,[],{composer:'other'},{drumKit:'../bank'},{drumKit:'https://example.org/a'},{duration:31},{composer:'expressive',score:{style:'song',bars:16,bpm:40}},{composer:'expressive',drumVelocityScale:3},{composer:'expressive',unknown:true}]){let fetched=false;await assert.rejects(()=>prepareBrowserRender(input,{fetcher:async()=>{fetched=true;throw Error('fetch');},scoreLoader:async()=>{fetched=true;throw Error('source');}}));assert.equal(fetched,false);}
  assert.equal(validateBrowserRequest({duration:4}).composer,'legacy');assert.equal(validateBrowserRequest({composer:'expressive',score:{bars:2,sampleRate:44100}}).options.score.sampleRate,44100);
});

test('every closed browser bank matches Node registry and exact instrument provenance',async()=>httpTask(async base=>{
  assert.equal(BROWSER_KITS.length,9);
  for(const drumKit of BROWSER_KITS){const a=await loadBrowserScoreBank(drumKit,{assetBaseUrl:base}),b=await loadScoreBank(drumKit);assert.deepEqual([...a.instruments.keys()],[...b.instruments.keys()]);assert.deepEqual(a.instrumentBanks,b.instrumentBanks);assert.ok(a.instruments.size<=28);assert.ok(a.decodedBytes<=16*1024*1024);assert.ok(a.mappedBytes<=16*1024*1024);assert.ok(a.encodedBytes<=12*1024*1024);for(const bank of a.banks)assert.match(bank.sha256,/^[a-f0-9]{64}$/);}
}));

test('six browser composition forms match canonical Node PCM and complete MIDI',async()=>httpTask(async base=>{
  for(const [index,style] of Object.keys(VARIETY_STYLES).entries()){
    const recipe={score:{style,bars:2,bpm:180,drums:true,seed:901},phrasing:PHRASINGS[index%5],drumVelocityScale:1.6,drumKit:['fsa-distkit','fsa-sdbkit','fsa-synthkit','fsa-x0xproc1','fsa-x0xproc2','guigui-dynamic'][index]};
    const a=await prepareBrowserRender({composer:'expressive',...recipe},{assetBaseUrl:base}),b=await renderExpressiveCue(recipe);comparePcm(a,b);assert.deepEqual(a.report.sourceEvents,b.report.sourceEvents);assert.deepEqual(a.report.instrumentBanks,b.report.instrumentBanks);const {drumKit,...pure}=recipe;assert.deepEqual(a.midiBytes,exportScoreMidi(composeExpressivePlan(pure)).bytes);assert.equal(a.report.midi.sourceNotes,a.report.sourceEvents.length);
  }
}));

test('five phrasings at 44.1 and 48 kHz retain canonical score, MIDI and sample timing',async()=>httpTask(async base=>{
  for(const phrasing of PHRASINGS)for(const sampleRate of [44100,48000]){
    const recipe={score:{style:'motor',bars:2,bpm:180,drums:true,sampleRate},phrasing,drumVelocityScale:1.6,drumKit:sampleRate===44100?'guigui-soft':'fsa-electronic'};
    const a=await prepareBrowserRender({composer:'expressive',...recipe},{assetBaseUrl:base}),b=await renderExpressiveCue(recipe);comparePcm(a,b);const {drumKit,...pure}=recipe;assert.deepEqual(a.midiBytes,exportScoreMidi(composeExpressivePlan(pure)).bytes);
  }
}));

test('legacy plain-options path remains compatible and emits no misleading full-score MIDI',async()=>httpTask(async base=>{
  for(const drumKit of ['vcsl','guigui-dynamic']){const options={profile:'pulse',duration:4,sampleRate:44100,outputGainDb:4};const a=await prepareBrowserRender({...options,drumKit},{assetBaseUrl:base,scoreLoader:loadOriginalScore}),b=await renderScoreCue({...options,drumKit});comparePcm(a,b);assert.equal(a.midiBytes,undefined);assert.equal(a.report.midi,undefined);assert.equal(a.report.composer,'legacy');}
}));

test('encoded and decoded declared budgets reject before the first sample fetch',async()=>{
  const actual=JSON.parse(await readFile(new URL('../assets/cc0-mini/manifest.json',import.meta.url)));
  for(const options of [{maxEncodedBytes:10},{maxDecodedBytes:10}]){let count=0;await assert.rejects(()=>loadBrowserBank(new URL('http://localhost/bank.json'),{...options,fetcher:async()=>{count++;return new Response(JSON.stringify(actual));}}),/budget/);assert.equal(count,1);}
  const large=structuredClone(actual);large.samples=Array.from({length:5},(_,i)=>({...actual.samples[0],id:'padded-'+i,bytes:4*1024*1024,frames:2,decodedBytes:8}));let count=0;await assert.rejects(()=>loadBrowserBank(new URL('http://localhost/large.json'),{maxEncodedBytes:12*1024*1024,fetcher:async()=>{count++;return new Response(JSON.stringify(large));}}),/budget/);assert.equal(count,1);
});

test('a corrupted selected acoustic sample aborts the whole prepare without partial PCM',async()=>httpTask(async base=>{
  const fetcher=async(url,options)=>{const r=await fetch(url,options);if(new URL(url).pathname.endsWith('/guigui-drums/snare-hard.wav')){const data=new Uint8Array(await r.arrayBuffer());data[data.length-2]^=1;return new Response(data,{status:200});}return r;};
  await assert.rejects(()=>prepareBrowserRender({composer:'expressive',score:{bars:2,bpm:180},drumKit:'guigui-dynamic'},{assetBaseUrl:base,fetcher}),/checksum/);
}));

class WorkerFake{postMessage(value){this.input=value;}terminate(){this.terminated=true;}send(data){this.onmessage?.({data});}}
function midiFixture(){return exportScoreMidi(composeExpressivePlan({score:{bars:2,bpm:180}})).bytes;}
function ready(midiBytes=midiFixture()){return {type:'ready',left:new Float32Array(4800),right:new Float32Array(4800),sampleRate:48000,midiBytes,report:{midi:{sourceNotes:1}}};}
function controllerFixture(){const workers=[];return {workers,c:new PlaybackController({makeWorker:()=>{const w=new WorkerFake();workers.push(w);return w;},makeContext:()=>{throw Error('Prepare must not create audio');}})};}
test('controller owns MIDI bytes and clears stale/cancelled prepared scores',()=>{
  const {c,workers}=controllerFixture();c.prepare({});const data=ready(),expected=data.midiBytes.slice();workers[0].send(data);assert.equal(c.state,'ready');data.midiBytes[0]=0;assert.deepEqual(c.pcm.midiBytes,expected);c.prepare({seed:2});assert.equal(c.pcm,null);workers[0].send(ready());assert.equal(c.pcm,null);c.cancel();workers[1].send(ready());assert.equal(c.state,'idle');assert.equal(c.pcm,null);
});
test('malformed MIDI chunks from a worker fail without retaining PCM',()=>{
  for(const mutate of [()=>new Uint8Array(14).fill(0),bytes=>bytes.subarray(0,20),bytes=>{bytes[11]=0;return bytes;},bytes=>{bytes[bytes.length-2]=0;return bytes;},bytes=>new Uint8Array([...bytes,0])]){const {c,workers}=controllerFixture();c.prepare({});workers[0].send(ready(mutate(midiFixture().slice())));assert.equal(c.state,'error');assert.equal(c.pcm,null);}
});

test('browser entry graph remains dependency-light with no Node-only imports',async()=>{
  const visited=new Set();async function visit(url){if(visited.has(url.href))return;visited.add(url.href);const source=await readFile(url,'utf8');for(const m of source.matchAll(/(?:import|export)\s[^;\n]*?from\s*['"]([^'"]+)['"]/g)){assert.ok(m[1].startsWith('.'),'non-relative import '+m[1]);await visit(new URL(m[1],url));}}
  await visit(new URL('../experiments/rack-browser/worker.mjs',import.meta.url));assert.ok(visited.size>=10);
});

test('app wires expressive controls and downloads only the prepared full MIDI after a click',async()=>{
  const original={document:globalThis.document,window:globalThis.window,Worker:globalThis.Worker,AudioContext:globalThis.AudioContext,setTimeout:globalThis.setTimeout},createUrl=URL.createObjectURL,revokeUrl=URL.revokeObjectURL;
  const elements=new Map(),workers=[],downloads=[],blobs=[],windowEvents=new Map(),docEvents=new Map();
  const values={composer:'expressive',style:'waltz',phrasing:'lyrical',bars:'4',bpm:'112','drum-velocity':'1.6','drum-kit':'guigui-dynamic',seed:'901','render-gain':'4',volume:'35',profile:'pulse',duration:'12'};
  function element(id){if(!elements.has(id))elements.set(id,{value:values[id]??'',checked:id==='drums-enabled',events:new Map(),addEventListener(name,fn){this.events.set(name,fn);},reportValidity(){return true;}});return elements.get(id);}
  globalThis.document={hidden:false,getElementById:element,addEventListener:(k,fn)=>docEvents.set(k,fn),body:{append(){}},createElement:()=>({click(){downloads.push({filename:this.download,url:this.href});},remove(){}})};
  globalThis.window={isSecureContext:true,addEventListener:(k,fn)=>windowEvents.set(k,fn)};
  globalThis.Worker=class extends WorkerFake{constructor(){super();workers.push(this);}};globalThis.AudioContext=class{constructor(){throw Error('No autoplay');}};
  globalThis.setTimeout=fn=>{fn();return 0;};URL.createObjectURL=blob=>{blobs.push(blob);return 'blob:local-test';};URL.revokeObjectURL=()=>{};
  try{
    await import('../experiments/rack-browser/app.mjs?expressive-control-test');
    assert.equal(element('legacy-controls').hidden,true);assert.equal(element('duration').disabled,true);assert.equal(element('style').disabled,false);assert.equal(element('midi').disabled,true);
    const submit=()=>element('settings').events.get('submit')({preventDefault(){},target:element('settings')});submit();
    assert.equal(workers[0].input.options.composer,'expressive');assert.equal(workers[0].input.options.drumVelocityScale,1.6);assert.equal(workers[0].input.options.score.style,'waltz');assert.equal(workers[0].input.options.drumKit,'guigui-dynamic');
    const payload=ready();payload.report={options:{style:'waltz',seed:901},midi:{sourceNotes:20}};workers[0].send(payload);assert.equal(downloads.length,0);assert.equal(element('midi').disabled,false);
    element('midi').events.get('click')();assert.equal(downloads.length,1);assert.equal(downloads[0].filename,'sou1-waltz-901.mid');assert.equal(blobs[0].type,'audio/midi');assert.deepEqual(new Uint8Array(await blobs[0].arrayBuffer()),payload.midiBytes);
    element('composer').value='legacy';element('composer').events.get('change')();assert.equal(element('expressive-controls').hidden,true);assert.equal(element('duration').disabled,false);submit();assert.equal(workers[1].input.options.composer,'legacy');assert.equal(workers[1].input.options.profile,'pulse');assert.equal(element('midi').disabled,true);
    windowEvents.get('pagehide')();
  }finally{URL.createObjectURL=createUrl;URL.revokeObjectURL=revokeUrl;for(const [k,v] of Object.entries(original)){if(v===undefined)delete globalThis[k];else globalThis[k]=v;}}
});
