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
 class AW{constructor(c,name,opt){this.context=c;this.name=name;this.options=opt;this.messages=[];this.port={postMessage:m=>this.messages.push(m)};nodes.push(this)}connect(){return {connect:()=>({connect(){}})}}}
 const c={nativeSelectionCapabilities,normalizeDevelopmentConfig,deterministicRandomConfig,DEVELOPMENT_CONFIG_DEFAULTS,CUSTOM_DRUM_ROLES,customDrumSelectionKey,parseCustomDrumSelection,deterministicRandomDrumOverrides,MELODIC_PRESETS,DEVELOPMENT_KEYS,normalizedDrumOverrides,normalizedLocks,isSupportedAudioDrumKey,NativeDrumSession,nativeDrumCapabilities,nativeDevelopmentCapabilities,console:{error(){}},DOMException,AbortController,AudioContext:AC,AudioWorkletNode:AW,loadRecordedDrums:(kit,rate,{signal})=>{const d=deferred();loads.push({kit,rate,d,signal});signal.addEventListener('abort',()=>d.reject(new DOMException('cancelled','AbortError')));return d.promise},drawAsciiGrid(){},createPianoRoll(){return {update(){},refresh(){}}},setInterval(){},document:{getElementById:id=>els.get(id),documentElement:{},querySelectorAll:()=>[],createElement:()=>el(),body:{classList:{toggle(){}}},addEventListener(){}},window:{addEventListener:(k,v)=>events.set(k,v),...(native?{AndroidBridge:bridge??{status:()=>JSON.stringify({playing:false}),play:()=>true,stop(){},setTimer(){}}}:{})},navigator:{language:'en'},localStorage:{getItem:()=>JSON.stringify(saved),setItem(){}},crypto:{getRandomValues:a=>{a[0]=1;return a}},performance:{now:()=>0},matchMedia:()=>({matches:false}),requestAnimationFrame(){},fetch:()=>Promise.resolve({json:()=>Promise.resolve({apk:null})}),setTimeout:f=>{timers.set(++next,f);return next},clearTimeout:n=>timers.delete(n)};vm.createContext(c);vm.runInContext(source,c);return {c,els,events,instances,nodes,loads,modules,run:s=>vm.runInContext(s,c),settle:()=>loads.at(-1).d.resolve({wireBank:{sampleRate:48000},report:{banks:[{id:'fixture'}]}})};
}
for(const mode of ['load','module','resume']){
 const h=boot({hold:mode}),p=h.run('start()');await tick();if(mode==='module'){h.settle();await tick()}h.events.get('pagehide')();if(mode==='module')h.instances[0].module.resolve();await p;assert.equal(h.run('playing'),false);assert.equal(h.run('context'),null);assert.equal(h.els.get('play').disabled,false);assert.equal(h.nodes.length,0);console.log('PASS pagehide before '+mode+' completion stays stopped and clears graph');
}
{
 const h=boot(),p=h.run('start()');await tick();h.run('cancelPreparation()');h.settle();await p;assert.equal(h.run('playing'),false);const p2=h.run('start()');await tick();h.settle();await p2;assert.equal(h.run('playing'),true);assert.equal(h.nodes.length,1);assert.equal(h.instances[0].state,'closed');assert.equal(h.loads.length,2);console.log('PASS cancel, late ready, retry creates exactly one live graph');
 h.run('stop()');const original=h.nodes[0];const p3=h.run('start()');original.port.onmessage({data:{type:'silent'}});await p3;assert.equal(h.run('playing'),true);assert.equal(h.nodes.length,1);assert.equal(h.instances[1].suspendCount,0);console.log('PASS quick stopped-to-start reuse ignores queued silent event');
 h.run('stop()');h.els.get('drum-samples').value='guigui-dynamic';await h.els.get('drum-samples').listeners.change();assert.equal(h.run('node'),null);const p4=h.run('start()');await tick();h.settle();await p4;assert.equal(h.nodes.length,2);assert.equal(h.loads.at(-1).kit,'guigui-dynamic');assert.equal(h.instances[1].state,'closed');console.log('PASS stopped kit change disposes graph and reloads correct bank');
}
{
 const h=boot({native:true});assert.equal(h.run('drumKit'),'procedural');assert.equal(h.els.get('recorded-drums-controls').hidden,true);await h.run('start()');assert.equal(h.run('playing'),true);assert.equal(h.loads.length,0);assert.equal(h.instances.length,0);console.log('PASS native ignores saved recorded bank without worker/context');
}
{
 const h=boot({hold:'module'});const p=h.run('start()');await tick();h.settle();await tick();const first=h.instances[0];h.run('cancelPreparation()');await p;
 assert.equal(h.run('busy'),false);assert.equal(h.els.get('play').disabled,false);assert.equal(h.run('context'),null);assert.equal(h.run('rejectPreparation'),null);
 const p2=h.run('start()');await tick();h.settle();await tick();first.module.resolve();await tick();assert.equal(h.run('busy'),true);assert.equal(h.run('context'),h.instances[1]);assert.notEqual(h.run('rejectPreparation'),null);h.instances[1].module.resolve();await p2;
 assert.equal(h.run('playing'),true);assert.equal(h.nodes.length,1);assert.equal(h.nodes[0].context,h.instances[1]);console.log('PASS cancel hung addModule unlocks UI immediately; late old result cannot affect restarted attempt');
}
{
 const h=boot();let savedSnapshot;
 h.c.encodeMidi=s=>{savedSnapshot=s;return {bytes:new Uint8Array([1,2]),filename:'test.mid'}};h.c.URL={createObjectURL:()=> 'blob:fixture',revokeObjectURL(){}};h.c.Blob=Blob;h.c.document.body.append=()=>{};
 const oldCreate=h.c.document.createElement;h.c.document.createElement=(...args)=>({...oldCreate(...args),click(){},remove(){}});
 const p=h.run('start()');await tick();h.settle();await p;h.run('stop();showScore({seed,frame:48000,rate:48000,events:[[0,5,36,2400,.8,.5]]})');const old=h.nodes[0];const exp=h.els.get('midi-export').listeners.click();await tick();
 assert.equal(h.run('exportBusy'),true);assert.equal(h.els.get('drum-samples').disabled,true);h.els.get('drum-samples').value='fsa-electronic';await h.els.get('drum-samples').listeners.change();
 assert.equal(h.run('drumKit'),'vcsl');assert.equal(h.els.get('drum-samples').value,'vcsl');assert.equal(h.run('node'),old);assert.equal(h.instances[0].state,'running');
 const request=old.messages.findLast(m=>m.type==='score-export');old.port.onmessage({data:{type:'score-export',requestId:request.requestId,score:{seed:1,frame:48000,rate:48000,events:[[0,5,36,2400,.8,.5]]}}});await exp;
 assert.equal(savedSnapshot.events.length,1);assert.equal(h.run('exportBusy'),false);assert.equal(h.run('exportRequest'),null);assert.equal(h.els.get('drum-samples').disabled,false);
 h.els.get('drum-samples').value='fsa-electronic';await h.els.get('drum-samples').listeners.change();assert.equal(h.run('drumKit'),'fsa-electronic');assert.equal(h.run('node'),null);console.log('PASS kit switch blocked during MIDI snapshot; export saves and switch unlocks afterward');
}

{
 const kits=['procedural','vcsl','fsa-electronic','fsa-distkit','fsa-sdbkit','fsa-synthkit','fsa-x0xproc1','fsa-x0xproc2','guigui-soft','guigui-dynamic'];
 let status={requestId:0,preparing:false,playing:false,drumKit:'procedural'},stops=0;const requests=[],updates=[],timerCalls=[];
 const bridge={audioCapabilities:()=>JSON.stringify({schema:'sou1.native-audio.v1',drumKits:kits}),status:()=>JSON.stringify(status),play:s=>{requests.push(JSON.parse(s));return true;},stop:()=>stops++,update:s=>updates.push(JSON.parse(s)),setTimer:m=>timerCalls.push(m)};
 const h=boot({native:true,bridge,saved:{drumKit:'guigui-dynamic'}});
 assert.equal(h.run('drumKit'),'guigui-dynamic');assert.equal(h.els.get('recorded-drums-controls').hidden,false);
 h.els.get('timer').value='25';await h.run('start()');assert.equal(requests[0].timerMinutes,25);assert.equal(h.run('nativePreparing'),true);assert.equal(h.run('playing'),false);assert.equal(h.instances.length,0);assert.equal(h.loads.length,0);assert.equal(requests[0].drumKit,'guigui-dynamic');assert.equal(h.els.get('play').disabled,true);assert.equal(h.els.get('cancel-prepare').disabled,false);
 await h.run('start()');assert.equal(requests.length,1);h.run("setValue('kick',.7)");assert.equal(updates.at(-1).kick,.7);
 h.els.get('drum-samples').value='vcsl';await h.els.get('drum-samples').listeners.change();assert.equal(h.els.get('drum-samples').value,'guigui-dynamic');
 h.run('applyNativeSession()');assert.equal(h.run('nativePreparing'),true);
 h.run('cancelPreparation()');assert.equal(stops,1);assert.equal(h.run('nativePreparing'),false);assert.equal(h.els.get('play').disabled,false);
 status={requestId:requests[0].requestId,drumKit:'guigui-dynamic',preparing:false,playing:true};h.run('restoreNative()');assert.equal(h.run('playing'),false);
 await h.run('start()');assert.ok(requests[1].requestId>requests[0].requestId);h.run('applyNativeSession()');assert.equal(h.run('playing'),false);
 status={requestId:requests[1].requestId,drumKit:'guigui-dynamic',preparing:true,playing:false};h.run('applyNativeSession()');assert.equal(h.run('playing'),false);
 status={...status,preparing:false,playing:true};h.run('applyNativeSession()');assert.equal(h.run('nativePreparing'),false);assert.equal(h.run('playing'),true);assert.equal(timerCalls.length,0);assert.equal(h.els.get('cancel-prepare').disabled,true);
 h.run('applyNativeSession()');assert.equal(timerCalls.length,0);const originalStop=bridge.stop;bridge.stop=()=>{throw Error('service unavailable')};h.run('stop()');assert.equal(h.run('playing'),true);assert.match(h.els.get('notice').textContent,/stop request failed/);h.run('restoreNative()');assert.equal(h.run('playing'),true);bridge.stop=originalStop;h.run('stop()');assert.equal(stops,2);assert.equal(h.run('playing'),false);
 console.log('PASS native recorded bank acknowledgement, control updates, cancel, stale ready, retry and timer activation without Web Audio');
}

{
 const kits=['procedural','vcsl','fsa-electronic','fsa-distkit','fsa-sdbkit','fsa-synthkit','fsa-x0xproc1','fsa-x0xproc2','guigui-soft','guigui-dynamic'];
 let status={requestId:42,drumKit:'vcsl',preparing:true,playing:false,seed:42,kick:.8,volume:.3,timerMinutes:15};const updates=[];
 const bridge={audioCapabilities:()=>JSON.stringify({schema:'sou1.native-audio.v1',drumKits:kits}),status:()=>JSON.stringify(status),play:()=>true,stop(){},update:s=>updates.push(JSON.parse(s)),setTimer(){}};
 const h=boot({native:true,bridge,saved:{seed:1,parameters:{kick:.2}}});
 assert.equal(h.run('seed'),42);assert.equal(h.run('parameters.kick'),.8);assert.equal(h.els.get('timer').value,'15');assert.equal(h.run('nativePreparing'),true);assert.equal(h.run('playing'),false);
 h.run("setValue('snare',.7)");assert.equal(updates.at(-1).seed,42);assert.equal(updates.at(-1).kick,.8);
 h.c.window.sou1MidiExportResult('cancelled');assert.equal(h.els.get('new-seed').disabled,true);
 status={...status,preparing:false,playing:true};h.run('applyNativeSession()');assert.equal(h.run('playing'),true);assert.equal(h.run('seed'),42);
 const acknowledged=status;status={...status,preparing:true,playing:false};h.run('restoreNative()');assert.equal(h.run('playing'),true);assert.equal(h.run('nativeSession.data.playing'),true);assert.equal(h.els.get('drum-samples').disabled,true);
 console.log('PASS adopted native preparation hydrates controls, seed and timer; MIDI completion and regressive status preserve guards');
}

{
 const h=boot({saved:{drumKit:'procedural',scoreMode:'developing'},hold:'none'});await h.run('start()');assert.equal(h.nodes[0].name,'sou1-developing');assert.deepEqual(h.modules,['./developing-worklet.js']);assert.equal(h.loads.length,0);assert.equal(h.els.get('score-mode').disabled,true);
 h.els.get('score-mode').value='original';await h.els.get('score-mode').listeners.change();assert.equal(h.run('scoreMode'),'developing');h.run('stop()');h.els.get('score-mode').value='original';await h.els.get('score-mode').listeners.change();assert.equal(h.run('scoreMode'),'original');assert.equal(h.run('context'),null);await h.run('start()');assert.equal(h.nodes.at(-1).name,'sou1-ambient');
 console.log('PASS development selects dedicated real Worklet path and stopped-only mode changes rebuild graph');
 const old=boot({native:true,saved:{scoreMode:'developing'}});assert.equal(old.run('scoreMode'),'original');assert.equal(old.els.get('score-mode-control').hidden,true);
}

{
 const caps={schema:'sou1.native-audio.v1',scoreModes:['original','developing']};const bridge={audioCapabilities:()=>JSON.stringify(caps),status:()=>JSON.stringify({playing:false}),play:()=>true,stop(){},setTimer(){}};
 const partial=boot({native:true,bridge,saved:{scoreMode:'developing'}});assert.equal(partial.run('scoreMode'),'original');assert.equal(partial.els.get('score-mode-control').hidden,true);
 caps.drumKits=['procedural','vcsl','fsa-electronic','fsa-distkit','fsa-sdbkit','fsa-synthkit','fsa-x0xproc1','fsa-x0xproc2','guigui-soft','guigui-dynamic'];
 bridge.status=()=>JSON.stringify({requestId:18,drumKit:'procedural',preparing:false,playing:true,seed:7,volume:.3});
 const restored=boot({native:true,bridge,saved:{scoreMode:'developing'}});restored.run('restoreNative()');assert.equal(restored.run('scoreMode'),'original');assert.equal(restored.els.get('score-mode').value,'original');
 console.log('PASS incomplete mode capability keeps legacy path honest; missing restored mode normalizes to original');
}
