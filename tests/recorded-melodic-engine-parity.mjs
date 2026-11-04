// SPDX-License-Identifier: AGPL-3.0-only
// Run only once the selected root has the integrated createInstrumentEngine.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const [root,out,factoryPath='docs/instrument-engine.js']=process.argv.slice(2);
if(!root||!out)throw Error('Usage: node tests/recorded-melodic-engine-parity.mjs JS_ROOT VECTOR_DIR [FACTORY_RELATIVE_PATH]');
const load=path=>import(pathToFileURL(resolve(root,path)));
const {createInstrumentEngine}=await load(factoryPath);
const {prepareMelodicBank}=await load('docs/melodic-bank.js');
const {prepareDrumBank}=await load('docs/drum-bank.js');
const base=new URL('https://sou1-fixtures.invalid/');
const fetcher=async input=>{const url=new URL(input);assert.equal(url.origin,base.origin);assert.ok(!url.search&&!url.hash);const relative=decodeURIComponent(url.pathname.slice(1));assert.ok(!relative.split('/').some(p=>!p||p==='..'||p==='.'));return new Response(await readFile(resolve(root,'docs',relative)));};
function knobs(phase){return {intensity:.82,brightness:.68,motion:.61,timbre:.43,warmth:.3,strength:.2,width:.7,wash:.25,pad:.65,pluck:.55,bell:.35,texture:.20,pulse:.15,evolution:.8,rainType:2,rain:.12,thunder:.05,wind:.07,composition:0,bpm:phase===0?112:180,polyphony:24,melodyEnabled:true,drumsEnabled:true,kick:.8,snare:.7,hihat:.6,toms:.5,cymbal:.4,ambient:.15,counterpoint:.6,rhythmic:1,arpeggio:.35,density:.85,complexity:.85,swing:.37};}
function routing(e){
 const totals=e.melodicStats;
 const names={accepted:'recordedMelodicAccepted',dropped:'recordedMelodicDropped',unmapped:'recordedMelodicUnmapped',fallbacks:'melodicFallbacks'};
 const get=(method,key)=>typeof e[method]==='function'?e[method]():totals?.[key]??e[names[key]];
 const active=typeof e.getActiveRecordedMelodicVoiceCount==='function'?e.getActiveRecordedMelodicVoiceCount():e.recordedMelodies?.activeVoices;
 const totalActive=typeof e.getActiveVoiceCount==='function'?e.getActiveVoiceCount():typeof e.getActiveMelodicVoiceCount==='function'?e.getActiveMelodicVoiceCount():active+e.voices.filter(v=>v.active).length;
 const value={accepted:get('getRecordedMelodicAcceptedCount','accepted'),dropped:get('getRecordedMelodicDroppedCount','dropped'),unmapped:get('getRecordedMelodicUnmappedCount','unmapped'),fallbacks:get('getMelodicFallbackCount','fallbacks'),active,totalActive};
 for(const [key,n] of Object.entries(value))assert.ok(Number.isSafeInteger(n)&&n>=0,`Missing/invalid routing diagnostic ${key}`);
 return value;
}
let compared=0,exact=0,max=0;
for(const rate of [44100,48000]){
 const drums=await prepareDrumBank('fsa-x0xproc2',rate,{fetcher,assetBaseUrl:new URL('audio-kit/',base)});
 for(const preset of ['chamber','piano-room','chamber-flute']){
  const melody=await prepareMelodicBank(preset,rate,{fetcher,assetBaseUrl:new URL('melodic-assets/',base)});
  const name=`${rate}-${preset}`,pcm=await readFile(resolve(out,name+'.f32')),history=JSON.parse(await readFile(resolve(out,name+'.history.json'),'utf8')),evidence=JSON.parse(await readFile(resolve(out,name+'.stats.json'),'utf8'));
  assert.equal(melody.report.manifestSha256,evidence.melodicManifestSha256);assert.equal(melody.report.encodedBytes,evidence.melodicEncodedBytes);assert.equal(melody.report.decodedBytes,evidence.melodicDecodedBytes);
  assert.equal(drums.report.preparedBytes,evidence.drumPreparedBytes);assert.deepEqual(drums.report.banks,evidence.drumSources);
  const e=createInstrumentEngine(rate,7311,{scoreMode:'developing',scoreConfig:{},drumBank:drums.wireBank,melodicBank:melody.wireBank});
  const events=[],noteOn=e.noteOn.bind(e);e.noteOn=(...event)=>{events.push(event.slice(0,5));return noteOn(...event);};
  e.setParameters(knobs(0));e.start();const boundaries=[rate*2,rate*4,rate*6,rate*8],snapshots=[];let boundary=0,energy=0;
  for(let at=0;at<rate*8;){
   if(at===rate*2)e.setParameters(knobs(1));if(at===rate*4)e.setParameters(knobs(0));if(at===rate*6)e.stop();
   while(boundaries[boundary]<=at)boundary++;
   const frames=Math.min(128,boundaries[boundary]-at),left=new Float32Array(frames),right=new Float32Array(frames);e.render(left,right);
   for(let i=0;i<frames;i++)for(let c=0;c<2;c++){
    const js=c===0?left[i]:right[i],native=pcm.readFloatLE(((at+i)*2+c)*4),difference=Math.abs(js-native);
    assert.ok(Number.isFinite(js)&&Math.abs(js)<.85,`${name} boundedJS PCM`);
    assert.ok(difference<=1e-7,`${name} frame${at+i} ch${c} native=${native} JS=${js} delta=${difference}`);
    compared++;if(js===native)exact++;max=Math.max(max,difference);energy+=js*js;
   }
   at+=frames;if(at===boundaries[boundary])snapshots.push({frame:e.frame,stats:routing(e)});
  }
  assert.ok(energy>1);assert.deepEqual(events.slice(-512),history.events,`${name} exact generated event history`);assert.equal(e.frame,history.frame);
  assert.deepEqual(snapshots,evidence.snapshots,`${name} routing/voice counters at every control boundary`);assert.deepEqual(routing(e),evidence.stats);
  console.log(`PASS real melodic+drum JVM/JS ${name}: boundedPCM, exact source histories and routing/voice counters, exact source hashes`);
 }
}
console.log(`PASS real melodic+recordeddrum JS/JVM PCM: ${compared} stereo samples; ${exact} bit-identical; max absolute difference ${max}, tolerance1e-7. JVM/Node only, no Android/browser device claim.`);
