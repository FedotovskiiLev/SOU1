#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-only
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
SOURCE=${DEVELOPING_ENGINE_ROOT:-$ROOT}
OUT=$(mktemp -d)
trap 'rm -rf "$OUT"' EXIT HUP INT TERM
if command -v javac >/dev/null 2>&1; then
    javac -source 17 -target 17 -Xlint:all,-options,-cast -Werror -d "$OUT" \
        "$SOURCE"/app/src/main/java/org/sou1/audio/*.java "$ROOT/tests/DevelopingEngineTest.java" "$SOURCE/tests/LegacyEnginePcmFixture.java"
else
    java -m jdk.compiler/com.sun.tools.javac.Main -source 17 -target 17 -Xlint:all,-options,-cast -Werror -d "$OUT" \
        "$SOURCE"/app/src/main/java/org/sou1/audio/*.java "$ROOT/tests/DevelopingEngineTest.java" "$SOURCE/tests/LegacyEnginePcmFixture.java"
fi
java -cp "$OUT" DevelopingEngineTest "$SOURCE/tests/legacy-engine-pcm.sha256"
java -cp "$OUT" DevelopingEngineTest vectors "$OUT"
node --input-type=module - "$SOURCE" "$OUT" <<'JS'
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const root=process.argv[2],out=process.argv[3];
const {createDevelopingEngine}=await import(pathToFileURL(resolve(root,'docs/developing-engine.js')));
function bank(rate){const zone=(sampleIndex,keyLow=0,keyHigh=127)=>({sampleIndex,keyLow,keyHigh,velocityLow:0,velocityHigh:1});return {sampleRate:rate,
  samples:Array.from({length:6},(_,j)=>Float32Array.from({length:rate/2},(_,i)=>(((i*13+j*11)%97)-48)/61)),
  instruments:['kick','snare','closed-hat','toms','short-clash'].map((id,i)=>({id,gain:.6+i/20,oneShot:true,chokeGroup:i===2||i===4?'metal':null,zones:i===3?[zone(3,45,45),zone(4,47,47),zone(5,49,49)]:i===1?[zone(1),zone(2)]:[zone(i)]}))};}
function knobs(phase,drumsEnabled){return {intensity:.82,brightness:.68,motion:.61,timbre:.43,warmth:.3,strength:.2,width:.7,wash:.25,pad:.65,pluck:.55,bell:.35,texture:.20,pulse:.15,evolution:.8,rainType:2,rain:.12,thunder:.05,wind:.07,
  composition:0,bpm:phase===0?112:phase===1?180:72,polyphony:phase===2?8:24,melodyEnabled:phase!==2,drumsEnabled,kick:.8,snare:.7,hihat:.6,toms:.5,cymbal:.4,ambient:.15,counterpoint:.6,rhythmic:1,arpeggio:.35,density:.85,complexity:.85,swing:.37};}
let compared=0,exact=0,max=0;
for(const rate of [44100,48000])for(const recorded of [false,true]){
  const name=`${rate}-${recorded?'recorded':'procedural'}`,pcm=await readFile(resolve(out,`${name}.f32`)),score=JSON.parse(await readFile(resolve(out,`${name}.json`),'utf8'));
  const e=createDevelopingEngine(rate,7311,recorded?bank(rate):null),events=[],original=e.noteOn.bind(e);e.noteOn=(...event)=>{events.push(event.slice(0,5));original(...event);};
  e.setParameters(knobs(0,recorded));e.start();const total=rate*8,boundaries=[rate*2,rate*4,rate*6,total];let boundary=0,energy=0;
  for(let at=0;at<total;){
    if(at===rate*2)e.setParameters(knobs(1,recorded));if(at===rate*4)e.setParameters(knobs(0,recorded));if(at===rate*6)e.stop();
    while(boundaries[boundary]<=at)boundary++;const frames=Math.min(128,boundaries[boundary]-at),left=new Float32Array(frames),right=new Float32Array(frames);e.render(left,right);
    for(let i=0;i<frames;i++)for(let c=0;c<2;c++){
      const js=c===0?left[i]:right[i],native=pcm.readFloatLE(((at+i)*2+c)*4),difference=Math.abs(js-native);
      assert.ok(Number.isFinite(native)&&Math.abs(native)<.85,`${name} bounded PCM`);
      assert.ok(difference<=1e-7,`${name} frame ${at+i} channel ${c}: native ${native}, JS ${js}, difference ${difference}`);
      compared++;if(js===native)exact++;max=Math.max(max,difference);energy+=native*native;
    }at+=frames;
  }
  assert.ok(energy>1,`${name} nonzero PCM`);assert.deepEqual(score.events,events.slice(-512),`${name} exact MIDI history`);assert.equal(score.frame,e.frame,`${name} transport frame`);
  console.log(`PASS developing ${name}: live BPM controls, melody${recorded?'+recorded drums':''}, effects/weather, stop fade, exact MIDI history`);
}
console.log(`PASS developing JS/JVM PCM: ${compared} stereo samples, ${exact} bit-identical, max absolute difference ${max}; tolerance 1e-7`);
console.log('Scope: procedural melodic/no-drums and recorded+melody PCM only; procedural drum DSP is historically platform-specific. No Android-device validation.');
JS
