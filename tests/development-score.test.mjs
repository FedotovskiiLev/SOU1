// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import test from 'node:test';
const source=await readFile(new URL('../docs/development-score.js',import.meta.url),'utf8');
const {DevelopmentScore}=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const RATE=8000, BASE={ambient:1,counterpoint:0,rhythmic:0,arpeggio:0,density:.5,complexity:.5,evolution:0,swing:0,bpm:72,melodyEnabled:true,drumsEnabled:false,polyphony:16};
const STYLES=['ambient','counterpoint','rhythmic','arpeggio'];
const style=(i,extra={})=>({...BASE,ambient:0,counterpoint:0,rhythmic:0,arpeggio:0,[STYLES[i]]:1,...extra});
const scales=[[0,2,4,5,7,9,11],[0,2,3,5,7,9,10],[0,2,3,5,7,8,10],[0,2,4,5,7,9,10],[0,2,4,6,7,9,11],[0,1,3,5,7,8,10],[0,2,3,5,7,8,11]];
function collect(p=BASE,seconds=120,seed=91,rate=RATE,chunk=0){
  const s=new DevelopmentScore(rate,seed),events=[],sink={noteOn(...e){events.push(e);}},end=Math.round(seconds*rate)-1;
  if(chunk>0)for(let f=0;f<end;f+=chunk)s.advanceTo(f,p,sink);
  s.advanceTo(end,p,sink);return {s,events};
}
const digest=events=>createHash('sha256').update(JSON.stringify(events)).digest('hex');
const musicalFingerprint=events=>digest(events.filter(e=>e[1]===1||e[1]===2).map(e=>e.slice(0,4)));
const melodicCount=events=>events.filter(e=>e[1]===1||e[1]===2).length;
function checkEvent(s,e,previous){
  const [at,k,pitch,duration,velocity,pan]=e;
  assert(Number.isSafeInteger(at)&&at>=0&&at>=previous);
  assert(Number.isInteger(k)&&k>=0&&k<=9);
  assert(Number.isInteger(pitch));assert(Number.isInteger(duration)&&duration>=1&&duration<=32*s.rate);
  assert(Number.isFinite(velocity)&&velocity>=.005&&velocity<=1);
  assert(Number.isFinite(pan)&&pan>=.15&&pan<=.85);
  const bounds=[[45,74],[57,88],[48,88],[62,86],[33,52],[36,36],[38,38],[42,42],[45,49],[49,49]][k];
  assert(pitch>=bounds[0]&&pitch<=bounds[1],`layer${k} pitch${pitch}`);
  if(k<5)assert(scales[s.mode].includes(((pitch-s.root)%12+12)%12),`out of mode: root${s.root}, mode${s.mode}, MIDI${pitch}`);
}

test('sample-rate, frame and parameter validation; safe nonfinite control fallback',()=>{
  for(const rate of [0,7999,8000.5,192001,NaN,Infinity])assert.throws(()=>new DevelopmentScore(rate),RangeError);
  for(const rate of [8000,44100,48000,96000,192000])assert.equal(new DevelopmentScore(rate).rate,rate);
  for(const frame of [NaN,Infinity,-2,1.2,Number.MAX_SAFE_INTEGER+1])assert.throws(()=>new DevelopmentScore(RATE).advanceTo(frame,BASE,{}),RangeError);
  assert.throws(()=>new DevelopmentScore(RATE).advanceTo(0,null,{}),TypeError);
  const s=new DevelopmentScore(RATE);s.advanceTo(-1,BASE,{noteOn(){assert.fail('negative pre-roll emitted');}});assert.equal(s.step,0);
  const result=collect({...BASE,bpm:NaN,evolution:Infinity,density:NaN,complexity:-1,swing:100,ambient:Infinity,counterpoint:Infinity,rhythmic:Infinity,arpeggio:Infinity},60);
  let previous=-1;for(const e of result.events){checkEvent(result.s,e,previous);previous=e[0];}
  assert(result.events.length>0);
});

test('constructor, reset and reseed reproduce exactly, with bounded persistent state',()=>{
  const a=collect(style(1,{complexity:.9,evolution:.8,drumsEnabled:true}),300,123),s=a.s;
  const arrays=Object.values(s).filter(ArrayBuffer.isView),lengths=arrays.map(a=>a.length);
  s.reset();const events=[];s.advanceTo(300*RATE-1,style(1,{complexity:.9,evolution:.8,drumsEnabled:true}),{noteOn(...e){events.push(e);}});
  assert.deepEqual(events,a.events);assert.deepEqual(Object.values(s).filter(ArrayBuffer.isView),arrays);
  assert.deepEqual(arrays.map(a=>a.length),lengths);
  Object.values(s).filter(ArrayBuffer.isView).forEach((a,i)=>assert.equal(a,arrays[i]));
  s.reseed(124);const changed=[];s.advanceTo(300*RATE-1,style(1,{complexity:.9,evolution:.8,drumsEnabled:true}),{noteOn(...e){changed.push(e);}});
  assert.deepEqual(changed,collect(style(1,{complexity:.9,evolution:.8,drumsEnabled:true}),300,124).events);
  assert.notEqual(digest(changed),digest(events));const seed=s.seed;s.reseed(NaN);assert.equal(s.seed,seed);
  assert.equal(arrays.reduce((n,a)=>n+a.byteLength,0),660);
  assert(!/\.map\(|\.filter\(|\.slice\(|\.push\(|\.concat\(/.test(source),'allocating collection methods in audio-thread module');
  assert.equal((source.match(/new (?:Int|Uint|Float)\d+Array/g)||[]).length,7);
});

test('all styles and seeds have distinct rhythm-plus-pitch fingerprints and broad structural palette',()=>{
  const modes=new Set(),meters=new Set(),families=new Set(),arps=new Set(),lengths=new Set(),phrases=new Set();
  const fingerprints=new Set(),rhythms=STYLES.map(()=>new Set()),contours=STYLES.map(()=>new Set());
  for(let seed=0;seed<128;seed++){
    const s=new DevelopmentScore(RATE,seed);modes.add(s.mode);meters.add(s.meterTicks);families.add(s.family);arps.add(s.arpStrategy);lengths.add(s.motifLength);phrases.add(s.phraseBars);
    if(seed<24)for(let i=0;i<4;i++){
      const {s:score,events}=collect(style(i,{density:.8,complexity:.8,evolution:.6}),240,seed);
      const melodic=events.filter(e=>e[1]===1||e[1]===2);
      rhythms[i].add(digest(melodic.map(e=>[e[0],e[1],e[3]])));
      contours[i].add(digest(melodic.map(e=>[e[1],e[2]-score.root])));
      const fp=musicalFingerprint(events);assert(!fingerprints.has(fp),`repeated fingerprint seed${seed}, style${i}`);fingerprints.add(fp);
      assert(melodicCount(events)>=10);
    }
  }
  assert.equal(modes.size,7);assert.equal(meters.size,6);assert.equal(families.size,8);assert.equal(arps.size,8);assert.equal(lengths.size,6);assert.equal(phrases.size,5);
  assert.equal(fingerprints.size,96);
  assert(rhythms.every(set=>set.size>=23),'seed variety must change rhythm, not only transpose pitches');
  assert(contours.every(set=>set.size===24),'seed variety must change root-normalized melodic contour');
});

test('same seed separates sparse ambient, answering counterpoint, broken rhythm and arpeggio',()=>{
  const results=STYLES.map((_,i)=>collect(style(i,{complexity:.8,density:.8,evolution:.4}),360,91));
  const counts=results.map(r=>melodicCount(r.events));
  assert(counts[0]<Math.min(...counts.slice(1))/8,`ambient not sparse: ${counts}`);
  assert(results[1].events.filter(e=>e[1]===2).length>results[2].events.filter(e=>e[1]===2).length*1.4);
  const gates=results.map(r=>new Set(r.events.filter(e=>e[1]===1).map(e=>e[3])));
  assert(results[2].events.filter(e=>e[1]===1).every(e=>e[3]<RATE*.4));
  assert(gates[1].size>=2&&gates[2].size>=2);
  const fingerprints=results.map(r=>musicalFingerprint(r.events));assert.equal(new Set(fingerprints).size,4);
});

test('long-form development mutates a motif cell without replacing its identity or forcing a tonic ending',()=>{
  const s=new DevelopmentScore(RATE,91),initial=Array.from(s.motif),p=style(1,{complexity:.9,evolution:.7}),sink={noteOn(){}};
  while(s.phrase<6||s.barTick===0)s.advanceTo(s.next,p,sink);
  const changes=initial.filter((d,i)=>d!==s.motif[i]);assert.equal(changes.length,1);
  const endings=[];
  for(let i=0;i<20;i++){
    const phrase=s.phrase;
    while(s.phrase===phrase)s.advanceTo(s.next,p,sink);
    endings.push(s.chord);
  }
  assert(endings.filter(d=>d!==0).length>=12);assert(new Set(endings).size>=4);
});

test('chunk-size invariance at 8–192 kHz including irregular frame boundaries',()=>{
  for(const rate of [8000,44100,48000,192000])for(const i of [0,1,2,3]){
    const p=style(i,{complexity:.85,density:.75,evolution:.6,swing:.73,bpm:137.25,drumsEnabled:true});
    const a=collect(p,24,342,rate),b=collect(p,24,342,rate,317);
    assert.deepEqual(a.events,b.events,`rate${rate} style${i}`);assert.equal(a.s.beatNext,b.s.beatNext);
  }
});

test('live parameter schedule is deterministic, with no backwards ticks or repeated catch-up events',()=>{
  const schedule=[
    [11*RATE,style(0,{bpm:30})],
    [27*RATE,style(2,{bpm:180,swing:1,density:1,complexity:1,drumsEnabled:true})],
    [39*RATE,style(1,{bpm:53.5,swing:.47,melodyEnabled:false})],
    [60*RATE,style(3,{bpm:146,density:.2,evolution:.9})]
  ];
  function run(chunk){const s=new DevelopmentScore(RATE,31),events=[],sink={noteOn(...e){events.push(e);}};let start=0;
    for(const [end,p] of schedule){if(chunk)for(let at=start;at<end;at+=chunk)s.advanceTo(at,p,sink);s.advanceTo(end-1,p,sink);start=end;}
    return {s,events};}
  const a=run(0),b=run(127);assert.deepEqual(a.events,b.events);
  let previous=-1;for(const e of a.events){checkEvent(a.s,e,previous);previous=e[0];}
  assert(!a.events.some(e=>e[0]>=27*RATE&&e[0]<39*RATE&&(e[1]===1||e[1]===2)));
  const count=a.s.eventCount,step=a.s.step;a.s.advanceTo(60*RATE-1,schedule.at(-1)[1],{noteOn(){assert.fail('duplicate event');}});
  assert.equal(a.s.eventCount,count);assert.equal(a.s.step,step);assert(a.s.next>=60*RATE);
});

test('independent weights, compatibility composition selector, mute and density controls',()=>{
  for(let i=0;i<4;i++){
    const explicit=collect(style(i),180).events,legacy=collect({composition:i},180).events;
    assert.deepEqual(explicit,legacy,`composition${i}`);
  }
  assert.equal(collect(style(0,{ambient:0}),120).events.length,0);
  const drums=collect(style(0,{ambient:0,drumsEnabled:true,density:1,complexity:1}),120).events;
  assert(drums.length>0&&drums.every(e=>e[1]>=5));assert.equal(new Set(drums.map(e=>e[1])).size,5);
  for(let i=0;i<4;i++){
    const mute=collect(style(i,{melodyEnabled:false,density:1,complexity:.8}),180).events;
    assert(mute.length>0&&!mute.some(e=>e[1]===1||e[1]===2));assert(mute.some(e=>e[1]===0)&&mute.some(e=>e[1]===3)&&mute.some(e=>e[1]===4));
    const low=collect(style(i,{density:0}),180).events,high=collect(style(i,{density:1}),180).events;
    assert(melodicCount(high)>melodicCount(low),`density style${i}`);
  }
  const all={...BASE,counterpoint:.7,rhythmic:.6,arpeggio:.8,density:.8,complexity:.9};
  const mixed=collect(all,180).events;
  for(const key of STYLES)assert.notEqual(musicalFingerprint(mixed),musicalFingerprint(collect({...all,[key]:0},180).events),`inaudible weight ${key}`);
  assert.notEqual(musicalFingerprint(collect(style(1,{complexity:0}),180).events),musicalFingerprint(collect(style(1,{complexity:1}),180).events));
});

test('swing preserves each complete quarter; pause shifts absolute deadlines without musical catch-up',()=>{
  for(const bpm of [30,72,137.25,180])for(const swing of [0,.5,1]){
    const s=new DevelopmentScore(RATE,17),p=style(2,{bpm,swing}),sink={noteOn(){}};
    for(let i=0;i<120;i++)s.advanceTo(s.next,p,sink);
    assert.equal(s.tick,120);assert(Math.abs(s.beatNext-RATE*60/bpm*10)<1e-7);
  }
  const s=new DevelopmentScore(RATE,17),p=style(2),events=[],sink={noteOn(...e){events.push(e);}};
  s.advanceTo(RATE,p,sink);const before=s.next,tick=s.tick,time=s.elapsedFrames,harmony=s.chordChanges;
  s.beatNext+=2*RATE;assert.equal(s.next,before+2*RATE);
  s.advanceTo(before+2*RATE-1,p,sink);assert.equal(s.tick,tick);assert.equal(s.elapsedFrames,time);assert.equal(s.chordChanges,harmony);
  s.advanceTo(before+2*RATE,p,sink);assert.equal(s.tick,tick+1);assert(s.elapsedFrames>time);
});

test('finite ranges, scale coherence, per-tick cap and renderer-compatible polyphony',()=>{
  for(const polyphony of [8,16,24,32])for(const rate of [8000,192000]){
    const p={...BASE,ambient:1,counterpoint:1,rhythmic:1,arpeggio:1,bpm:180,density:1,complexity:1,evolution:1,swing:1,polyphony,drumsEnabled:true};
    const {s,events}=collect(p,180,polyphony,rate),bounds=[];let previous=-1,atCount=0,maxAt=0,second=-1,secondCount=0,maxPerSecond=0;
    for(const e of events){checkEvent(s,e,previous);if(e[0]===previous)atCount++;else atCount=1;maxAt=Math.max(maxAt,atCount);previous=e[0];
      const sec=Math.floor(e[0]/rate);if(sec===second)secondCount++;else{second=sec;secondCount=1;}maxPerSecond=Math.max(maxPerSecond,secondCount);
      const k=e[1],tail=k===0?4:k===3?2:k>=5?.08:.3,group=k<5?0:1;
      bounds.push([e[0],1,group],[e[0]+e[3]+Math.round(rate*tail),-1,group]);
    }
    bounds.sort((a,b)=>a[0]-b[0]||a[1]-b[1]);const active=[0,0],max=[0,0];
    for(const [,delta,group]of bounds){active[group]+=delta;max[group]=Math.max(max[group],active[group]);assert(active[group]>=0);}
    assert(max[0]<=polyphony,`melodic ${max[0]}/${polyphony}`);assert(max[1]<=12);assert.deepEqual(active,[0,0]);
    assert(maxAt<=12);assert(maxPerSecond<=64,`dense note rate ${maxPerSecond}/s`);assert(s.suppressedEvents>=0);
  }
});

test('three-hour ambient minimum evolution retains genuinely slow harmony; fast evolution moves',()=>{
  const slow=collect(BASE,10800,91),chunked=collect(BASE,10800,91,RATE,71*RATE),fast=collect({...BASE,evolution:1},600,91);
  assert.equal(slow.s.chordChanges,2);assert.deepEqual(slow.events,chunked.events);assert.equal(slow.s.eventCount,slow.events.length);
  assert(fast.s.chordChanges>=35);assert(slow.events.length<5000);assert(slow.events.some(e=>e[0]>10770*RATE));
  console.log(`ambient 3h: ${slow.events.length} events, ${slow.s.chordChanges} harmony changes; evolving 10m: ${fast.s.chordChanges} changes`);
});

test('zero-evolution ambient preserves three distinct harmonic fields for every seed',()=>{
  const sink={noteOn(){}};
  for(let seed=0;seed<=64;seed++){
    const s=new DevelopmentScore(RATE,seed),chords=[];
    s.advanceTo(0,BASE,sink);chords.push(s.chord);
    s.advanceTo(3601*RATE,BASE,sink);chords.push(s.chord);
    s.advanceTo(7202*RATE,BASE,sink);chords.push(s.chord);
    s.advanceTo(10800*RATE-1,BASE,sink);
    assert.deepEqual(chords,[0,2,3]);assert.equal(s.chordChanges,2);
  }
});

test('eight hours remain continuous, bounded and developing instead of replaying finite clips',()=>{
  const s=new DevelopmentScore(RATE,431),p={...style(1,{density:.8,complexity:.9,evolution:.7,bpm:113,swing:.6}),arpeggio:.35,drumsEnabled:true};
  const arrays=Object.values(s).filter(ArrayBuffer.isView),hashes=[],chords=[];let count=0,previous=-1;
  for(let hour=0;hour<8;hour++){
    const hash=createHash('sha256');
    s.advanceTo((hour+1)*3600*RATE-1,p,{noteOn(...e){checkEvent(s,e,previous);previous=e[0];count++;hash.update(e.join(','));}});
    hashes.push(hash.digest('hex'));chords.push(s.chordChanges);
  }
  assert.equal(new Set(hashes).size,8);assert.equal(s.eventCount,count);assert(s.next>=8*3600*RATE);assert(previous>8*3600*RATE-10*RATE);
  assert(chords.every((c,i)=>i===0||c>chords[i-1]));assert.deepEqual(Object.values(s).filter(ArrayBuffer.isView),arrays);
  assert(s.phrase>500&&s.step>500000);assert(s.harmonicStep>1000);assert.equal(s.chordChanges,s.harmonicStep);
  console.log(`continuous 8h: ${count} events, ${s.step} ticks, ${s.phrase} phrases, ${s.chordChanges} harmony changes; ${s.suppressedEvents} safely budgeted omissions`);
});
