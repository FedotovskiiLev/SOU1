// SPDX-License-Identifier: AGPL-3.0-only
// Standard MIDI File type 1. The retained score is timed in audio frames;
// a fixed 120 BPM grid preserves seconds even when live generator tempo changed.
export const MIDI_NAMES=['Pads','Plucks','Bells','Texture','Pulse','Kick','Snare','Hi-hat','Toms','Cymbal'];
const PROGRAMS=[89,24,10,91,80], PPQ=960, TPS=1920, MAX_DELTA=0x0fffffff;
const ascii=s=>Array.from(s,c=>c.charCodeAt(0));
const be=(n,size)=>Array.from({length:size},(_,i)=>Math.floor(n/2**(8*(size-i-1)))%256);
export function vlq(n){
 if(!Number.isSafeInteger(n)||n<0||n>MAX_DELTA)throw new RangeError('MIDI delta out of range');
 const bytes=[n%128];while((n=Math.floor(n/128))>0)bytes.unshift((n%128)|128);return bytes;
}
const meta=(type,text)=>{const b=ascii(text);return [0xff,type,...vlq(b.length),...b];};
function chunk(type,bytes){return [...ascii(type),...be(bytes.length,4),...bytes];}
export function encodeMidi(score){
 if(!score||!Number.isFinite(score.rate)||score.rate<=0||!Array.isArray(score.events)||score.events.length>512)throw new TypeError('Invalid retained score');
 const source=score.events.map(e=>{
  if(!Array.isArray(e)||e.length<5||!e.slice(0,4).every(Number.isSafeInteger)||e[0]<0||e[1]<0||e[1]>9||e[2]<0||e[2]>127||e[3]<=0||!Number.isSafeInteger(e[0]+e[3])||!Number.isFinite(e[4])||e[4]<0||e[4]>1)throw new TypeError('Invalid note');
  return e.slice(0,5);
 }).filter(e=>e[4]>0);
 if(!source.length)throw new RangeError('No notes to export');
 const origin=Math.min(...source.map(e=>e[0]));
 const notes=source.map(([frame,instrument,pitch,duration,velocity])=>{
  const start=Math.round((frame-origin)*TPS/score.rate),end=Math.max(start+1,Math.round((frame+duration-origin)*TPS/score.rate));
  if(!Number.isSafeInteger(end)||end>MAX_DELTA)throw new RangeError('Score duration exceeds MIDI limit');
  return {start,end,instrument,pitch,channel:instrument<5?instrument:9,velocity:Math.max(1,Math.round(velocity*127))};
 });
 // MIDI 1.0 has no per-note IDs. Resolve repeated keys across all tracks.
 // Same-tick duplicates coalesce. Cross-track retriggers get a one-tick gap;
 // adjacent-tick collisions coalesce rather than creating zero-length notes.
 const keys=new Map();
 for(const n of notes){const key=n.channel+':'+n.pitch;if(!keys.has(key))keys.set(key,[]);keys.get(key).push(n);}
 const resolved=[];let coalesced=0,clipped=0;
 for(const group of keys.values()){
  group.sort((a,b)=>a.start-b.start||a.instrument-b.instrument);
  const kept=[];
  for(const n of group){const prev=kept.at(-1);
   if(prev&&(n.start===prev.start||(prev.instrument!==n.instrument&&n.start===prev.start+1&&prev.end>=n.start))){prev.end=Math.max(prev.end,n.end);prev.velocity=Math.max(prev.velocity,n.velocity);coalesced++;continue;}
   if(prev&&prev.end>=n.start){prev.end=n.start-(prev.instrument!==n.instrument?1:0);clipped++;}
   kept.push(n);
  }
  resolved.push(...kept);
 }
 const tracks=[];
 tracks.push(chunk('MTrk',[0,...meta(3,'SOU1 retained note history'),0,0xff,0x51,3,7,0xa1,0x20,0,...meta(1,'Up to 512 notes; fixed 120 BPM preserves seconds. GM timbres approximate SOU1 synthesis.'),0,0xff,0x2f,0]));
 for(let instrument=0;instrument<10;instrument++){
  const ns=resolved.filter(n=>n.instrument===instrument);if(!ns.length)continue;
  const channel=instrument<5?instrument:9;
  const bytes=[0,...meta(3,MIDI_NAMES[instrument])];
  if(instrument<5)bytes.push(0,0xc0|channel,PROGRAMS[instrument]);
  const events=[];
  for(const n of ns){events.push({tick:n.start,order:1,data:[0x90|channel,n.pitch,n.velocity]},{tick:n.end,order:0,data:[0x80|channel,n.pitch,0]});}
  events.sort((a,b)=>a.tick-b.tick||a.order-b.order||a.data[1]-b.data[1]);
  let previous=0;
  for(const e of events){bytes.push(...vlq(e.tick-previous),...e.data);previous=e.tick;}
  bytes.push(0,0xff,0x2f,0);tracks.push(chunk('MTrk',bytes));
 }
 const bytes=new Uint8Array([...chunk('MThd',[0,1,...be(tracks.length,2),...be(PPQ,2)]),...tracks.flat()]);
 return {bytes,noteCount:resolved.length,coalesced,clipped,filename:'SOU1-'+(Number(score.seed)>>>0).toString(16).padStart(8,'0')+'.mid'};
}
