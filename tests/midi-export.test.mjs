// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
const source=await readFile(new URL('../docs/midi-export.js',import.meta.url),'utf8');
const {encodeMidi,vlq}=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
function parse(bytes){
 const b=Buffer.from(bytes);let p=0;
 const text=n=>{const s=b.toString('ascii',p,p+n);p+=n;return s;};
 const u16=()=>{const n=b.readUInt16BE(p);p+=2;return n;};
 const u32=()=>{const n=b.readUInt32BE(p);p+=4;return n;};
 const variable=()=>{let n=0,k=0,v;do{assert(p<b.length);v=b[p++];n=n*128+(v&127);assert(++k<=4);}while(v&128);return n;};
 assert.equal(text(4),'MThd');assert.equal(u32(),6);assert.equal(u16(),1);const count=u16();assert.equal(u16(),960);
 const tracks=[];
 for(let t=0;t<count;t++){
  assert.equal(text(4),'MTrk');const end=p+4+u32();let tick=0,events=[];
  while(p<end){tick+=variable();const status=b[p++];assert(status>=128);
   if(status===255){const type=b[p++],n=variable(),data=Array.from(b.subarray(p,p+n));p+=n;assert(p<=end);events.push({tick,type,data});if(type===47){assert.equal(n,0);assert.equal(p,end);}}
   else if((status&240)===192){const program=b[p++];assert(program<128);events.push({tick,status,data:[program]});}
   else {assert([128,144].includes(status&240));const data=[b[p++],b[p++]];assert(data.every(n=>n<128));events.push({tick,status,data});}
  }
  assert.equal(p,end);assert.equal(events.at(-1).type,47);tracks.push(events);
 }
 assert.equal(p,b.length);return tracks;
}
const score=events=>({frame:480000,rate:48000,seed:17,events});
const one=encodeMidi(score([[48000,1,60,24000,.5]]));
const tracks=parse(one.bytes);assert.equal(tracks.length,2);assert.deepEqual(tracks[0].find(e=>e.type===81).data,[7,161,32]);assert.deepEqual(tracks[1].filter(e=>e.status&&e.status<192).map(e=>[e.tick,e.status,...e.data]),[[0,145,60,64],[960,129,60,0]]);
for(const [n,expected] of [[0,[0]],[127,[127]],[128,[129,0]],[16383,[255,127]],[16384,[129,128,0]],[2097151,[255,255,127]],[2097152,[129,128,128,0]],[0xfffffff,[255,255,255,127]]])assert.deepEqual(vlq(n),expected);
for(const n of [-1,1.5,NaN,Infinity,0x10000000])assert.throws(()=>vlq(n));
function activeCheck(parsed){
 const events=parsed.flatMap((track,index)=>track.filter(e=>e.status&&(e.status&240)!==192).map(e=>({...e,index}))).sort((a,b)=>a.tick-b.tick||a.index-b.index||((a.status&240)-(b.status&240)));
 const active=new Set();for(const e of events){const key=(e.status&15)+':'+e.data[0];if((e.status&240)===144){assert(!active.has(key),'overlapping key '+key);assert(e.data[1]>0);active.add(key);}else{assert(active.has(key),'unmatched off '+key);active.delete(key);}}assert.equal(active.size,0);
}
const fixture=score(Array.from({length:10},(_,i)=>[i*48000,i,i<5?60+i:i===8||i===9?49:36+i,96000,.75]));
const snapshot=JSON.stringify(fixture);const all=encodeMidi(fixture);assert.equal(parse(all.bytes).length,11);activeCheck(parse(all.bytes));assert.equal(JSON.stringify(fixture),snapshot);assert.deepEqual(encodeMidi(fixture).bytes,all.bytes);
for(const events of [
 [[0,0,60,48000,.5],[12000,0,60,48000,.8]],
 [[0,8,49,48000,.5],[24000,9,49,48000,.8]],
 [[0,9,49,48000,.5],[25,8,49,48000,.8]],
 [[0,8,49,48000,.5],[0,9,49,96000,.8]],
 [[0,0,60,96000,.5],[0,0,60,48000,.8],[25,0,60,1,.4]]
 ])activeCheck(parse(encodeMidi(score(events)).bytes));
for(const rate of [44100,48000]){
 const s={rate,seed:1,events:[[rate*10,0,127,1,1],[rate*10+12345,4,0,rate,.1]]};const t=parse(encodeMidi(s).bytes);assert.equal(t[1].find(e=>e.status===128).tick,1);assert(Math.abs(t[2].find(e=>e.status===148).tick-12345*1920/rate)<=.5);
}
assert.throws(()=>encodeMidi(score([])));assert.throws(()=>encodeMidi({...fixture,rate:NaN}));assert.throws(()=>encodeMidi({...fixture,rate:0}));
for(const e of [[0,10,60,1,.5],[0,1,128,1,.5],[0,1,60,0,.5],[0,1,60,1,NaN],[-1,1,60,1,.5],[0,1,60,1,2]])assert.throws(()=>encodeMidi(score([e])));
const maximum=score(Array.from({length:512},(_,i)=>[i*48000,i%10,60+(i%12),24000,.5]));activeCheck(parse(encodeMidi(maximum).bytes));assert.throws(()=>encodeMidi({...maximum,events:[...maximum.events,maximum.events[0]]}));
assert.throws(()=>encodeMidi(score([[0,0,60,1,.5],[1e12,1,60,1,.5]])));
await writeFile(new URL('./reports/midi-export-fixture.mid',import.meta.url),all.bytes);
console.log('PASS MIDI export: independent SMF parser, 10 instruments, timing, VLQ, overlaps/cross-track percussion, bounded/invalid history, immutable deterministic output');
