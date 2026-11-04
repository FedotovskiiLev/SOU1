// SPDX-License-Identifier: AGPL-3.0-only
// Opt-in prepared melodic voices at the same pre-effects seam as recorded drums.
import {RecordedWeather} from './recorded-weather.js';
import {AmbientEngine} from './audio-engine.js';
import {RecordedDrumEngine} from './recorded-drum-engine.js';
import {createDevelopingEngine} from './developing-engine.js';
import {LiveMelodicPool} from './live-melodic-pool.js';
export function createInstrumentEngine(rate,seed,{scoreMode='original',scoreConfig,drumBank,melodicBank,weatherBank,synthesizedBed=false,evolvingTimbre=false}={}){
 if(scoreMode!=='original'&&scoreMode!=='developing')throw new RangeError('Unknown score mode');
 const engine=scoreMode==='developing'?createDevelopingEngine(rate,seed,drumBank,scoreConfig):drumBank?new RecordedDrumEngine(rate,seed,drumBank):new AmbientEngine(rate,seed);
 engine.evolvingTimbre=evolvingTimbre===true;
 if(weatherBank){engine.environment=new RecordedWeather(rate,seed,weatherBank);const apply=engine.applySeed.bind(engine);engine.applySeed=()=>{apply();engine.environment.reseed(engine.seed);if(engine.playing)engine.environment.start();};}
 if(!melodicBank)return engine;
 const pool=LiveMelodicPool.fromPrepared(rate,melodicBank,{polyphony:32});
 engine.recordedMelodies=pool;engine.melodicGains=new Float64Array(5);engine.recordedMelodyGain=1;
 engine.recordedMelodicAccepted=0;engine.recordedMelodicDropped=0;engine.recordedMelodicUnmapped=0;engine.melodicFallbacks=0;
 engine.getActiveMelodicVoiceCount=()=>{let count=pool.activeVoices;for(let i=0;i<32;i++)if(engine.voices[i].active)count++;return count;};
 const noteOn=engine.noteOn.bind(engine),next=engine.next.bind(engine),setParameters=engine.setParameters.bind(engine),start=engine.start.bind(engine),stop=engine.stop.bind(engine),reset=engine.reset.bind(engine),applySeed=engine.applySeed.bind(engine);
 pool.setVoiceLimit(engine.parameters.polyphony);pool.setMelodyEnabled(engine.parameters.melodyEnabled);pool.setEnabled(false);
 function clearPool(){engine.noteOffCount+=pool.activeVoices;pool.reset();pool.setMelodyEnabled(engine.parameters.melodyEnabled);pool.setVoiceLimit(engine.parameters.polyphony);pool.setEnabled(engine.playing);}
 function attachMix(){
  const process=engine.macros.process.bind(engine.macros);
  engine.macros.process=(left,right,target)=>{
   for(let i=0;i<5;i++)engine.melodicGains[i]=engine.layerGains[i]*((i===1||i===2)?engine.recordedMelodyGain:1);
   const before=pool.activeVoices;pool.next(engine.melodicGains,engine.playing,engine.evolvingTimbre?engine.evolution:0,engine.frame,engine.seed);engine.noteOffCount+=before-pool.activeVoices;
   const level=1+engine.intensity*1.4;process(left+pool.outputL*level,right+pool.outputR*level,target);
  };
 }
 engine.noteOn=(frame,layer,pitch,duration,velocity,pan)=>{
  if(layer>=5){noteOn(frame,layer,pitch,duration,velocity,pan);return;}
  if(engine.getActiveMelodicVoiceCount()>=engine.parameters.polyphony){engine.recordedMelodicDropped++;engine.droppedNotes++;return;}
  // Keep pad, texture and bass synthesis; sample only lead/pluck and bell/reply.
  if(synthesizedBed&&(layer===0||layer===3||layer===4)){noteOn(frame,layer,pitch,duration,velocity,pan);return;}
  const before=pool.stats.unmapped;
  if(pool.trigger(layer,pitch,duration/rate,velocity,pan)){engine.recordedMelodicAccepted++;engine.noteOnCount++;if(engine.onNoteOn)engine.onNoteOn(frame,layer,pitch,duration,velocity,pan,engine.noteOnCount);return;}
  if(pool.stats.unmapped===before){engine.recordedMelodicDropped++;engine.droppedNotes++;return;}
  engine.recordedMelodicUnmapped++;
  const accepted=engine.noteOnCount;noteOn(frame,layer,pitch,duration,velocity,pan);if(engine.noteOnCount>accepted)engine.melodicFallbacks++;
 };
 engine.setParameters=update=>{
  const oldLimit=engine.parameters.polyphony;setParameters(update);pool.setMelodyEnabled(engine.parameters.melodyEnabled);pool.setVoiceLimit(engine.parameters.polyphony);
  if(oldLimit!==engine.parameters.polyphony){let allowed=engine.parameters.polyphony-pool.activeVoices;for(let i=0;i<32;i++){const v=engine.voices[i];if(v.active&&--allowed<0&&!v.off){v.duration=v.age;v.release=Math.min(v.release,Math.max(1,Math.round(rate*.08)));engine.noteOff(engine.frame,v);}}}
 };
 engine.start=()=>{pool.setEnabled(true);pool.setMelodyEnabled(engine.parameters.melodyEnabled);pool.setVoiceLimit(engine.parameters.polyphony);start();};
 engine.stop=()=>{stop();pool.setEnabled(false);};
 engine.next=(target,playing)=>{engine.recordedMelodyGain+=(1/(rate*.025))*((target.melodyEnabled?1:0)-engine.recordedMelodyGain);next(target,playing);if(!playing&&engine.fade===0&&pool.activeVoices)clearPool();};
 engine.applySeed=()=>{applySeed();clearPool();};
 engine.reset=()=>{reset();clearPool();engine.recordedMelodicAccepted=engine.recordedMelodicDropped=engine.recordedMelodicUnmapped=engine.melodicFallbacks=0;attachMix();};
 attachMix();return engine;
}
