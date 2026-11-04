// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {DevelopmentScore} from '../docs/development-score.js';
const rate=8000,meters=[48,36,60,42,54,72];
const base={ambient:0,counterpoint:0,rhythmic:1,arpeggio:0,density:1,complexity:1,evolution:1,swing:0,bpm:120,polyphony:32,melodyEnabled:true,drumsEnabled:false};
function bars(config,parameters,seed=0x4405a035,count=32){
 const s=new DevelopmentScore(rate,seed,config),frames=rate*.5*s.meterTicks/12,events=[];
 s.advanceTo(Math.round(frames*count)-1,parameters,{noteOn(...e){events.push(e);}});
 const grouped=Array.from({length:count},()=>[]);for(const e of events){const at=Math.floor(e[0]/frames);if(at<count)grouped[at].push([e[0]-Math.round(at*frames),...e.slice(1)]);}
 return {s,grouped};
}
const onsets=bar=>bar.filter(e=>e[1]===1).map(e=>[e[0],e[3]]);
test('every named melodic rhythm holds note onsets across phrase boundaries and reseeds in all meters',()=>{
 for(let meter=0;meter<meters.length;meter++)for(let rhythmFamily=0;rhythmFamily<8;rhythmFamily++){
  let reference;
  for(const seed of [1,91,0x4405a035]){
   const {s,grouped}=bars({meter,rhythmFamily},base,seed);assert.equal(s.suppressedEvents,0);
   const first=onsets(grouped[0]);assert.ok(first.length>0);for(const b of grouped)assert.deepEqual(onsets(b),first,`meter${meter} family${rhythmFamily}`);
   if(reference)assert.deepEqual(first,reference);else reference=first;
  }
 }
});
test('every named drum pattern with Auto repeats full bars; explicit variation is preserved and Random remains generative',()=>{
 const p={...base,rhythmic:0,melodyEnabled:false,drumsEnabled:true};
 for(let meter=0;meter<meters.length;meter++)for(let drumPattern=0;drumPattern<8;drumPattern++){
  let reference;
  for(const seed of [1,91,0x4405a035]){
   const {s,grouped}=bars({meter,drumPattern},p,seed);assert.equal(s.suppressedEvents,0);assert.ok(grouped[0].length>0);
   for(const b of grouped)assert.deepEqual(b,grouped[0],`meter${meter} drums${drumPattern}`);
   if(reference)assert.deepEqual(grouped[0],reference);else reference=grouped[0];
  }
 }
 const fixed=bars({meter:0,drumPattern:3},p),varied=bars({meter:0,drumPattern:3,drumVariation:1},p),random=bars({meter:0,drumPattern:'seed'},p);
 assert.notDeepEqual(varied.grouped,fixed.grouped);assert.equal(varied.s.config.drumVariation,1);
 assert.ok(new Set(random.grouped.map(b=>JSON.stringify(b))).size>1);
});
test('selected arpeggio order has no autonomous phrase rests; Random melodic rhythm still varies',()=>{
 for(let arpStrategy=0;arpStrategy<8;arpStrategy++){
  const {grouped}=bars({meter:0,arpStrategy},{...base,rhythmic:0,arpeggio:1});const first=onsets(grouped[0]);
  assert.ok(first.length>0);for(const b of grouped)assert.deepEqual(onsets(b),first);
 }
 const {grouped}=bars({meter:0,rhythmFamily:'seed'},base);assert.ok(new Set(grouped.map(b=>JSON.stringify(onsets(b)))).size>1);
});
