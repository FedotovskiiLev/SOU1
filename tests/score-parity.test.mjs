// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
const root=fileURLToPath(new URL('..',import.meta.url)),out=await mkdtemp(join(tmpdir(),'sou1-parity-'));
try {
 const files=['app/src/main/java/org/sou1/audio/AmbientEngine.java','app/src/main/java/org/sou1/audio/EnvironmentAudio.java','tests/EventScoreTest.java'].map(p=>resolve(root,p));
 execFileSync('java',['-m','jdk.compiler/com.sun.tools.javac.Main','-d',out,...files]);
 const java=execFileSync('java',['-cp',out,'EventScoreTest','trace'],{encoding:'utf8'}).trim().split('\n').map(line=>line.split(',').map(Number));
 const weather=await readFile(resolve(root,'docs/environment-audio.js'),'utf8');
 const source=(await readFile(resolve(root,'docs/audio-engine.js'),'utf8')).replace("'./environment-audio.js'",JSON.stringify(`data:text/javascript;base64,${Buffer.from(weather).toString('base64')}`));
 const {EventScore}=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
 const js=[];new EventScore(8000,91).advanceTo(600*8000-1,1,{noteOn(...e){js.push(e);}});
 assert.equal(java.length,js.length);
 for(let i=0;i<java.length;i++)for(let j=0;j<6;j++)assert(Math.abs(java[i][j]-js[i][j])<1e-14,`event ${i} field ${j}: ${java[i][j]} != ${js[i][j]}`);
 console.log(`PASS Java/JS parity: ${js.length} events, onset/instrument/pitch/duration/velocity/pan`);
} finally {await rm(out,{recursive:true,force:true});}
