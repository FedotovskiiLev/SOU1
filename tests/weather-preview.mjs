// SPDX-License-Identifier: AGPL-3.0-only
// Local, dependency-free review fixtures. No loudness normalization.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
const source=await readFile(new URL('../docs/environment-audio.js',import.meta.url),'utf8');
const {EnvironmentAudio}=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const destination=process.argv[2]||'/tmp/sou1-weather-previews';await mkdir(destination,{recursive:true});
const rate=48000,seed=7;
const cases=[['rain-light',8,{rainType:1,rain:1}],['rain-steady',8,{rainType:2,rain:1}],['rain-heavy',8,{rainType:3,rain:1}],['thunder',14,{thunder:1}],['wind',12,{wind:1}],['storm',14,{rainType:3,rain:.55,thunder:.8,wind:.5}]];
const reports=[];
for(const [name,seconds,parameters] of cases){
 const engine=new EnvironmentAudio(rate,seed);engine.setParameters(parameters);engine.start();
 const frames=rate*(seconds+3),data=Buffer.alloc(44+frames*4);data.write('RIFF');data.writeUInt32LE(data.length-8,4);data.write('WAVEfmt ',8);data.writeUInt32LE(16,16);data.writeUInt16LE(1,20);data.writeUInt16LE(2,22);data.writeUInt32LE(rate,24);data.writeUInt32LE(rate*4,28);data.writeUInt16LE(4,32);data.writeUInt16LE(16,34);data.write('data',36);data.writeUInt32LE(frames*4,40);
 let peak=0,sum=0,delta=0,last=0;
 for(let i=0;i<frames;i++){if(i===rate*seconds)engine.stop();engine.next();for(const [channel,v] of [engine.outputL,engine.outputR].entries()){data.writeInt16LE(Math.round(v*32767),44+i*4+channel*2);peak=Math.max(peak,Math.abs(v));sum+=v*v;}delta=Math.max(delta,Math.abs(engine.outputL-last));last=engine.outputL;}
 await writeFile(`${destination}/${name}.wav`,data);reports.push({name,rate,seed,parameters:engine.parameters,activeSeconds:seconds,fadeSeconds:3,peak,rms:Math.sqrt(sum/(frames*2)),maxSampleDelta:delta});
}
await writeFile(`${destination}/manifest.json`,JSON.stringify(reports,null,2)+'\n');console.log(JSON.stringify(reports,null,2));
