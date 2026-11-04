// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import test from 'node:test';
const configSource=await readFile(new URL('../docs/development-config.js',import.meta.url),'utf8');
const configURL=`data:text/javascript;base64,${Buffer.from(configSource).toString('base64')}`;
const {DEVELOPMENT_CONFIG_DEFAULTS:DEFAULT_CONFIG,normalizeDevelopmentConfig:normalize,deterministicRandomConfig:randomConfig}=await import(configURL);
const source=(await readFile(new URL('../docs/development-score.js',import.meta.url),'utf8')).replace("'./development-config.js'",JSON.stringify(configURL));
const {DevelopmentScore}=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const frozenSource=await readFile(new URL('./fixtures/development-score-v1.js',import.meta.url),'utf8');
assert.equal(createHash('sha256').update(frozenSource).digest('hex'),'9f42469d8b18d5d7e358722d83fd92290956a184a68f9af8c19046e651ed9edb','v1 comparator fixture must be the saved, immutable original');
const {DevelopmentScore:FrozenScore}=await import(`data:text/javascript;base64,${Buffer.from(frozenSource).toString('base64')}`);
const BASE={ambient:1,counterpoint:0,rhythmic:0,arpeggio:0,density:.7,complexity:.8,evolution:.6,bpm:120,swing:0,melodyEnabled:true,drumsEnabled:true,polyphony:32};
const style=(i,extra={})=>({...BASE,ambient:0,counterpoint:0,rhythmic:0,arpeggio:0,[['ambient','counterpoint','rhythmic','arpeggio'][i]]:1,...extra});
function collect(config=DEFAULT_CONFIG,p=BASE,seed=91,seconds=120,rate=8000,chunk=0,Class=DevelopmentScore){
  const s=new Class(rate,seed,config),events=[],sink={noteOn(...e){events.push(e);}},end=seconds*rate-1;
  if(chunk)for(let f=0;f<end;f+=chunk)s.advanceTo(f,p,sink);
  s.advanceTo(end,p,sink);return{s,events};
}
const digest=e=>createHash('sha256').update(JSON.stringify(e)).digest('hex');
const scales=[[0,2,4,5,7,9,11],[0,2,3,5,7,9,10],[0,2,3,5,7,8,10],[0,2,4,5,7,9,10],[0,2,4,6,7,9,11],[0,1,3,5,7,8,10],[0,2,3,5,7,8,11]];
const sink={noteOn(){}};

test('closed immutable config schema and caller-data isolation',()=>{
  assert(Object.isFrozen(DEFAULT_CONFIG));assert.equal(normalize(),DEFAULT_CONFIG);
  const input={tonic:11,mode:6,meter:5,rhythmFamily:7,arpStrategy:7,drumPattern:7,harmony:'modulating',drumVariation:.35};
  const config=normalize(input);assert(Object.isFrozen(config));assert.deepEqual(config,input);input.tonic=0;assert.equal(config.tonic,11);
  const s=new DevelopmentScore(8000,91,input);input.mode=0;assert.equal(s.config.mode,6);
  assert.throws(()=>{s.config=DEFAULT_CONFIG;},TypeError);
  for(const value of [null,[],1,'seed',false])assert.throws(()=>normalize(value),TypeError);
  for(const [key,max] of [['tonic',11],['mode',6],['meter',5],['rhythmFamily',7],['arpStrategy',7],['drumPattern',7]]){
    for(const value of [-1,max+1,.5,NaN,Infinity,'0',null,undefined])assert.throws(()=>normalize({[key]:value}),RangeError,`${key}=${value}`);
  }
  for(const value of [-.01,1.01,NaN,Infinity,'seed',undefined])assert.throws(()=>normalize({drumVariation:value}),RangeError);
  for(const value of ['seed','cycle',0,null,undefined])assert.throws(()=>normalize({harmony:value}),RangeError);
  assert.throws(()=>normalize({unknown:1}),RangeError);
  assert.throws(()=>normalize({[Symbol('unknown')]:1}),RangeError);
  assert.throws(()=>normalize(Object.defineProperty({},'unknown',{value:1})),RangeError);
});

test('default events exactly match frozen v1, not a second call to the new implementation',()=>{
  let total=0,cases=0;
  for(const rate of [8000,44100,48000,192000])for(const seed of [0,1,17,91,431,2147483648,4294967295])for(let i=0;i<4;i++){
    const p=style(i,{bpm:[30,72,137,180][i],swing:.73,density:.86,complexity:.91,polyphony:16});
    const old=collect(DEFAULT_CONFIG,p,seed,90,rate,0,FrozenScore),current=collect(DEFAULT_CONFIG,p,seed,90,rate);
    assert.deepEqual(current.events,old.events,`rate${rate}, seed${seed}, style${i}`);
    for(const key of ['beatNext','next','elapsedFrames','step','tick','chord','chordChanges','eventCount','suppressedEvents','root','mode','meterTicks','phrase'])assert.equal(current.s[key],old.s[key],key);
    total+=current.events.length;cases++;
  }
  for(const seed of [0,17,91]){
    const p={...BASE,evolution:0,drumsEnabled:false};
    assert.deepEqual(collect(DEFAULT_CONFIG,p,seed,10800).events,collect(DEFAULT_CONFIG,p,seed,10800,8000,0,FrozenScore).events);cases++;
  }
  console.log(`default v1 identity: ${cases} cases, ${total} events plus three 3h runs`);
});

test('manual selectors survive reseed and all phrase development',()=>{
  const config={tonic:9,mode:1,meter:3,rhythmFamily:5,arpStrategy:6,drumPattern:2,harmony:'progression',drumVariation:1};
  const s=new DevelopmentScore(8000,91,config),p=style(3,{complexity:1,evolution:1});
  const check=()=>{assert.equal(s.anchorRoot,57);assert.equal(s.root,57);assert.equal(s.mode,1);assert.equal(s.meterTicks,42);assert.equal(s.family,5);assert.equal(s.rhythmFamily,5);assert.equal(s.arpStrategy,6);assert.equal(s.arpKind,6);assert.equal(s.drumFamily,2);};
  for(const seed of [91,0,1,4294967295]){s.reseed(seed);for(let i=0;i<50;i++){s.advanceTo((i+1)*8000*15-1,p,sink);check();}assert(s.chordChanges>10);}
  assert.deepEqual(s.config,normalize(config));
  const automatic=new Set();for(let seed=0;seed<32;seed++){s.reseed(seed);const a=new DevelopmentScore(8000,seed);automatic.add([a.root,a.mode,a.meterTicks].join(':'));}assert(automatic.size>24);
});

test('fixed/progression policies keep tonic and mode; fixed holds chord zero indefinitely',()=>{
  for(const harmony of ['fixed','progression'])for(const tonic of [0,5,11]){
    const s=new DevelopmentScore(8000,71,{tonic,mode:4,meter:0,harmony});
    s.advanceTo(3*3600*8000-1,style(1,{complexity:1,evolution:1}),{noteOn(at,k,pitch){if(k<5)assert(scales[4].includes(((pitch-(48+tonic))%12+12)%12));assert.equal(s.root,48+tonic);assert.equal(s.mode,4);}});
    assert.equal(s.modulationChanges,0);
    if(harmony==='fixed'){assert.equal(s.chord,0);assert.equal(s.chordChanges,0);assert.equal(s.harmonicStep,0);}else assert(s.chordChanges>1000);
  }
});

test('modulation visits a related tonic and returns to immutable anchor on bounded phrase boundaries',()=>{
  for(const evolution of [0,.4,1])for(const tonic of [0,5,11]){
    const s=new DevelopmentScore(8000,91,{tonic,mode:2,meter:0,harmony:'modulating'}),p=style(1,{evolution}),span=4+Math.floor((1-evolution)*12);
    let previousRoot=s.root,changes=0,lastPhrase=0;
    while(changes<6){
      const tick=s.barTick,phraseBar=s.phraseBar,phrase=s.phrase;
      s.advanceTo(s.next,p,{noteOn(at,k,pitch){if(k<5)assert(scales[s.mode].includes(((pitch-s.root)%12+12)%12));}});
      if(s.root!==previousRoot){
        assert.equal(tick,0);assert.equal(phraseBar,0);assert.equal(phrase-lastPhrase,span);lastPhrase=phrase;
        changes++;const distance=((s.root-s.anchorRoot)%12+12)%12;
        if(changes%2===1)assert(distance===5||distance===7);else assert.equal(s.root,s.anchorRoot);
        previousRoot=s.root;
      }
    }
    assert.equal(s.modulationChanges,6);assert.equal(s.config.tonic,tonic);assert.equal(s.anchorRoot,48+tonic);assert.equal(s.mode,2);
  }
});

test('eight independent drum patterns change MIDI; melodic rhythm and drum selectors remain independent',()=>{
  const p=style(1,{density:.8,complexity:.8}),drumHashes=new Set();let melody=null;
  for(let drumPattern=0;drumPattern<8;drumPattern++){
    const {events}=collect({drumPattern,drumVariation:0,meter:0},p,91,120);
    const pitched=events.filter(e=>e[1]<5),drums=events.filter(e=>e[1]>=5);
    if(melody===null)melody=pitched;else assert.deepEqual(pitched,melody);
    drumHashes.add(digest(drums));assert(drums.length>20);
  }
  assert.equal(drumHashes.size,8);
  for(const drumPattern of ['seed',0,3,7]){
    let percussion=null;const melodyHashes=new Set();
    for(let rhythmFamily=0;rhythmFamily<8;rhythmFamily++){
      const {events}=collect({drumPattern,rhythmFamily,meter:0},p,91,120);
      const drums=events.filter(e=>e[1]>=5);if(percussion===null)percussion=drums;else assert.deepEqual(drums,percussion);
      melodyHashes.add(digest(events.filter(e=>e[1]<5)));
    }
    assert(melodyHashes.size>=6);
  }
});

test('zero drum variation repeats unchanged bars, with no phrase fill, cymbal or phrase dynamics',()=>{
  const p=style(0,{ambient:0,density:1,complexity:1,evolution:1,bpm:120,swing:0});
  for(const drumPattern of ['seed',0,1,2,3,4,5,6,7]){
    const {events}=collect({drumPattern,drumVariation:0,meter:0},p,91,120),bars=[];
    for(let i=0;i<60;i++)bars.push(events.filter(e=>Math.floor(e[0]/16000)===i).map(e=>[e[0]-i*16000,...e.slice(1)]));
    for(let i=1;i<bars.length;i++)assert.deepEqual(bars[i],bars[0],`pattern${drumPattern}, bar${i}`);
    assert(!events.some(e=>e[1]===9));if(drumPattern!==7)assert(!events.some(e=>e[1]===8));
  }
  assert.notEqual(digest(collect({drumPattern:2,drumVariation:0,meter:0},p,91,120).events),digest(collect({drumPattern:2,drumVariation:1,meter:0},p,91,120).events));
});

test('random combinations are seeded, independent per field and preserve every locked value',()=>{
  const base=normalize({tonic:11,mode:5,meter:4,rhythmFamily:7,arpStrategy:2,drumPattern:6,harmony:'fixed',drumVariation:0});
  const keys=Object.keys(DEFAULT_CONFIG),combinations=new Set();
  for(let seed=0;seed<256;seed++){
    const a=randomConfig(seed,base),b=randomConfig(seed,base);assert.deepEqual(a,b);assert(Object.isFrozen(a));assert.deepEqual(normalize(a),a);combinations.add(JSON.stringify(a));
    for(const locked of keys){
      const c=randomConfig(seed,base,{[locked]:true});assert.equal(c[locked],base[locked]);
      for(const other of keys)if(other!==locked)assert.equal(c[other],a[other]);
    }
  }
  assert.equal(combinations.size,256);
  const locks=Object.fromEntries(keys.map(k=>[k,true]));assert.deepEqual(randomConfig(18,base,locks),base);
  assert.equal(randomConfig(18,DEFAULT_CONFIG,{tonic:true}).tonic,'seed');
  for(const bad of [NaN,Infinity])assert.throws(()=>randomConfig(bad),RangeError);
  for(const bad of [null,[],1])assert.throws(()=>randomConfig(1,base,bad),TypeError);
  assert.throws(()=>randomConfig(1,base,{unknown:true}),RangeError);
  assert.throws(()=>randomConfig(1,base,{[Symbol('unknown')]:true}),RangeError);
  assert.deepEqual(randomConfig(1,base,Object.create({tonic:true})),randomConfig(1,base));
  for(const bad of [1,'true',null,undefined])assert.throws(()=>randomConfig(1,base,{tonic:bad}),TypeError);
});

test('configured clocks are chunk invariant across rates and preserve event/range/voice bounds',()=>{
  for(const rate of [8000,44100,48000,192000])for(let drumPattern=0;drumPattern<8;drumPattern++){
    const config={tonic:drumPattern,mode:drumPattern%7,meter:drumPattern%6,rhythmFamily:drumPattern,arpStrategy:7-drumPattern,drumPattern,harmony:'modulating',drumVariation:drumPattern/7};
    const p=style(3,{counterpoint:.5,complexity:1,density:1,evolution:1,bpm:173,swing:.87,polyphony:16});
    const a=collect(config,p,811,90,rate),b=collect(config,p,811,90,rate,919);assert.deepEqual(a.events,b.events);
    const bounds=[];let previous=-1,atCount=0;
    for(const e of a.events){
      const [at,k,pitch,duration,velocity,pan]=e;assert(Number.isInteger(at)&&at>=previous);atCount=at===previous?atCount+1:1;assert(atCount<=12);previous=at;
      assert(Number.isInteger(pitch)&&pitch>=33&&pitch<=88);assert(Number.isInteger(duration)&&duration>0&&duration<=32*rate);
      assert(Number.isFinite(velocity)&&velocity>=.005&&velocity<=1);assert(Number.isFinite(pan)&&pan>=.15&&pan<=.85);
      const tail=k===0?4:k===3?2:k>=5?.08:.3;bounds.push([at,1,k<5?0:1],[at+duration+Math.round(rate*tail),-1,k<5?0:1]);
    }
    bounds.sort((a,b)=>a[0]-b[0]||a[1]-b[1]);const active=[0,0];for(const [,d,k]of bounds){active[k]+=d;assert(active[k]>=0&&active[k]<=(k===0?16:12));}assert.deepEqual(active,[0,0]);
  }
});
