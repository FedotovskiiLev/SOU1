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
 saved={melodicPreset:'procedural',weatherMode:'procedural',...saved};
 const els=new Map(),events=new Map(),instances=[],nodes=[],loads=[],modules=[];let next=0;const timers=new Map();
 function el(id=''){return {id,value:'0',textContent:'',style:{setProperty(){}},dataset:{},classList:{toggle(){}},listeners:{},setAttribute(k,v){this[k]=v},removeAttribute(k){delete this[k]},addEventListener(k,f){this.listeners[k]=f},append(){},focus(){},setPointerCapture(){},getContext(){return{}},set innerHTML(s){for(const m of s.matchAll(/id="([^"]+)"/g))els.set(m[1],el(m[1]));}};}
 for(const m of fs.readFileSync(root+'/docs/index.html','utf8').matchAll(/id="([^"]+)"/g))els.set(m[1],el(m[1]));els.get('rain-type').value='1';
 class AC{constructor(){this.state='running';this.sampleRate=48000;this.currentTime=0;this.destination={};this.resumes=[];this.closeCount=0;this.suspendCount=0;this.audioWorklet={addModule:async u=>{modules.push(u);if(hold==='module'){this.module=deferred();return this.module.promise}}};instances.push(this)}resume(){if(hold==='resume'){const d=deferred();this.resumes.push(d);return d.promise}return Promise.resolve()}suspend(){this.suspendCount++;this.state='suspended';return Promise.resolve()}close(){this.closeCount++;this.state='closed';for(const d of this.resumes)d.reject(new DOMException('closed','InvalidStateError'));return Promise.resolve()}createGain(){return {gain:{value:0,setTargetAtTime(){}},connect:()=>({connect(){}})}}createAnalyser(){return {fftSize:1024,frequencyBinCount:512,connect(){}}}}
 class AW{constructor(c,name,opt){this.context=c;this.name=name;this.options=opt;this.messages=[];this.transfers=[];this.port={postMessage:(m,transfer=[])=>{this.messages.push(m);this.transfers.push(transfer)}};nodes.push(this)}connect(){return {connect:()=>({connect(){}})}}}
 const presetEls=['focus','dusk','drift','bloom','pulse'].map(key=>({...el(),dataset:{preset:key}}));
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
let prior=snapshot(h);for(const p of h.presetEls.filter(p=>p.dataset.preset!=='pulse'))p.listeners.click();h.els.get('new-seed').listeners.click();assert.deepEqual(snapshot(h),prior);const reload=boot({saved});assert.deepEqual(snapshot(reload),prior);console.log('PASS all manual fields/locks/palettes survive presets, New melody and persistence reload');
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
test('fresh and legacy defaults use hybrid melody and recorded drums without enabling drums or erasing explicit choices',()=>{
 const initial=[{}, {parameters:{ambient:.38,rhythmic:.5,arpeggio:.33,evolution:.8},drumOverrides:{snare:'guigui-soft'},drumLocks:{snare:true}}];
 for(const saved of initial){const h=boot({saved:{melodicPreset:undefined,...saved}});assert.equal(h.run('melodicPreset'),'chamber-ambient');assert.equal(h.run('drumKit'),'vcsl');assert.equal(h.run('parameters.drumsEnabled'),false);if(saved.parameters){assert.equal(h.run('parameters.ambient'),.38);assert.equal(h.run('drumOverrides.snare'),'guigui-soft');assert.equal(h.run('drumLocks.snare'),true);}}
 for(const melodicPreset of ['procedural','chamber','piano-room-ambient'])for(const drumKit of ['procedural','vcsl','fsa-distkit']){
  const h=boot({saved:{melodicPreset,drumKit,scoreMode:'developing',scoreConfig:{harmony:'fixed'},parameters:{evolution:.13}}});let saved;h.c.localStorage.setItem=(_,v)=>saved=JSON.parse(v);assert.equal(h.run('parameters.evolution'),.13);h.run('persist()');const reload=boot({saved});assert.equal(reload.run('melodicPreset'),melodicPreset);assert.equal(reload.run('drumKit'),drumKit);assert.equal(reload.run('scoreConfig.harmony'),'fixed');for(const p of reload.presetEls.filter(p=>p.dataset.preset!=='pulse'))p.listeners.click();assert.equal(reload.run('melodicPreset'),melodicPreset);assert.equal(reload.run('drumKit'),drumKit);
 }
});
test('named patterns and Random are discoverable and retain their explicit settings across presets, reseed and reload',async()=>{
 const h=boot({saved:{scoreMode:'original'},hold:'none'});assert.equal(h.els.get('development-controls').hidden,false);assert.equal(h.els.get('config-rhythmFamily').disabled,true);
 h.els.get('score-mode').value='developing';await h.els.get('score-mode').listeners.change();assert.equal(h.els.get('config-rhythmFamily').disabled,false);
 for(const [key,value]of [['rhythmFamily',0],['drumPattern',3],['arpStrategy',2]]){h.els.get('config-'+key).value=String(value);h.els.get('config-'+key).listeners.change();await tick();assert.equal(h.run('scoreConfig.'+key),value);assert.equal(h.run('configLocks.'+key),true);}
 assert.equal(h.run('scoreConfig.drumVariation'),'auto');assert.equal(h.els.get('config-drumVariation-value').textContent,'Held');let saved;h.c.localStorage.setItem=(_,v)=>saved=JSON.parse(v);for(const p of h.presetEls.filter(p=>p.dataset.preset!=='pulse'))p.listeners.click();h.els.get('new-seed').listeners.click();const reload=boot({saved});assert.equal(reload.run('scoreConfig.rhythmFamily'),0);assert.equal(reload.run('scoreConfig.drumPattern'),3);assert.equal(reload.run('scoreConfig.arpStrategy'),2);
 reload.els.get('config-rhythmFamily').value='seed';reload.els.get('config-rhythmFamily').listeners.change();await tick();assert.equal(reload.run('scoreConfig.rhythmFamily'),'seed');assert.equal(reload.run('configLocks.rhythmFamily'),true);
});
test('native capability fallback preserves unsupported choices and keeps old recorded palettes available',()=>{
 const kits=['procedural','vcsl','fsa-electronic','fsa-distkit','fsa-sdbkit','fsa-synthkit','fsa-x0xproc1','fsa-x0xproc2','guigui-soft','guigui-dynamic'];
 const core=['procedural','chamber','piano-room','chamber-flute'];
 const bridge=palettes=>({audioCapabilities:()=>JSON.stringify({schema:'sou1.native-audio.v1',drumKits:kits,scoreModes:['original','developing'],melodicPresets:palettes,customDrums:'custom-v1',scoreConfigSchema:'sou1.development-config.v1'}),status:()=>JSON.stringify({playing:false,preparing:false}),play:()=>true,stop(){}});
 for(const palettes of [core,MELODIC_PRESETS]){
  const h=boot({native:true,bridge:bridge(palettes),saved:{melodicPreset:undefined}});assert.equal(h.run('melodicPreset'),palettes===core?'procedural':'chamber-ambient');assert.equal(h.run('drumKit'),'vcsl');
  const full=boot({native:true,bridge:bridge(palettes),saved:{melodicPreset:'chamber',drumKit:'procedural'}});assert.equal(full.run('melodicPreset'),'chamber');
 }
 const old=boot({native:true,saved:{melodicPreset:'piano-room-ambient',drumKit:'fsa-distkit'}});assert.equal(old.run('melodicPreset'),'procedural');assert.equal(old.run('drumKit'),'procedural');let saved;old.c.localStorage.setItem=(_,v)=>saved=JSON.parse(v);old.run('persist()');assert.equal(saved.melodicPreset,'piano-room-ambient');assert.equal(saved.drumKit,'fsa-distkit');const supported=boot({native:true,bridge:bridge(MELODIC_PRESETS),saved});assert.equal(supported.run('melodicPreset'),'piano-room-ambient');assert.equal(supported.run('drumKit'),'fsa-distkit');
});
test('hybrid UI routes its background and tone flags to the worklet, waits for readiness and survives stop/reload',async()=>{
 const h=boot({saved:{melodicPreset:'piano-room-ambient',drumKit:'procedural'},hold:'none'});h.c.loadRecordedMelodies=async()=>({wireBank:{pcm:new Float32Array(8)}});h.c.melodicTransferList=b=>[b.pcm.buffer];let saved;h.c.localStorage.setItem=(_,v)=>saved=JSON.parse(v);const p=h.run('start()');await tick();const n=h.nodes.at(-1),request=n.messages.find(m=>m.type==='initialize');assert.equal(n.options.processorOptions.synthesizedBed,true);assert.equal(n.options.processorOptions.evolvingTimbre,true);assert.equal(h.run('playing'),false);n.port.onmessage({data:{type:'ready',requestId:request.requestId}});await p;assert.equal(h.run('playing'),true);h.run('stop()');h.run('persist()');assert.equal(h.run('playing'),false);const reload=boot({saved});assert.equal(reload.run('melodicPreset'),'piano-room-ambient');assert.equal(reload.run('playing'),false);
});
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
 assert.deepEqual(nativeSelectionCapabilities({audioCapabilities:()=>JSON.stringify({schema:'sou1.native-audio.v1'})}),{customDrums:false,scoreConfig:false,melodies:false,hybridMelodies:false,pulseMelodies:false,weather:false});
 let status;const s=new NativeDrumSession({play:()=>true,stop(){},status:()=>JSON.stringify(status)},['procedural'],{now:()=>1});
 assert.throws(()=>s.start({drumKit:'procedural',melodicPreset:'chamber'}));assert.throws(()=>s.start({drumKit:'procedural',scoreConfig:{tonic:4}}));
 s.start({drumKit:'procedural'});status={requestId:s.requestId,drumKit:'procedural',preparing:false,playing:true};assert.equal(s.poll().phase,'playing');assert.equal(s.expectedScoreMode,'original');assert.equal(s.expectedMelodic,'procedural');
});

test('Pulse explicitly loads its reproducible recipe while stopped and preserves manual locks',async()=>{
 const h=boot({saved:{scoreMode:'developing',melodicPreset:'chamber',drumKit:'fsa-electronic',scoreConfig:{rhythmFamily:3},configLocks:{rhythmFamily:true},drumOverrides:{snare:'guigui-soft'},drumLocks:{snare:true}},hold:'none'});let saved;h.c.localStorage.setItem=(_,v)=>saved=JSON.parse(v);const pulse=h.presetEls.find(p=>p.dataset.preset==='pulse');pulse.listeners.click();await tick();assert.equal(h.run('preset'),'pulse');assert.equal(h.run('seed'),7311);assert.equal(h.run('scoreMode'),'original');assert.equal(h.run('melodicPreset'),'pulse-marimba');assert.equal(h.run('drumKit'),'vcsl');assert.equal(h.run('parameters.bpm'),112);assert.equal(h.run('parameters.density'),.72);assert.equal(h.run('parameters.toms'),.70);assert.equal(h.run('configLocks.rhythmFamily'),true);assert.equal(h.run('drumLocks.snare'),true);assert.equal(h.run('drumOverrides.snare'),'guigui-soft');const reload=boot({saved});assert.equal(reload.run('preset'),'pulse');assert.equal(reload.run('melodicPreset'),'pulse-marimba');assert.equal(reload.run('seed'),7311);
 h.run("melodicPreset='chamber';state(true)");pulse.listeners.click();await tick();assert.equal(h.run('melodicPreset'),'chamber');
});
test('weather source prepares off-thread for procedural voices, transfers exactly once and survives reload',async()=>{
 const h=boot({saved:{drumKit:'procedural',melodicPreset:'procedural',weatherMode:undefined},hold:'none'});let saved;h.c.localStorage.setItem=(_,v)=>saved=JSON.parse(v);assert.equal(h.run('weatherMode'),'recorded');const weather=deferred();h.c.loadRecordedWeather=(rate,{signal})=>{assert.equal(rate,48000);signal.addEventListener('abort',()=>weather.reject(new DOMException('cancelled','AbortError')));return weather.promise;};const start=h.run('start()');await tick();assert.equal(h.nodes.length,0);weather.resolve({weatherBank:{samples:[new Float32Array(4),new Float32Array(4),new Float32Array(4)]}});await tick();const n=h.nodes[0],init=n.messages.find(m=>m.type==='initialize');assert.equal(n.name,'sou1-instruments');assert.equal(n.options.processorOptions.weatherBank,undefined);assert.equal(n.transfers[0].length,3);assert.equal(init.melodicBank,undefined);assert.ok(init.weatherBank);assert.equal(h.run('playing'),false);n.port.onmessage({data:{type:'ready',requestId:init.requestId}});await start;assert.equal(h.run('playing'),true);assert.equal(h.els.get('weather-source').disabled,true);h.run('state(false)');h.els.get('weather-source').value='procedural';h.els.get('weather-source').listeners.change();await tick();assert.equal(h.run('weatherMode'),'procedural');assert.equal(boot({saved}).run('weatherMode'),'procedural');
});
test('legacy native weather capability preserves unsupported requested recordings and rejects wrong acknowledgement',()=>{
 const h=boot({native:true,saved:{weatherMode:'recorded'}});assert.equal(h.run('weatherMode'),'procedural');let saved;h.c.localStorage.setItem=(_,v)=>saved=JSON.parse(v);h.run('persist()');assert.equal(saved.weatherMode,'recorded');
 const bridge={play:()=>true,stop(){},status:()=>JSON.stringify({})},session=new NativeDrumSession(bridge,['procedural'],{allowWeather:true,now:()=>1000});session.start({drumKit:'procedural',weatherMode:'recorded'});assert.equal(session.validDetails({weatherMode:'invalid'}),false);assert.equal(session.expectedWeather,'recorded');assert.throws(()=>new NativeDrumSession(bridge,['procedural']).start({drumKit:'procedural',weatherMode:'recorded'}),/configuration/);
});
