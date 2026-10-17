// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const appSource=fs.readFileSync(new URL('../docs/app.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'');
const elements=new Map();
function element(id=''){const e={id,value:'0',textContent:'',style:{setProperty(){}},dataset:{},classList:{toggle(){}},listeners:{},setAttribute(k,v){this[k]=v},removeAttribute(k){delete this[k]},addEventListener(k,f){this.listeners[k]=f},append(){},focus(){},setPointerCapture(){},getContext(){return{}},set innerHTML(s){for(const m of s.matchAll(/id="([^"]+)"/g))elements.set(m[1],element(m[1]));}};return e;}
const html=fs.readFileSync(new URL('../docs/index.html',import.meta.url),'utf8');
for(const m of html.matchAll(/id="([^"]+)"/g))elements.set(m[1],element(m[1]));
elements.get('rain-type').value='1';
const context={console,drawAsciiGrid(){},createPianoRoll(){return {update(){},refresh(){}}},setInterval(){},document:{getElementById:id=>elements.get(id),documentElement:{},querySelectorAll:()=>[],createElement:()=>element(),body:{classList:{toggle(){}}},addEventListener(){}},window:{addEventListener(){}},navigator:{language:'en'},localStorage:{getItem:()=>null,setItem(){}},crypto:{getRandomValues:a=>{a[0]=1;return a}},performance:{now:()=>0},matchMedia:()=>({matches:false}),requestAnimationFrame(){},fetch:()=>Promise.resolve({json:()=>Promise.resolve({apk:null})}),setTimeout,clearTimeout};
vm.createContext(context);
vm.runInContext(appSource,context);
assert.equal(vm.runInContext("t('quiet')",context),'');
for(const key of ['warmth','strength','width','wash','pad','pluck','bell','texture','pulse','evolution','rain','thunder','wind'])assert.ok(elements.has(key),key);
vm.runInContext("setValue('rain',.4)",context);
assert.equal(vm.runInContext('parameters.rainType',context),1);
assert.equal(elements.get('rain-enabled').checked,true);
elements.get('thunder-enabled').listeners.change({target:{checked:true}});
assert.equal(vm.runInContext('parameters.thunder',context),.25);
elements.get('rain-enabled').listeners.change({target:{checked:false}});
assert.equal(vm.runInContext('parameters.rain',context),0);
assert.equal(vm.runInContext('parameters.thunder',context),.25);
assert.equal(elements.get('timbre-low').textContent,'0');
assert.equal(elements.get('timbre-high').textContent,'100');
console.log('PASS UI boot, empty copy, macro/layer controls, independent weather toggles');

for(const key of ['ambient','counterpoint','rhythmic','arpeggio','density','complexity','swing','bpm','polyphony','melody-enabled','drums-enabled','kick','snare','hihat','toms','cymbal'])assert.ok(elements.has(key),key);
elements.get('bpm').listeners.input({target:{value:'999'}});
assert.equal(vm.runInContext('parameters.bpm',context),180);
elements.get('polyphony').listeners.change({target:{value:'24'}});
assert.equal(vm.runInContext('parameters.polyphony',context),24);
elements.get('melody-enabled').listeners.change({target:{checked:false}});
assert.equal(vm.runInContext('parameters.melodyEnabled',context),false);
elements.get('drums-enabled').listeners.change({target:{checked:true}});
assert.equal(vm.runInContext('parameters.drumsEnabled',context),true);
assert.equal(vm.runInContext("readParameter('polyphony',123,16)",context),16);
assert.equal(vm.runInContext("readParameter('melodyEnabled','false',true)",context),true);
context.posted=[];
vm.runInContext('node={port:{postMessage:m=>posted.push(m)}}; state(true); timerEndAt=123456;',context);
const oldSeed=vm.runInContext('seed',context);
elements.get('new-seed').listeners.click();
assert.equal(context.posted.at(-1).type,'reseed');
assert.notEqual(vm.runInContext('seed',context),oldSeed);
assert.equal(vm.runInContext('playing',context),true);
assert.equal(vm.runInContext('timerEndAt',context),123456);
assert.equal(elements.get('new-seed').disabled,false);
console.log('PASS composer controls, melody/drum toggles, live reseed preserves playback/timer');
const nativeContext={...context,window:{addEventListener(){},AndroidBridge:{status:()=>JSON.stringify({playing:false})}},fetch:()=>{throw Error('native must not fetch APK metadata')}};
vm.createContext(nativeContext);
vm.runInContext(appSource,nativeContext);
assert.equal(elements.get('apk').hidden,true);
assert.equal(elements.get('install').hidden,true);
console.log('PASS native hides APK/PWA install links and skips web APK fetch');

assert.equal(vm.runInContext("Object.values(presets).every(p=>!Object.hasOwn(p,'composition'))",nativeContext),true);
for(const key of ['ambient','counterpoint','rhythmic','arpeggio','density','complexity','swing'])assert.equal(vm.runInContext(`Object.values(presets).every(p=>Object.hasOwn(p,'${key}'))`,nativeContext),true);
console.log('PASS presets are exposed knob values without hidden composition modes');
nativeContext.window.AndroidBridge.reseed=()=>false;
vm.runInContext('state(true)',nativeContext);
const nativeSeed=vm.runInContext('seed',nativeContext);
elements.get('new-seed').listeners.click();
assert.equal(vm.runInContext('seed',nativeContext),nativeSeed);
assert.ok(elements.get('notice').textContent);
const legacyContext={...context,window:{addEventListener(){}},localStorage:{getItem:()=>JSON.stringify({parameters:{composition:2}}),setItem(){}}};
vm.createContext(legacyContext);vm.runInContext(appSource,legacyContext);
assert.equal(vm.runInContext('parameters.rhythmic',legacyContext),1);
assert.equal(vm.runInContext('parameters.ambient',legacyContext),0);
console.log('PASS legacy composition migration and rejected native reseed preserves UI seed');
for(const corrupt of ['null','[]','true','"wrong"','{bad']){
 const c={...context,window:{addEventListener(){}},localStorage:{getItem:()=>corrupt,setItem(){}}};vm.createContext(c);vm.runInContext(appSource,c);assert.equal(vm.runInContext('parameters.ambient',c),1);
}
console.log('PASS malformed or non-object stored preferences recover to defaults');
let releaseResume, suspended=0, graphCount=0, pauseResume=false;
const callbacks=new Map();let nextTimer=0;let worklet;
class FakeAudioContext{
 constructor(){this.state='running';this.currentTime=0;this.destination={};this.audioWorklet={addModule:async()=>{}}}
 resume(){return pauseResume?new Promise(resolve=>{releaseResume=resolve}):Promise.resolve()}
 suspend(){suspended++;return Promise.resolve()}
 close(){return Promise.resolve()}
 createGain(){return {gain:{value:0,setTargetAtTime(){}},connect:()=>({connect(){}})}}
 createAnalyser(){return {fftSize:1024,frequencyBinCount:512,connect(){}}}
}
class FakeWorklet{
 constructor(){graphCount++;worklet=this;this.port={postMessage(){}}}
 connect(){return {connect:()=>({connect(){}})}}
}
const raceContext={...context,window:{addEventListener(){}},AudioContext:FakeAudioContext,AudioWorkletNode:FakeWorklet,setTimeout:f=>{callbacks.set(++nextTimer,f);return nextTimer},clearTimeout:id=>callbacks.delete(id)};
vm.createContext(raceContext);vm.runInContext(appSource,raceContext);
await vm.runInContext('start()',raceContext);
vm.runInContext('stop()',raceContext);
const staleFallback=[...callbacks.values()].at(-1);
pauseResume=true;
const restarting=vm.runInContext('start()',raceContext);
assert.equal(vm.runInContext('busy',raceContext),true);
worklet.port.onmessage({data:{type:'silent'}});staleFallback();
assert.equal(suspended,0,'stale stop callback must not suspend a pending restart');
releaseResume();await restarting;
assert.equal(vm.runInContext('playing',raceContext),true);
assert.equal(graphCount,1,'restart reuses the existing graph');
vm.runInContext("preset='focus'",raceContext);
elements.get('wind-enabled').listeners.change({target:{checked:true}});
assert.equal(vm.runInContext('preset',raceContext),'custom');
console.log('PASS rapid restart ignores stale silence messages/fallback and weather edits mark custom');

vm.runInContext('exportBusy=true;state(false)',context);
assert.equal(elements.get('new-seed').disabled,true);
const exportSeed=vm.runInContext('seed',context);elements.get('new-seed').listeners.click();assert.equal(vm.runInContext('seed',context),exportSeed);
vm.runInContext('state(true)',context);assert.equal(elements.get('new-seed').disabled,true);
vm.runInContext('exportBusy=false;state(false)',context);assert.equal(elements.get('new-seed').disabled,false);
console.log('PASS pending MIDI export prevents reseed across playback state changes');
