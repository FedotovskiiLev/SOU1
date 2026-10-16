// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
const root=fileURLToPath(new URL('..',import.meta.url)),out=await mkdtemp(join(tmpdir(),'sou1-composition-parity-'));
try {
 const files=['app/src/main/java/org/sou1/audio/AmbientEngine.java','app/src/main/java/org/sou1/audio/EnvironmentAudio.java','tests/CompositionEngineTest.java'].map(p=>resolve(root,p));
 execFileSync('java',['-m','jdk.compiler/com.sun.tools.javac.Main','-d',out,...files]);
 const weather=await readFile(resolve(root,'docs/environment-audio.js'),'utf8');
 const source=(await readFile(resolve(root,'docs/audio-engine.js'),'utf8')).replace("'./environment-audio.js'",JSON.stringify(`data:text/javascript;base64,${Buffer.from(weather).toString('base64')}`));
 const {EventScore,DEFAULTS}=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
 let count=0;const cases=[];
 for(const seed of [91,97])for(const bpm of [72,120])for(let mode=0;mode<4;mode++)cases.push({seed,bpm,mode});
 for(const knobs of [[.4,.8,.6,.7,.7,.9,.3],[0,0,0,0,.5,.5,0],[1,1,1,1,1,1,1],[0,1,0,0,0,0,.8]])cases.push({seed:97,bpm:113,mode:0,knobs});
 for(const {seed,bpm,mode,knobs} of cases){
  const raw=execFileSync('java',['-cp',out,'CompositionEngineTest','trace',String(mode),String(seed),String(bpm),...(knobs?knobs.map(String):[])],{encoding:'utf8'}).trim();
  const native=raw?raw.split('\n').map(line=>line.split(',').map(Number)):[];
  const p={...DEFAULTS,composition:mode,bpm,drumsEnabled:true,ambient:mode===0?1:0,counterpoint:mode===1?1:0,rhythmic:mode===2?1:0,arpeggio:mode===3?1:0};
  if(knobs)['ambient','counterpoint','rhythmic','arpeggio','density','complexity','swing'].forEach((key,i)=>{p[key]=knobs[i];});
  const js=[];new EventScore(8000,seed).advanceTo(120*8000-1,p,{noteOn(...e){js.push(e);}});
  assert.equal(native.length,js.length,`mode${mode} seed${seed} bpm${bpm} count`);
  for(let i=0;i<native.length;i++)for(let j=0;j<6;j++)assert(Math.abs(native[i][j]-js[i][j])<1e-12,`mode${mode} seed${seed} bpm${bpm} event${i} field${j}: ${native[i][j]} != ${js[i][j]}`);
  count+=js.length;
 }
 console.log(`PASS parameter-aware Java/JS composition parity: ${cases.length} traces, ${count} exact-frame/instrument/pitch/gate/velocity/pan events`);
}finally{await rm(out,{recursive:true,force:true});}
