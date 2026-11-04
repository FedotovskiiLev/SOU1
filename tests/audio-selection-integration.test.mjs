// SPDX-License-Identifier: AGPL-3.0-only
// Node VM/DOM/AudioContext doubles only: no browser, autoplay or device claims.
import test from 'node:test';
import {nativeSelectionCapabilities} from '../docs/native-drum-session.js';
import {normalizeDevelopmentConfig,deterministicRandomConfig,DEVELOPMENT_CONFIG_DEFAULTS} from '../docs/development-config.js';
import {CUSTOM_DRUM_ROLES,customDrumSelectionKey,parseCustomDrumSelection,deterministicRandomDrumOverrides} from '../docs/custom-drum-selection.js';
import {MELODIC_PRESETS,DEVELOPMENT_KEYS,normalizedDrumOverrides,normalizedLocks,isSupportedAudioDrumKey} from '../docs/audio-selection.js';
import {NativeDrumSession,nativeDrumCapabilities,nativeDevelopmentCapabilities} from '../docs/native-drum-session.js';
// SPDX-License-Identifier: AGPL-3.0-only
// Deterministic VM/DOM/AudioContext doubles. These exercise control races,
// not real browser rendering, autoplay, AudioWorklet deadlines or device audio.
import {fileURLToPath} from 'node:url';
import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('..',import.meta.url));
const source=fs.readFileSync(root+'/docs/app.js','utf8').replace(/^import .*;\n/gm,'');
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}}
const tick=async()=>{for(let i=0;i<20;i++)await Promise.resolve()};
function boot({saved={drumKit:'vcsl'},hold='load',native=false,bridge=null}={}){
 const els=new Map(),events=new Map(),instances=[],nodes=[],loads=[],modules=[];let next=0;const timers=new Map();
 function el(id=''){return {id,value:'0',textContent:'',style:{setProperty(){}},dataset:{},classList:{toggle(){}},listeners:{},setAttribute(k,v){this[k]=v},removeAttribute(k){delete this[k]},addEventListener(k,f){this.listeners[k]=f},append(){},focus(){},setPointerCapture(){},getContext(){return{}},set innerHTML(s){for(const m of s.matchAll(/id="([^"]+)"/g))els.set(m[1],el(m[1]));}};}
 for(const m of fs.readFileSync(root+'/docs/index.html','utf8').matchAll(/id="([^"]+)"/g))els.set(m[1],el(m[1]));els.get('rain-type').value='1';
 class AC{constructor(){this.state='running';this.sampleRate=48000;this.currentTime=0;this.destination={};this.resumes=[];this.closeCount=0;this.suspendCount=0;this.audioWorklet={addModule:async u=>{modules.push(u);if(hold==='module'){this.module=deferred();return this.module.promise}}};instances.push(this)}resume(){if(hold==='resume'){const d=deferred();this.resumes.push(d);return d.promise}return Promise.resolve()}suspend(){this.suspendCount++;this.state='suspended';return Promise.resolve()}close(){this.closeCount++;this.state='closed';for(const d of this.resumes)d.reject(new DOMException('closed','InvalidStateError'));return Promise.resolve()}createGain(){return {gain:{value:0,setTargetAtTime(){}},connect:()=>({connect(){}})}}createAnalyser(){return {fftSize:1024,frequencyBinCount:512,connect(){}}}}
 class AW{constructor(c,name,opt){this.context=c;this.name=name;this.options=opt;this.messages=[];this.transfers=[];this.port={postMessage:(m,transfer=[])=>{this.messages.push(m);this.transfers.push(transfer)}};nodes.push(this)}connect(){return {connect:()=>({connect(){}})}}}
 const presetEls=['focus','dusk','drift','bloom'].map(key=>({...el(),dataset:{preset:key}}));
 const c={nativeSelectionCapabilities,normalizeDevelopmentConfig,deterministicRandomConfig,DEVELOPMENT_CONFIG_DEFAULTS,CUSTOM_DRUM_ROLES,customDrumSelectionKey,parseCustomDrumSelection,deterministicRandomDrumOverrides,MELODIC_PRESETS,DEVELOPMENT_KEYS,normalizedDrumOverrides,normalizedLocks,isSupportedAudioDrumKey,NativeDrumSession,nativeDrumCapabilities,nativeDevelopmentCapabilities,console:{error(){}},DOMException,AbortController,AudioContext:AC,AudioWorkletNode:AW,loadRecordedDrums:(kit,rate,{signal})=>{const d=deferred();loads.push({kit,rate,d,signal});signal.addEventListener('abort',()=>d.reject(new DOMException('cancelled','AbortError')));return d.promise},drawAsciiGrid(){},createPianoRoll(){return {update(){},refresh(){}}},setInterval(){},document:{getElementById:id=>els.get(id),documentElement:{},querySelectorAll:q=>q==='[data-preset]'?presetEls:[],createElement:()=>el(),body:{classList:{toggle(){}}},addEventListener(){}},window:{addEventListener:(k,v)=>events.set(k,v),...(native?{AndroidBridge:bridge??{status:()=>JSON.stringify({playing:false}),play:()=>true,stop(){},setTimer(){}}}:{})},navigator:{language:'en'},localStorage:{getItem:()=>JSON.stringify(saved),setItem(){}},crypto:{getRandomValues:a=>{a[0]=1;return a}},performance:{now:()=>0},matchMedia:()=>({matches:false}),requestAnimationFrame(){},fetch:()=>Promise.resolve({json:()=>Promise.resolve({apk:null})}),setTimeout:f=>{timers.set(++next,f);return next},clearTimeout:n=>timers.delete(n)};vm.createContext(c);vm.runInContext(source,c);return {c,els,events,instances,nodes,loads,modules,timers,presetEls,run:s=>vm.runInContext(s,c),settle:()=>loads.at(-1).d.resolve({wireBank:{sampleRate:48000},report:{banks:[{id:'fixture'}]}})};
}



test('sampled app preparation ownership, acknowledgement, cancellation and retries',async()=>{
function sampled(){const h=boot({saved:{drumKit:'vcsl',melodicPreset:'chamber'},hold:'none'});h.melodic=[];h.c.loadRecordedMelodies=(preset,rate,{signal})=>{const d=deferred();h.melodic.push({preset,rate,signal,d});signal.addEventListener('abort',()=>d.reject(new DOMException('cancelled','AbortError')));return d.promise};h.c.melodicTransferList=b=>[b.pcm.buffer];h.settle=()=>h.loads.at(-1).d.resolve({wireBank:{samples:[new Float32Array(8)]},report:{banks:[{id:'drums'}]}});h.settleMelodic=()=>h.melodic.at(-1).d.resolve({wireBank:{pcm:new Float32Array(8)}});return h;}
async function init(h){const count=h.melodic.length,p=h.run('start()');await tick();assert.equal(h.melodic.length,count);h.settle();await tick();assert.equal(h.melodic.length,count+1);h.settleMelodic();await tick();const n=h.nodes.at(-1);assert.equal(n.options.processorOptions.melodicBank,undefined);assert.equal(n.options.processorOptions.wireBank,undefined);assert.equal(n.transfers[0].length,2);assert.ok(n.transfers[0].includes(n.messages[0].wireBank.samples[0].buffer));assert.ok(n.transfers[0].includes(n.messages[0].melodicBank.pcm.buffer));return {p,n,request:n.messages.find(m=>m.type==='initialize')};}
{
 const h=sampled(),{p,n,request}=await init(h);assert.equal(h.run('playing'),false);assert.ok(!n.messages.some(m=>m.type==='start'));n.port.onmessage({data:{type:'ready',requestId:request.requestId-1}});await tick();assert.equal(h.run('playing'),false);n.port.onmessage({data:{type:'ready',requestId:request.requestId}});await p;assert.equal(h.run('playing'),true);assert.equal(n.messages.filter(m=>m.type==='start').length,1);console.log('PASS sequential drums/melodies, no banks in options, exact ready only');
}
for(const action of ['cancel','pagehide','reject','timeout']){
 const h=sampled(),{p,n,request}=await init(h);if(action==='cancel')h.run('cancelPreparation()');if(action==='pagehide')h.events.get('pagehide')();if(action==='reject')n.port.onmessage({data:{type:'initialization-error',requestId:request.requestId,message:'fixture fail'}});if(action==='timeout')for(const cb of [...h.timers.values()])cb();await p;n.port.onmessage({data:{type:'ready',requestId:request.requestId}});await tick();assert.equal(h.run('playing'),false);assert.equal(h.run('context'),null);assert.ok(!n.messages.some(m=>m.type==='start'));const next=await init(h);n.port.onmessage({data:{type:'ready',requestId:next.request.requestId}});await tick();assert.equal(h.run('playing'),false);next.n.port.onmessage({data:{type:'ready',requestId:next.request.requestId}});await next.p;assert.equal(h.run('playing'),true);console.log('PASS '+action+' while waiting for ready never starts stale node; retry works');
}
{
 const h=sampled(),{p,n}=await init(h);await n.onprocessorerror();await p;assert.equal(h.run('context'),null);assert.equal(h.run('playing'),false);assert.equal(h.run('busy'),false);console.log('PASS processorerror during initialize returns stopped');
}
for(const repeatedClose of ['resolved','rejected']){
 const h=sampled(),{p,n}=await init(h),old=h.instances.at(-1),close=deferred();let calls=0;
 old.close=()=>{old.state='closed';return ++calls===1?close.promise:repeatedClose==='resolved'?Promise.resolve():Promise.reject(new DOMException('already closed','InvalidStateError'))};
 const errorTask=n.onprocessorerror();await p;assert.equal(h.run('busy'),false);assert.equal(h.run('context'),null);
 const retry=h.run('start()');await tick();assert.equal(h.run('busy'),true);const newContext=h.run('context');close.resolve();await errorTask;
 assert.equal(h.run('context'),newContext);assert.equal(h.run('busy'),true);assert.equal(h.els.get('play').disabled,true);assert.equal(h.loads.at(-1).signal.aborted,false);
 h.run('cancelPreparation()');await retry;assert.equal(h.loads.at(-1).signal.aborted,true);assert.equal(h.run('playing'),false);assert.equal(h.run('context'),null);console.log('PASS late old processor cleanup preserves new attempt ownership and cancellation');
}

});
test('manual UI state, locks, presets, seeds, persistence and stopped-only selection',async()=>{
const raw= v=>JSON.parse(JSON.stringify(v));
const snapshot=h=>raw(h.run('({scoreMode,scoreConfig,configLocks,drumKit,drumOverrides,drumLocks,melodicPreset,configRandomSeed,drumRandomSeed})'));
const h=boot({saved:{scoreMode:'developing',drumKit:'vcsl'},hold:'none'});let saved;h.c.localStorage.setItem=(_,v)=>saved=JSON.parse(v);
for(const [key,value]of Object.entries({tonic:7,mode:4,meter:3,rhythmFamily:6,arpStrategy:2,drumPattern:7,harmony:'fixed'})){h.els.get('config-'+key).value=String(value);h.els.get('config-'+key).listeners.change();await tick();assert.equal(h.run('scoreConfig.'+key),value);assert.equal(h.run('configLocks.'+key),true);}
h.els.get('config-drumVariation-auto').checked=false;h.els.get('config-drumVariation-auto').listeners.change();await tick();h.els.get('config-drumVariation').value='23';h.els.get('config-drumVariation').listeners.change();await tick();assert.equal(h.run('scoreConfig.drumVariation'),.23);
h.els.get('drum-role-kick').value='vcsl';h.els.get('drum-role-kick').listeners.change();await tick();h.els.get('drum-role-snare').value='guigui-dynamic';h.els.get('drum-role-snare').listeners.change();await tick();h.els.get('melodic-preset').value='chamber-flute';h.els.get('melodic-preset').listeners.change();await tick();
let prior=snapshot(h);for(const p of h.presetEls)p.listeners.click();h.els.get('new-seed').listeners.click();assert.deepEqual(snapshot(h),prior);const reload=boot({saved});assert.deepEqual(snapshot(reload),prior);console.log('PASS all manual fields/locks/palettes survive presets, New melody and persistence reload');
h.els.get('random-composition').listeners.click();await tick();assert.deepEqual(raw(h.run('scoreConfig')),prior.scoreConfig);h.els.get('random-drums').listeners.click();await tick();assert.equal(h.run('drumOverrides.kick'),'vcsl');assert.equal(h.run('drumOverrides.snare'),'guigui-dynamic');console.log('PASS randomization preserves manually locked values, including explicit base-kit role');
// Allow one config field and one kit role to randomize.
h.els.get('lock-tonic').checked=false;h.els.get('lock-tonic').listeners.change();h.els.get('drum-lock-snare').checked=false;h.els.get('drum-lock-snare').listeners.change();h.els.get('random-composition').listeners.click();await tick();h.els.get('random-drums').listeners.click();await tick();assert.equal(h.run('configRandomSeed'),1);assert.equal(h.run('drumRandomSeed'),1);assert.equal(h.run('scoreConfig.mode'),4);assert.equal(h.run('drumOverrides.kick'),'vcsl');assert.ok(Number.isInteger(h.run('scoreConfig.tonic')));console.log('PASS unlocked draws and saved combination seeds');
// Event callbacks defensively reject edits while playing, even synthetic change events.
prior=snapshot(h);h.run('state(true)');h.els.get('config-tonic').value='3';h.els.get('config-tonic').listeners.change();h.els.get('melodic-preset').value='piano-room';h.els.get('melodic-preset').listeners.change();h.els.get('drum-role-kick').value='fsa-electronic';h.els.get('drum-role-kick').listeners.change();await tick();assert.deepEqual(snapshot(h),prior);h.run("setValue('brightness',.81)");assert.equal(h.run('parameters.brightness'),.81);assert.ok(h.els.get('config-tonic').disabled);console.log('PASS stopped-only selection guard and existing live knob');

});

function nativeFixture() {
 let now=1000,status,stops=0;
 const bridge={play:()=>true,stop:()=>stops++,status:()=>JSON.stringify(status)};
 const session=new NativeDrumSession(bridge,['procedural','vcsl'],{now:()=>now,timeoutMs:100,allowConfig:true,allowMelodic:true,allowCustom:true});
 const config={tonic:5,mode:2,meter:4,harmony:'fixed'};
 session.start({drumKit:'vcsl',scoreMode:'developing',melodicPreset:'chamber',scoreConfig:config});
 status={requestId:session.requestId,drumKit:'vcsl',scoreMode:'developing',preparing:false,playing:true,melodicPreset:'chamber',scoreConfig:config};
 return {bridge,session,get status(){return status;},set status(value){status=value;},get stops(){return stops;},time:value=>now=value};
}
for(const patch of [{melodicPreset:'corrupt-bank'},{scoreConfig:{tonic:12}},{drumKit:'bad-kit'},{scoreMode:'unknown'},{preparing:true},{playing:'true'}]) {
 test('matching malformed native status cannot retain a playing selection: '+JSON.stringify(patch),()=>{
  const h=nativeFixture();assert.equal(h.session.poll().phase,'playing');h.status={...h.status,...patch};h.time(100000);
  assert.equal(h.session.poll().phase,'error');assert.equal(h.stops,1);assert.equal(h.session.requestId,null);assert.match(h.session.error,/Invalid native audio acknowledgement/);
  h.session.poll();assert.equal(h.stops,1);
 });
}
test('matching valid but different config or palette cancels; unrelated malformed status stays stale',()=>{
 for(const patch of [{scoreConfig:{tonic:6}},{melodicPreset:'piano-room'},{drumKit:'procedural'}]){
  const h=nativeFixture();h.session.poll();h.status={...h.status,...patch};assert.equal(h.session.poll().phase,'error');assert.equal(h.stops,1);assert.match(h.session.error,/selection mismatch/);
 }
 const h=nativeFixture();h.session.poll();const accepted=h.session.data;h.status={...h.status,requestId:h.session.requestId-1,scoreConfig:{tonic:99}};assert.equal(h.session.poll().phase,'playing');assert.equal(h.session.data,accepted);assert.equal(h.stops,0);
});
test('invalid native details with failing stop retain ownership until a valid idle acknowledgement',()=>{
 const h=nativeFixture();h.session.poll();const id=h.session.requestId;h.bridge.stop=()=>{throw Error('service unavailable')};h.status={...h.status,melodicPreset:'corrupt-bank'};
 assert.equal(h.session.poll().phase,'error');assert.equal(h.session.stopFailed,true);assert.equal(h.session.requestId,id);assert.equal(h.session.uncertainPhase,'playing');
 h.status={...h.status,melodicPreset:'chamber',playing:false};assert.equal(h.session.poll().phase,'idle');assert.equal(h.session.requestId,null);
});
test('legacy capabilities and absent details default honestly without accepting nondefault selections',()=>{
 assert.deepEqual(nativeSelectionCapabilities({audioCapabilities:()=>JSON.stringify({schema:'sou1.native-audio.v1'})}),{customDrums:false,scoreConfig:false,melodies:false});
 let status;const s=new NativeDrumSession({play:()=>true,stop(){},status:()=>JSON.stringify(status)},['procedural'],{now:()=>1});
 assert.throws(()=>s.start({drumKit:'procedural',melodicPreset:'chamber'}));assert.throws(()=>s.start({drumKit:'procedural',scoreConfig:{tonic:4}}));
 s.start({drumKit:'procedural'});status={requestId:s.requestId,drumKit:'procedural',preparing:false,playing:true};assert.equal(s.poll().phase,'playing');assert.equal(s.expectedScoreMode,'original');assert.equal(s.expectedMelodic,'procedural');
});
