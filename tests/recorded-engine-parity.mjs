// SPDX-License-Identifier: AGPL-3.0-only
// Synthetic banks and a pure-JVM/Node comparison, not Android/browser device QA.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const dataUrl=source=>`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const environment=dataUrl(await readFile(new URL('../docs/environment-audio.js',import.meta.url),'utf8'));
const engine=dataUrl((await readFile(new URL('../docs/audio-engine.js',import.meta.url),'utf8')).replace("'./environment-audio.js'",JSON.stringify(environment)));
const pool=dataUrl(await readFile(new URL('../docs/live-drum-pool.js',import.meta.url),'utf8'));
const {RecordedDrumEngine}=await import(dataUrl((await readFile(new URL('../docs/recorded-drum-engine.js',import.meta.url),'utf8')).replace("'./audio-engine.js'",JSON.stringify(engine)).replace("'./live-drum-pool.js'",JSON.stringify(pool))));
const ids=['kick','snare','closed-hat','toms','short-clash'];
const zone=(sampleIndex,keyLow=0,keyHigh=127)=>({sampleIndex,keyLow,keyHigh,velocityLow:0,velocityHigh:1});
function bank(rate){return {sampleRate:rate,
 samples:Array.from({length:6},(_,j)=>Float32Array.from({length:Math.floor(rate/2)},(_,i)=>(((i*13+j*11)%97)-48)/61)),
 instruments:ids.map((id,i)=>({id,gain:.6+i/20,oneShot:true,chokeGroup:i===2||i===4?'metal':null,
  zones:i===3?[zone(3,45,45),zone(4,47,47),zone(5,49,49)]:i===1?[zone(1),zone(2)]:[zone(i)]}))};}
function parameters(enabled,wet,gains){return {intensity:.82,brightness:.68,motion:.61,timbre:.43,
 warmth:wet?.8:0,strength:wet?.4:0,width:wet?.9:.5,wash:wet?.65:0,
 pad:0,pluck:0,bell:0,texture:0,pulse:0,evolution:.6,rainType:wet?2:0,rain:wet?.3:0,thunder:wet?.2:0,wind:wet?.4:0,
 composition:2,bpm:137,polyphony:24,melodyEnabled:false,drumsEnabled:enabled,
 kick:gains===0?.8:.1,snare:gains===0?.7:.2,hihat:gains===0?.6:.3,toms:gains===0?.5:.4,cymbal:gains===0?.4:.5,
 ambient:0,counterpoint:0,rhythmic:0,arpeggio:0,density:.8,complexity:.9,swing:.37};}
let compared=0,exact=0,max=0;
for(const rate of [8000,44100,48000])for(const wet of [false,true]){
 const name=`${rate}-${wet?'wet':'dry'}`,buffer=await readFile(resolve(process.argv[2],`${name}.f32`)),native=new DataView(buffer.buffer,buffer.byteOffset,buffer.byteLength);
 const score=JSON.parse(await readFile(resolve(process.argv[2],`${name}.json`),'utf8'));
 const engine=new RecordedDrumEngine(rate,7311,bank(rate)),events=[];
 const note=engine.noteOn.bind(engine);engine.noteOn=(...event)=>{events.push(event.slice(0,5));note(...event);};
 engine.setParameters(parameters(true,wet,0));engine.start();
 const total=rate*6,boundaries=[rate,rate*2,Math.floor(rate*9/4),rate*3,total];let boundary=0,energy=0;
 for(let at=0;at<total;){
  if(at===rate)engine.setParameters(parameters(true,wet,1));
  if(at===rate*2)engine.setParameters(parameters(false,wet,1));
  if(at===Math.floor(rate*9/4))engine.setParameters(parameters(true,wet,1));
  if(at===rate*3)engine.stop();
  while(boundaries[boundary]<=at)boundary++;
  const frames=Math.min(128,boundaries[boundary]-at),left=new Float32Array(frames),right=new Float32Array(frames);engine.render(left,right);
  for(let i=0;i<frames;i++)for(let c=0;c<2;c++){
   const js=(c===0?left:right)[i],java=native.getFloat32(((at+i)*2+c)*4,true),delta=Math.abs(js-java);
   assert.ok(Number.isFinite(java)&&Math.abs(java)<.85,`${name} finite limited PCM`);
   assert.ok(delta<=1e-7,`${name} frame ${at+i} channel ${c}: ${java} != ${js}; ${delta}`);
   compared++;if(java===js)exact++;max=Math.max(max,delta);energy+=java*java;
  }
  at+=frames;
 }
 assert.ok(energy>1,`${name} audible`);assert.deepEqual(score.events,events,`${name} exact generated event timing/layer/pitch/gate/velocity`);
 assert.equal(score.frame,engine.frame,`${name} transport frame`);assert.equal(engine.recordedDrums.activeVoices,0);
 console.log(`PASS ${name}: ${total} stereo frames, ${events.length} score events, macros/weather/gain/mute/stop parity`);
}
console.log(`PASS recorded JS/JVM integration: ${compared} samples, ${exact} bit-identical, max absolute difference ${max}`);
for(const rate of [8000,44100,48000]){
 const engine=new RecordedDrumEngine(rate,91,bank(rate));engine.setParameters(parameters(true,true,0));
 const left=new Float32Array(1),right=new Float32Array(1);
 engine.start();engine.render(left,right);assert.ok(engine.recordedDrums.activeVoices>0);
 engine.stop();engine.render(left,right);assert.equal(engine.isSilent(),true);assert.equal(engine.recordedDrums.activeVoices,0);
 assert.equal(engine.recordedDrums.enabled,true);const frame=engine.frame;
 engine.render(new Float32Array(128),new Float32Array(128));assert.equal(engine.frame,frame);
 engine.start();engine.render(left,right);assert.equal(engine.recordedDrums.activeVoices,0);
}
console.log('PASS JS/native matching early-stop cleanup regression at 8/44.1/48 kHz');
