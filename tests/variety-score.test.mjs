// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,mkdtemp,writeFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {composeVarietyPlan,validateVarietyOptions,VarietyScore,VARIETY_STYLES,MODES} from '../tools/composition/variety-score.mjs';
import {summarizeVariety,compareVariety} from '../tools/composition/variety-metrics.mjs';
import {renderVarietyCue} from '../tools/render-variety-cue.mjs';
import {ENGINE_SHA,ENV_SHA} from '../tools/instruments/event-score-core.mjs';
import {validateEvent} from '../tools/instruments/rack.mjs';
const styles=Object.keys(VARIETY_STYLES),digest=x=>createHash('sha256').update(x).digest('hex');
const exec=promisify(execFile),cli=fileURLToPath(new URL('../tools/render-variety-cue.mjs',import.meta.url));
test('six strategies change meter, musical texture, harmony and phrase form',()=>{
  const plans=styles.map(style=>composeVarietyPlan({style}));
  assert.deepEqual(plans.map(p=>p.meter.join('/')),['4/4','3/4','4/4','7/8','4/4','6/8']);
  assert.equal(new Set(plans.map(p=>JSON.stringify(p.motif))).size,6);
  assert.ok(new Set(plans.map(p=>JSON.stringify(p.barPlan.map(b=>b.chordDegree)))).size>=5);
  for(const p of plans){assert.deepEqual(p.barPlan.filter(b=>b.position===0).map(b=>b.section),VARIETY_STYLES[p.options.style].form);assert.equal(p.barPlan.at(-1).cadence,'tonic');assert.equal(p.barPlan.at(-1).chordDegree,0);}
});
test('seed is deterministic and each strategy changes with independent seeds',()=>{
  for(const style of styles){const a=composeVarietyPlan({style,seed:31}),b=composeVarietyPlan({style,seed:31}),c=composeVarietyPlan({style,seed:32});assert.deepEqual(a,b);assert.notDeepEqual(a.sourceEvents,c.sourceEvents);assert.notDeepEqual(a.motif,c.motif);}
});
test('pairwise melodic and rhythm contrast survives fixed mode, BPM and instruments',()=>{
  for(const seed of [0,7311,0xffffffff]){
    const plans=styles.map(style=>composeVarietyPlan({style,seed,bpm:96,mode:'major',drums:false}));
    for(let i=0;i<plans.length;i++)for(let j=i+1;j<plans.length;j++){
      const diff=compareVariety(plans[i],plans[j]);assert.ok(diff.intervalTrigramDistance>.35,`${seed}: ${styles[i]}/${styles[j]} melody`);assert.ok(diff.rhythmTrigramDistance>.25,`${seed}: ${styles[i]}/${styles[j]} rhythm`);
    }
  }
});
test('changing mode changes pitch content, not source timing or identity',()=>{
  const a=composeVarietyPlan({style:'song',mode:'major'}),b=composeVarietyPlan({style:'song',mode:'phrygian'});
  assert.deepEqual(a.sourceEvents.map(e=>[e.frame,e.sourceInstrument]),b.sourceEvents.map(e=>[e.frame,e.sourceInstrument]));assert.notDeepEqual(a.sourceEvents.map(e=>e.pitch),b.sourceEvents.map(e=>e.pitch));
});
test('muting drums cannot perturb melody RNG and muting melody cannot perturb drums',()=>{
  for(const style of styles){const a=composeVarietyPlan({style,drums:true}),b=composeVarietyPlan({style,drums:false}),c=composeVarietyPlan({style,drums:true,melody:false});assert.deepEqual(a.sourceEvents.filter(e=>e.sourceInstrument<5),b.sourceEvents);assert.deepEqual(a.sourceEvents.filter(e=>e.sourceInstrument>=5),c.sourceEvents.filter(e=>e.sourceInstrument>=5));assert.ok(c.sourceEvents.every(e=>![1,2].includes(e.sourceInstrument)));}
});
test('sample rate changes preserve event identity and timing within one sample',()=>{
  for(const style of styles){const a=composeVarietyPlan({style,sampleRate:44100}),b=composeVarietyPlan({style,sampleRate:48000});assert.equal(a.sourceEvents.length,b.sourceEvents.length);a.sourceEvents.forEach((e,i)=>{const f=b.sourceEvents[i];for(const key of ['pitch','sourceInstrument','velocity','pan','bar','beat','role'])assert.equal(e[key],f[key]);assert.ok(Math.abs(e.frame/44100-f.frame/48000)<=1/44100);assert.ok(Math.abs(e.duration/44100-f.duration/48000)<=2/44100);});}
});
test('full bars, absolute timing, tonic closure and no event after active boundary',()=>{
  for(const style of styles){const p=composeVarietyPlan({style,bpm:137.25,bars:17});assert.equal(p.activeFrames,Math.round(17*p.beatsPerBar*60/137.25*48000));assert.equal(p.frames,p.activeFrames+96000);assert.ok(p.sourceEvents.every(e=>e.frame>=0&&e.frame<p.activeFrames&&e.duration>0&&e.frame+e.duration<=p.activeFrames));assert.ok(p.sourceEvents.filter(e=>e.bar===16&&e.role==='lead').at(-1).pitch%12===p.options.root%12);}
});
test('all routed events preserve source fields and have known instruments',()=>{
  for(const style of styles){const p=composeVarietyPlan({style});assert.equal(p.events.length,p.sourceEvents.length);assert.equal(p.audit.length,p.sourceEvents.length);p.events.forEach((e,i)=>{validateEvent(e);for(const k of ['frame','duration','pitch','velocity','pan'])assert.equal(e[k],p.sourceEvents[i][k]);if(e.instrument==='marimba')assert.ok(e.pitch>=60&&e.pitch<=91);});}
});
test('parameter extremes and all modes remain bounded and scale-safe',()=>{
  for(const style of styles)for(const seed of [0,1,0xffffffff])for(const mode of Object.keys(MODES)){
    const p=composeVarietyPlan({style,seed,mode,root:seed%2?48:71,bars:32,bpm:180,density:seed===0?0:1,variation:seed===0?0:1,drums:true});assert.ok(p.events.length<=4096);assert.ok(p.events.length>0);
    for(const e of p.sourceEvents.filter(e=>e.sourceInstrument<5))assert.ok(MODES[mode].includes(((e.pitch-p.options.root)%12+12)%12),`${style}/${mode}/${e.pitch}`);
  }
});
test('density sparsifies weak lead notes, retaining phrase anchors',()=>{for(const style of styles){const a=composeVarietyPlan({style,density:0}),b=composeVarietyPlan({style,density:1});const count=p=>p.sourceEvents.filter(e=>e.role==='lead').length;assert.ok(count(a)<count(b));assert.ok(count(a)>=a.options.bars);}});
test('drift has breathing space, canon actual delayed imitation, motor grouped bass',()=>{
  const a=composeVarietyPlan({style:'drift'});assert.ok(a.sourceEvents.filter(e=>e.role==='lead'&&e.bar%4===3).length<a.sourceEvents.filter(e=>e.role==='lead'&&e.bar%4===0).length);
  const b=composeVarietyPlan({style:'canon',density:1});assert.ok(b.sourceEvents.some(e=>e.role==='imitation'&&e.sourceInstrument===2));
  const c=composeVarietyPlan({style:'motor'});assert.deepEqual(c.sourceEvents.filter(e=>e.bar===0&&e.role==='grouped-bass').map(e=>e.beat),[0,1,2]);
});
test('section labels describe destination bars, including delayed imitations',()=>{for(const style of styles){const p=composeVarietyPlan({style,seed:1,density:1});for(const e of p.sourceEvents)assert.equal(e.section,p.barPlan[e.bar].section);}});
test('long drift chords release before a changed harmony, including the tonic ending',()=>{for(const bars of [3,8,15,16,17]){const p=composeVarietyPlan({style:'drift',bars});const fpb=p.options.sampleRate*60/p.options.bpm;for(const e of p.sourceEvents.filter(e=>e.sourceInstrument===0)){const change=p.barPlan.slice(e.bar+1).find(b=>b.chordDegree!==p.barPlan[e.bar].chordDegree);if(change)assert.ok(e.frame+e.duration<=Math.round(change.bar*p.beatsPerBar*fpb));}}});
test('inputs and exported definitions are immutable',()=>{const o={style:'broken',seed:71};const before=structuredClone(o);composeVarietyPlan(o);assert.deepEqual(o,before);assert.ok(Object.isFrozen(VARIETY_STYLES));assert.ok(Object.isFrozen(VARIETY_STYLES.broken.rhythms[0]));assert.ok(Object.isFrozen(MODES.major));assert.ok(Object.isFrozen(validateVarietyOptions(o)));});
test('unknown, non-finite, mistyped and over-budget options fail explicitly',()=>{
  for(const o of [null,[],{unknown:1},{style:'x'},{seed:-1},{seed:2**32},{seed:2.3},{bpm:NaN},{bpm:39},{bars:1},{bars:33},{bars:4.5},{sampleRate:8000},{mode:'__proto__'},{mode:[]},{root:47},{root:72},{density:-.1},{density:NaN},{variation:2},{drums:1},{melody:0},{outputGainDb:25},{style:'drift',bars:32,bpm:40}])assert.throws(()=>composeVarietyPlan(o));
});
test('incremental sink advancement and reset reproduce one-shot scalar events',()=>{
  const s=new VarietyScore(44100,51,{style:'canon',bars:4}),incremental=[],sink={noteOn(...e){incremental.push(e);}};
  for(let frame=0;frame<s.plan.frames;frame+=997)s.advanceTo(frame,sink);
  const direct=s.plan.sourceEvents.map(e=>[e.frame,e.sourceInstrument,e.pitch,e.duration,e.velocity,e.pan]);assert.deepEqual(incremental,direct);
  s.reset();const again=[];s.advanceTo(s.plan.frames,{noteOn(...e){again.push(e);}});assert.deepEqual(again,direct);assert.throws(()=>s.advanceTo(0,sink));assert.throws(()=>s.advanceTo(NaN,sink));
});
test('original DSP and environment remain byte-identical to pinned source',async()=>{assert.equal(digest(await readFile(new URL('../docs/audio-engine.js',import.meta.url))),ENGINE_SHA);assert.equal(digest(await readFile(new URL('../docs/environment-audio.js',import.meta.url))),ENV_SHA);});
test('metrics count source lead events and symmetric self/pair distances',()=>{const a=composeVarietyPlan(),b=composeVarietyPlan({style:'broken'}),m=summarizeVariety(a);assert.equal(m.leadNotes,a.sourceEvents.filter(e=>e.sourceInstrument===1).length);assert.equal(compareVariety(a,a).intervalTrigramDistance,0);assert.equal(compareVariety(a,a).rhythmTrigramDistance,0);assert.deepEqual(compareVariety(a,b),compareVariety(b,a));});
test('all styles render PCM24 without clipping, drops or unmapped voices',async()=>{
  for(const style of styles){const r=await renderVarietyCue({style,bars:2,bpm:140});assert.equal(r.wav.length,44+r.report.frames*6);assert.equal(r.wav.readUInt16LE(22),2);assert.equal(r.wav.readUInt16LE(34),24);assert.equal(r.report.rack.unmapped,0);assert.equal(r.report.rack.dropped,0);assert.equal(r.report.rack.activeVoices,0);assert.equal(r.report.rack.accepted,r.events.length);assert.equal(r.report.clippedSamples,0);assert.equal(r.report.nonfiniteSamples,0);assert.ok(r.wav.subarray(-512).every(x=>x===0));}
});
test('WAV output is block invariant and receipts replay byte exactly',async()=>{
  const o={style:'broken',bars:2,bpm:180,sampleRate:44100},a=await renderVarietyCue(o,1),b=await renderVarietyCue(o,257),c=await renderVarietyCue(o,2048,{rendererFiles:a.report.rendererFiles,sha256:a.report.sha256});assert.deepEqual(a.wav,b.wav);assert.deepEqual(a.wav,c.wav);assert.equal(c.report.replayVerified,true);
  await assert.rejects(()=>renderVarietyCue(o,256,{sha256:'0'.repeat(64)}),/not byte-identical/);await assert.rejects(()=>renderVarietyCue(o,256,{rendererFiles:{}}),/version differs/);
});
test('renderer guards block size and clipping, never silently normalizes',async()=>{await assert.rejects(()=>renderVarietyCue({},0));await assert.rejects(()=>renderVarietyCue({style:'broken',bars:2,outputGainDb:24}),/clipping/);});
test('CLI works from another cwd, supports exact replay and preserves existing output',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'sou1-variety-'));try{
    const cfg=join(dir,'input.json');await writeFile(cfg,JSON.stringify({style:'waltz',bars:2,bpm:180}));
    const base=join(dir,'Каталог с пробелом','first');const first=JSON.parse((await exec(process.execPath,[cli,cfg,base],{cwd:tmpdir()})).stdout);
    const other=join(dir,'again'),second=JSON.parse((await exec(process.execPath,[cli,'--replay',base+'.json',other])).stdout);assert.equal(first.sha256,second.sha256);assert.equal(second.replayVerified,true);
    const before=await readFile(base+'.wav');await assert.rejects(()=>exec(process.execPath,[cli,cfg,base]),e=>/Output exists/.test(e.stderr));assert.deepEqual(await readFile(base+'.wav'),before);
    const bad=join(dir,'bad.json');await writeFile(bad,JSON.stringify({schema:'bad'}));await assert.rejects(()=>exec(process.execPath,[cli,'--replay',bad,join(dir,'no')]));assert.ok(!(await readdir(dir)).includes('no.wav'));
  }finally{await rm(dir,{recursive:true,force:true});}
});
