// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const elements=new Map();
function element(id=''){const e={id,value:'0',textContent:'',style:{setProperty(){}},dataset:{},classList:{toggle(){}},listeners:{},setAttribute(k,v){this[k]=v},removeAttribute(k){delete this[k]},addEventListener(k,f){this.listeners[k]=f},append(){},focus(){},setPointerCapture(){},getContext(){return{}},set innerHTML(s){for(const m of s.matchAll(/id="([^"]+)"/g))elements.set(m[1],element(m[1]));}};return e;}
const html=fs.readFileSync(new URL('../docs/index.html',import.meta.url),'utf8');
for(const m of html.matchAll(/id="([^"]+)"/g))elements.set(m[1],element(m[1]));
elements.get('rain-type').value='1';
const context={console,document:{getElementById:id=>elements.get(id),documentElement:{},querySelectorAll:()=>[],createElement:()=>element(),body:{classList:{toggle(){}}},addEventListener(){}},window:{addEventListener(){}},navigator:{language:'en'},localStorage:{getItem:()=>null,setItem(){}},crypto:{getRandomValues:a=>{a[0]=1;return a}},performance:{now:()=>0},matchMedia:()=>({matches:false}),requestAnimationFrame(){},fetch:()=>Promise.resolve({json:()=>Promise.resolve({apk:null})}),setTimeout,clearTimeout};
vm.createContext(context);
vm.runInContext(fs.readFileSync(new URL('../docs/app.js',import.meta.url),'utf8'),context);
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
