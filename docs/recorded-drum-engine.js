// SPDX-License-Identifier: AGPL-3.0-only
// Add recorded percussion at the original pre-effects mix seam. The legacy
// EventScore, oscillator voices, weather, macros, DC blocker and limiter stay intact.
import {AmbientEngine} from './audio-engine.js';
import {LiveDrumPool} from './live-drum-pool.js';
export class RecordedDrumEngine extends AmbientEngine {
 constructor(rate,seed,wireBank){super(rate,seed);this.recordedDrums=new LiveDrumPool(rate,wireBank,{polyphony:16});this.recordedDrums.setEnabled(this.parameters.drumsEnabled);this.attachDrumMix();}
 attachDrumMix(){
  const process=this.macros.process.bind(this.macros);
  this.macros.process=(left,right,target)=>{
   this.recordedDrums.next(this.drumGains,target.drumsEnabled);
   const level=1+this.intensity*1.4;
   process(left+this.recordedDrums.outputL*level,right+this.recordedDrums.outputR*level,target);
  };
 }
 setParameters(update){super.setParameters(update);this.recordedDrums?.setEnabled(this.parameters.drumsEnabled);}
 noteOn(frame,instrument,pitch,duration,velocity,pan){
  if(instrument<5){super.noteOn(frame,instrument,pitch,duration,velocity,pan);return;}
  if(this.recordedDrums.trigger(instrument,pitch,velocity,pan)){
   this.noteOnCount++;if(this.onNoteOn)this.onNoteOn(frame,instrument,pitch,duration,velocity,pan,this.noteOnCount);
  }else this.droppedNotes++;
 }
 next(target,playing){
  super.next(target,playing);
  // A very early Stop can finish the global fade before the sample release.
  // The base engine then stops its clock; discard tails instead of freezing
  // them until a later Play. Controls/score and the legacy engine stay intact.
  if(!playing&&this.fade===0&&this.recordedDrums.activeVoices)this.recordedDrums.reset();
 }
 stop(){super.stop();this.recordedDrums.stop();}
 applySeed(){super.applySeed();this.recordedDrums.reset();this.recordedDrums.setEnabled(this.parameters.drumsEnabled);}
 reset(){super.reset();this.recordedDrums.reset();this.recordedDrums.setEnabled(this.parameters.drumsEnabled);this.attachDrumMix();}
}
