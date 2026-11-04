// SPDX-License-Identifier: AGPL-3.0-only
import {validateSessionRecipe,sessionPhrase} from './session-plan.mjs';
import {validMidi} from './controller.mjs';
export const SESSION_HEADROOM=.45; // At most two overlapping phrase buffers, each strictly below full scale.
const START_LEAD=.1,MIN_LEAD=.025;
export class SessionController {
  constructor({makeWorker,makeContext,onChange=()=>{},setTimer=(fn,ms)=>setInterval(fn,ms),clearTimer=id=>clearInterval(id)}) {
    Object.assign(this,{makeWorker,makeContext,onChange,setTimer,clearTimer});
    this.state='idle';this.generation=0;this.volume=.35;this.context=null;this.worker=null;this.timer=null;
    this.queue=[];this.nodes=[];this.latest=null;this.gain=null;this.error=null;this.pending=false;
  }
  emit(){this.onChange({state:this.state,error:this.error,report:this.latest?.report??null,phrase:this.latest?.phrase??null,queued:this.queue.length});}
  prepare(input) {
    if(this.state==='disposed')throw new Error('Controller disposed');
    this.stop();this.latest=null;this.error=null;
    try{this.recipe=validateSessionRecipe(input);}catch(e){this.state='error';this.error=e.message;this.emit();return;}
    this.nextReceive=0;this.nextSchedule=0;this.state='preparing';const generation=++this.generation;
    try{
      const worker=this.makeWorker();this.worker=worker;this.pending=true;
      worker.onmessage=({data})=>{
        if(this.generation!==generation||this.worker!==worker)return;
        if(data?.type==='error'){this.fail(data.message||'Session worker failed');return;}
        try {
          if(data?.type!=='phrase'||!this.pending)throw new Error('Unexpected session worker response');
          const expected=sessionPhrase(this.recipe,this.nextReceive),{left,right,sampleRate,midiBytes}=data;
          const expectedFrames=expected.frames;
          if(sampleRate!==this.recipe.score.sampleRate||!(left instanceof Float32Array)||!(right instanceof Float32Array)||left.length!==right.length||left.length!==expectedFrames||data.phrase?.index!==expected.index||data.phrase?.seed!==expected.seed||data.phrase?.startSeconds!==expected.startSeconds)throw new Error('Invalid session phrase');
          for(const pcm of [left,right])for(const x of pcm)if(!Number.isFinite(x)||Math.abs(x)>=1)throw new Error('Invalid session PCM');
          if(!validMidi(midiBytes))throw new Error('Invalid session MIDI');
          if(this.queue.length>=2)throw new Error('Session queue overflow');
          this.pending=false;this.nextReceive++;
          this.queue.push({left,right,sampleRate,phrase:expected,report:data.report,midiBytes:midiBytes.slice()});
          if(this.state==='preparing'){
            if(this.queue.length===2){this.state='ready';this.latest={phrase:this.queue[0].phrase,report:this.queue[0].report,midiBytes:this.queue[0].midiBytes};this.emit();}
            else this.requestNext();
          }else if(this.state==='playing'){this.tick();}
        }catch(e){this.fail(e.message);}
      };
      worker.onerror=e=>{if(this.generation===generation&&this.worker===worker)this.fail(e.message||'Session worker failed');};
      worker.postMessage({type:'init',recipe:this.recipe});this.emit();
    }catch(e){this.fail(e.message);}
  }
  requestNext(){
    if(this.pending||!this.worker||this.queue.length>=2)return;
    this.pending=true;try{this.worker.postMessage({type:'next'});}catch(e){this.fail(e.message);}
  }
  async play(){
    if(this.state==='disposed')throw new Error('Controller disposed');
    if(this.state!=='ready'||this.queue.length!==2)return false;
    const generation=this.generation;this.state='resuming';this.emit();
    try{
      if(!this.context||this.context.state==='closed'){
        this.context=this.makeContext();const ctx=this.context;
        ctx.onstatechange=()=>{if(this.context===ctx&&ctx.state!=='running'&&this.state==='playing')this.fail('Audio was interrupted. Prepare again to restart.');};
      }
      const ctx=this.context;await ctx.resume();
      if(this.generation!==generation||this.state!=='resuming')return false;
      if(ctx.state!=='running')throw new Error('Audio is suspended. Prepare again after enabling audio.');
      this.epoch=ctx.currentTime+START_LEAD;this.gain=ctx.createGain();this.gain.connect(ctx.destination);
      this.gain.gain.setValueAtTime(0,ctx.currentTime);this.gain.gain.linearRampToValueAtTime(this.volume*SESSION_HEADROOM,this.epoch);
      this.state='playing';this.tick();
      if(this.state!=='playing')return false;
      this.timer=this.setTimer(()=>{if(this.generation===generation&&this.state==='playing')this.tick();},100);
      this.emit();return true;
    }catch(e){if(this.generation===generation)this.fail(e.message);return false;}
  }
  tick(){
    if(this.state!=='playing')return;
    try {
      const ctx=this.context,now=ctx.currentTime;
      // One current phrase and one future phrase. A previous release tail may still sound.
      let changed=false,ahead=this.nodes.filter(n=>n.activeEnd>now).length;
      while(ahead<2&&this.queue.length){
        const p=this.queue[0],start=this.epoch+p.phrase.startSeconds;
        if(p.phrase.index!==this.nextSchedule)throw new Error('Session phrase order mismatch');
        if(start<now+MIN_LEAD)throw new Error('Phrase preparation missed its audio deadline. Playback stopped without skipping notes. Prepare again to restart.');
        const buffer=ctx.createBuffer(2,p.left.length,p.sampleRate);buffer.copyToChannel(p.left,0);buffer.copyToChannel(p.right,1);
        const source=ctx.createBufferSource();source.buffer=buffer;source.connect(this.gain);
        const node={source,start,activeEnd:start+p.phrase.activeSeconds};this.nodes.push(node);
        source.onended=()=>{source.disconnect();const i=this.nodes.indexOf(node);if(i>=0)this.nodes.splice(i,1);};
        try{if(start<ctx.currentTime+MIN_LEAD)throw new Error('Audio buffer preparation missed its deadline. Prepare again to restart.');source.start(start);}catch(e){source.disconnect();this.nodes.splice(this.nodes.indexOf(node),1);throw e;}
        this.queue.shift();this.nextSchedule++;changed=true;this.latest={phrase:p.phrase,report:p.report,midiBytes:p.midiBytes};ahead++;
      }
      const next=sessionPhrase(this.recipe,this.nextSchedule);
      if(!this.queue.length&&this.epoch+next.startSeconds<now+MIN_LEAD)throw new Error('Phrase preparation missed its audio deadline. Playback stopped without skipping notes. Prepare again to restart.');
      if(this.queue.length<1)this.requestNext();
      if(changed)this.emit();
    }catch(e){this.fail(e.message);}
  }
  fail(message){this.stop();this.error=message;this.state='error';this.emit();}
  stop(){
    this.generation++;if(this.timer!==null){this.clearTimer(this.timer);this.timer=null;}
    if(this.worker){this.worker.terminate();this.worker=null;}this.pending=false;this.queue=[];
    const nodes=this.nodes,ctx=this.context,gain=this.gain;this.nodes=[];this.gain=null;
    if(gain){
      let remaining=nodes.length;
      const disconnect=source=>{source.disconnect();if(--remaining===0)gain.disconnect();};
      if(ctx?.state==='running'){
        try{gain.gain.cancelScheduledValues(ctx.currentTime);gain.gain.setValueAtTime(gain.gain.value,ctx.currentTime);gain.gain.linearRampToValueAtTime(0,ctx.currentTime+.02);}catch{}
        for(const {source} of nodes){source.onended=()=>disconnect(source);try{source.stop(ctx.currentTime+.03);}catch{disconnect(source);}}
      }else for(const {source} of nodes){source.onended=null;try{source.stop();}catch{}disconnect(source);}
      if(!nodes.length)gain.disconnect();
    }
    if(this.state!=='disposed'){this.state='idle';this.emit();}
  }
  cancel(){this.stop();}
  setVolume(v){if(!Number.isFinite(v)||v<0||v>1)throw new RangeError('volume 0..1');this.volume=v;if(this.gain)this.gain.gain.setTargetAtTime(v*SESSION_HEADROOM,this.context.currentTime,.02);}
  async dispose(){if(this.state==='disposed')return;this.stop();this.latest=null;this.state='disposed';const ctx=this.context;this.context=null;if(ctx){ctx.onstatechange=null;try{await ctx.close();}catch{}}this.emit();}
}
