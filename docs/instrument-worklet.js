// SPDX-License-Identifier: AGPL-3.0-only
import {NoteHistory} from './note-history.js';
import {createInstrumentEngine} from './instrument-engine.js';
class Sou1InstrumentProcessor extends AudioWorkletProcessor {
 constructor(options){
  super();this.setup=options?.processorOptions??{};this.engine=null;this.initialized=false;this.history=new NoteHistory();this.silenceReported=true;
  this.port.onmessage=({data})=>{
   if(!data||typeof data!=='object')return;
   if(data.type==='initialize'){
    if(this.initialized)return;this.initialized=true;
    try{
     this.engine=createInstrumentEngine(sampleRate,this.setup.seed??1,{scoreMode:this.setup.scoreMode,scoreConfig:this.setup.scoreConfig,drumBank:data.wireBank,melodicBank:data.melodicBank});
     const noteOn=this.engine.noteOn.bind(this.engine);this.engine.noteOn=(...event)=>{this.history.add(...event);noteOn(...event);};
     const applySeed=this.engine.applySeed.bind(this.engine);this.engine.applySeed=()=>{this.history.clear();applySeed();};
     this.port.postMessage({type:'ready',requestId:data.requestId});
    }catch(error){this.engine=null;this.port.postMessage({type:'initialization-error',requestId:data.requestId,message:error.message||String(error)});}
    return;
   }
   if(!this.engine)return;
   switch(data.type){
    case 'score':this.sendScore('score');break;
    case 'score-export':this.sendScore('score-export',data.requestId);break;
    case 'start':this.engine.start();this.silenceReported=false;break;
    case 'stop':this.engine.stop();this.silenceReported=false;this.sendScore('score');break;
    case 'reseed':this.engine.reseed(data.seed);break;
    case 'parameters':if(data.parameters&&typeof data.parameters==='object')this.engine.setParameters(data.parameters);break;
   }
  };
 }
 sendScore(type,requestId){this.port.postMessage({type,requestId,score:{...this.history.snapshot(this.engine.frame,sampleRate),seed:this.engine.seed},routing:{sampled:this.engine.recordedMelodicAccepted??0,dropped:this.engine.recordedMelodicDropped??0,unmapped:this.engine.recordedMelodicUnmapped??0,fallback:this.engine.melodicFallbacks??0}});}
 process(inputs,outputs){
  const channels=outputs[0];if(!this.engine){if(channels)for(const c of channels)c.fill(0);return true;}
  if(channels&&channels.length>=2)this.engine.render(channels[0],channels[1]);
  if(this.engine.isSilent()&&!this.silenceReported){this.sendScore('score');this.port.postMessage({type:'silent'});this.silenceReported=true;}return true;
 }
}
registerProcessor('sou1-instruments',Sou1InstrumentProcessor);
