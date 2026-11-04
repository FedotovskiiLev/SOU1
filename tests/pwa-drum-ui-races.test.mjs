// SPDX-License-Identifier: AGPL-3.0-only
// Deterministic VM/DOM/AudioContext doubles. These exercise control races,
// not real browser rendering, autoplay, AudioWorklet deadlines or device audio.
import {fileURLToPath} from 'node:url';
import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('..',import.meta.url));
const source=fs.readFileSync(root+'/docs/app.js','utf8').replace(/^import .*;\n/gm,'');
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}}
const tick=async()=>{for(let i=0;i<20;i++)await Promise.resolve()};
function boot({saved={drumKit:'vcsl'},hold='load',native=false}={}){
 const els=new Map(),events=new Map(),instances=[],nodes=[],loads=[],modules=[];let next=0;const timers=new Map();
 function el(id=''){return {id,value:'0',textContent:'',style:{setProperty(){}},dataset:{},classList:{toggle(){}},listeners:{},setAttribute(k,v){this[k]=v},removeAttribute(k){delete this[k]},addEventListener(k,f){this.listeners[k]=f},append(){},focus(){},setPointerCapture(){},getContext(){return{}},set innerHTML(s){for(const m of s.matchAll(/id="([^"]+)"/g))els.set(m[1],el(m[1]));}};}
 for(const m of fs.readFileSync(root+'/docs/index.html','utf8').matchAll(/id="([^"]+)"/g))els.set(m[1],el(m[1]));els.get('rain-type').value='1';
 class AC{constructor(){this.state='running';this.sampleRate=48000;this.currentTime=0;this.destination={};this.resumes=[];this.closeCount=0;this.suspendCount=0;this.audioWorklet={addModule:async u=>{modules.push(u);if(hold==='module'){this.module=deferred();return this.module.promise}}};instances.push(this)}resume(){if(hold==='resume'){const d=deferred();this.resumes.push(d);return d.promise}return Promise.resolve()}suspend(){this.suspendCount++;this.state='suspended';return Promise.resolve()}close(){this.closeCount++;this.state='closed';for(const d of this.resumes)d.reject(new DOMException('closed','InvalidStateError'));return Promise.resolve()}createGain(){return {gain:{value:0,setTargetAtTime(){}},connect:()=>({connect(){}})}}createAnalyser(){return {fftSize:1024,frequencyBinCount:512,connect(){}}}}
 class AW{constructor(c,name,opt){this.context=c;this.name=name;this.options=opt;this.messages=[];this.port={postMessage:m=>this.messages.push(m)};nodes.push(this)}connect(){return {connect:()=>({connect(){}})}}}
 const c={console:{error(){}},DOMException,AbortController,AudioContext:AC,AudioWorkletNode:AW,loadRecordedDrums:(kit,rate,{signal})=>{const d=deferred();loads.push({kit,rate,d,signal});signal.addEventListener('abort',()=>d.reject(new DOMException('cancelled','AbortError')));return d.promise},drawAsciiGrid(){},createPianoRoll(){return {update(){},refresh(){}}},setInterval(){},document:{getElementById:id=>els.get(id),documentElement:{},querySelectorAll:()=>[],createElement:()=>el(),body:{classList:{toggle(){}}},addEventListener(){}},window:{addEventListener:(k,v)=>events.set(k,v),...(native?{AndroidBridge:{status:()=>JSON.stringify({playing:false}),play:()=>true,stop(){},setTimer(){}}}:{})},navigator:{language:'en'},localStorage:{getItem:()=>JSON.stringify(saved),setItem(){}},crypto:{getRandomValues:a=>{a[0]=1;return a}},performance:{now:()=>0},matchMedia:()=>({matches:false}),requestAnimationFrame(){},fetch:()=>Promise.resolve({json:()=>Promise.resolve({apk:null})}),setTimeout:f=>{timers.set(++next,f);return next},clearTimeout:n=>timers.delete(n)};vm.createContext(c);vm.runInContext(source,c);return {c,els,events,instances,nodes,loads,modules,run:s=>vm.runInContext(s,c),settle:()=>loads.at(-1).d.resolve({wireBank:{sampleRate:48000},report:{banks:[{id:'fixture'}]}})};
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
