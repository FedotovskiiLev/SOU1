// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const source=await readFile(`${root}/docs/environment-audio.js`,'utf8');
const {EnvironmentAudio}=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const dir=await mkdtemp(`${tmpdir()}/weather-parity-`);
try {
 let compile=spawnSync('javac',['-d',dir,`${root}/app/src/main/java/org/sou1/audio/EnvironmentAudio.java`,`${root}/tests/EnvironmentAudioTest.java`]);
 if(compile.error?.code==='ENOENT')compile=spawnSync('java',['-m','jdk.compiler/com.sun.tools.javac.Main','-d',dir,`${root}/app/src/main/java/org/sou1/audio/EnvironmentAudio.java`,`${root}/tests/EnvironmentAudioTest.java`]);
 assert.equal(compile.status,0,compile.stderr?.toString());
 let maxError=0;const levels=[];
 for(const rate of [8000,44100,48000,96000,192000]){
  const result=spawnSync('java',['-cp',dir,'EnvironmentAudioTest','--parity',String(rate)],{maxBuffer:8e6});assert.equal(result.status,0,result.stderr.toString());
  const a=new EnvironmentAudio(rate,7);a.setParameters({rainType:3,rain:.7,thunder:1,wind:.8});a.start();let offset=0,energy=0,peak=0;
  for(let i=0;i<rate*5;i++){
   if(i===rate*3)a.stop();a.next();
   assert(Number.isFinite(a.outputL)&&Number.isFinite(a.outputR));peak=Math.max(peak,Math.abs(a.outputL),Math.abs(a.outputR));energy+=a.outputL*a.outputL;
   if(i%97===0){for(const v of [a.outputL,a.outputR]){const error=Math.abs(v-result.stdout.readDoubleBE(offset));maxError=Math.max(error,maxError);assert(error<1e-10,`parity ${rate}: ${error}`);offset+=8;}}
  }
  assert.equal(offset,result.stdout.length);assert(peak<.45);assert(a.isSilent());levels.push(Math.sqrt(energy/(rate*5)));
 }
 assert(Math.max(...levels)/Math.min(...levels)<1.6,`rate loudness drift ${levels}`);
 console.log('Weather Java/JS parity, all layers at five rates, stop endpoints: passed',{maxError,rmsByRate:levels});
}finally{await rm(dir,{recursive:true,force:true});}
