import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {renderCue,validateOptions,wavHeader,saveCue,PROFILES} from '../tools/render-cue.mjs';

test('defaults and bounded settings',()=>{assert.equal(validateOptions().sampleRate,48000);assert.equal(validateOptions({seed:0}).seed,0);});
for(const bad of [null,[],{unknown:1},{duration:NaN},{duration:Infinity},{duration:-1},{duration:301},{sampleRate:44101},{seed:-1},{seed:2**32},{seed:1.5},{profile:'__proto__'},{profile:'constructor'},{outputGainDb:Infinity},{outputGainDb:25},{outputGainDb:-61},{profile:['pulse']},{profile:{toString:()=> 'pulse'}}]) test('reject '+JSON.stringify(bad),()=>assert.throws(()=>validateOptions(bad)));
test('WAV header is correct',()=>{const h=wavHeader(48000,48000);assert.equal(h.toString('ascii',0,4),'RIFF');assert.equal(h.readUInt16LE(22),2);assert.equal(h.readUInt16LE(34),24);assert.equal(h.readUInt32LE(40),288000);assert.throws(()=>wavHeader(2**32,48000));});
test('fixed seed and config produces identical non-clipping PCM and notes',async()=>{
 const cfg={sampleRate:8000,duration:4,seed:123,profile:'pulse'};
 const a=await renderCue(cfg),b=await renderCue(cfg);
 assert.deepEqual(a.wav,b.wav);assert.deepEqual(a.events,b.events);assert.equal(a.report.sha256,createHash('sha256').update(a.wav).digest('hex'));
 assert.equal(a.wav.length,44+32000*6);assert.equal(a.report.nonfiniteSamples,0);assert.equal(a.report.clippedSamples,0);assert(a.report.peak>0);assert(a.report.peak<1);
 assert.equal(a.wav.readIntLE(a.wav.length-3,3),0);assert.equal(a.wav.readIntLE(a.wav.length-6,3),0);
 assert(a.events.length>0);assert(a.events.every(x=>x.frame<16000));
 const c=await renderCue({...cfg,seed:124});assert.notEqual(a.report.sha256,c.report.sha256);
});
test('fractional requested duration rounds to exact sample count',async()=>{const x=await renderCue({duration:4.0123,sampleRate:8000});assert.equal(x.report.frames,32098);assert.equal(x.wav.readUInt32LE(40),32098*6);});
test('all profiles produce finite bounded audio',async()=>{for(const profile of ['documentary','nocturne','pulse']){const x=await renderCue({duration:4,sampleRate:8000,profile});assert.equal(x.report.clippedSamples,0);assert.equal(x.report.nonfiniteSamples,0);assert(x.report.peak>0);}});

test('profiles cannot mutate between deterministic renders',()=>{assert(Object.isFrozen(PROFILES));assert(Object.values(PROFILES).every(Object.isFrozen));assert.throws(()=>PROFILES.pulse.bpm=60);});
test('explicit output gain scales PCM; excessive gain fails',async()=>{const cfg={duration:4,sampleRate:8000,profile:'pulse'};const a=await renderCue(cfg),b=await renderCue({...cfg,outputGainDb:6});assert(Math.abs(b.report.peak/a.report.peak-10**.3)<1e-5);await assert.rejects(renderCue({...cfg,outputGainDb:24}),/clipping/);});
test('exclusive pair write preserves existing JSON without orphaning WAV',async()=>{const {mkdtemp,readFile,writeFile,access,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');const dir=await mkdtemp(join(tmpdir(),'sou1-test-'));const base=join(dir,'cue');try{await writeFile(base+'.json','prior');await assert.rejects(saveCue(base,{wav:Buffer.from('new'),report:{},events:[]}),e=>e.code==='EEXIST');assert.equal(await readFile(base+'.json','utf8'),'prior');await assert.rejects(access(base+'.wav'));}finally{await rm(dir,{recursive:true});}});
test('exclusive pair write preserves existing WAV and creates no JSON',async()=>{const {mkdtemp,readFile,writeFile,access,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');const dir=await mkdtemp(join(tmpdir(),'sou1-test-'));const base=join(dir,'cue');try{await writeFile(base+'.wav','prior');await assert.rejects(saveCue(base,{wav:Buffer.from('new'),report:{},events:[]}),e=>e.code==='EEXIST');assert.equal(await readFile(base+'.wav','utf8'),'prior');await assert.rejects(access(base+'.json'));}finally{await rm(dir,{recursive:true});}});
test('pair save completes with matching report',async()=>{const {mkdtemp,readFile,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');const dir=await mkdtemp(join(tmpdir(),'sou1-test-'));try{const x=await renderCue({duration:4,sampleRate:8000});await saveCue(join(dir,'cue'),x);assert.deepEqual(await readFile(join(dir,'cue.wav')),x.wav);assert.equal(JSON.parse(await readFile(join(dir,'cue.json'),'utf8')).sha256,x.report.sha256);}finally{await rm(dir,{recursive:true});}});
