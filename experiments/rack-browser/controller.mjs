// SPDX-License-Identifier: AGPL-3.0-only
// Browser lifecycle controller; dependencies injected for non-browser tests.
export function validMidi(bytes){
  if(!(bytes instanceof Uint8Array)||bytes.length<26||bytes.length>2*1024*1024)return false;
  const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),tag=at=>String.fromCharCode(...bytes.subarray(at,at+4));
  if(tag(0)!=='MThd'||v.getUint32(4)!==6||v.getUint16(8)!==1||v.getUint16(12)!==960)return false;
  const tracks=v.getUint16(10);if(tracks<1||tracks>32)return false;
  let at=14;
  for(let i=0;i<tracks;i++){
    if(at+8>bytes.length||tag(at)!=='MTrk')return false;
    const size=v.getUint32(at+4);at+=8;
    if(size<4||at+size>bytes.length||bytes[at+size-3]!==255||bytes[at+size-2]!==47||bytes[at+size-1]!==0)return false;
    at+=size;
  }
  return at===bytes.length;
}
export class PlaybackController {
  constructor({makeWorker,makeContext,onChange=()=>{}}){this.makeWorker=makeWorker;this.makeContext=makeContext;this.onChange=onChange;this.state='idle';this.generation=0;this.playToken=0;this.volume=.35;this.worker=null;this.context=null;this.source=null;this.gain=null;this.pcm=null;this.error=null;}
  emit(){this.onChange({state:this.state,error:this.error,report:this.pcm?.report??null});}
  prepare(options){
    if(this.state==='disposed')throw new Error('Controller disposed');this.cancel();this.pcm=null;this.error=null;this.state='preparing';this.emit();
    const generation=++this.generation;let worker;
    try{worker=this.makeWorker();this.worker=worker;}catch(e){this.state='error';this.error=e.message;this.emit();return;}
    worker.onmessage=({data})=>{
      if(generation!==this.generation||this.worker!==worker)return;
      if(data.type==='progress'){this.onChange({state:this.state,progress:Math.max(0,Math.min(1,data.value))});return;}
      if(data.type==='ready'){
        try{const {left,right,sampleRate}=data;if(!(left instanceof Float32Array)||!(right instanceof Float32Array)||left.length!==right.length||!left.length||![44100,48000].includes(sampleRate)||left.length>30*sampleRate)throw new Error('Invalid worker PCM');for(const b of [left,right])for(const x of b)if(!Number.isFinite(x)||Math.abs(x)>=1)throw new Error('Invalid worker sample');const midiBytes=data.midiBytes;if(midiBytes!==undefined&&!validMidi(midiBytes))throw new Error('Invalid worker MIDI');this.pcm={left,right,sampleRate,report:data.report,...(midiBytes?{midiBytes:midiBytes.slice()}: {})};this.state='ready';}
        catch(e){this.pcm=null;this.state='error';this.error=e.message;}
        this.worker=null;worker.terminate();this.emit();
      }else if(data.type==='error'){this.worker=null;worker.terminate();this.pcm=null;this.state='error';this.error=data.message||'Worker failed';this.emit();}
    };
    worker.onerror=e=>{if(generation!==this.generation||this.worker!==worker)return;this.worker=null;worker.terminate();this.pcm=null;this.state='error';this.error=e.message||'Worker failed';this.emit();};
    try{worker.postMessage({options});}catch(e){worker.terminate();this.worker=null;this.state='error';this.error=e.message;this.emit();}
  }
  cancel(){this.stop();this.generation++;if(this.worker){this.worker.terminate();this.worker=null;}if(this.state!=='disposed'){this.state=this.pcm?'ready':'idle';this.emit();}}
  async play(){
    if(this.state==='disposed')throw new Error('Controller disposed');if(!this.pcm||this.state==='playing'||this.state==='resuming')return false;
    const token=++this.playToken;this.state='resuming';this.error=null;this.emit();
    try{
      // Context is created synchronously from the click before awaiting resume.
      if(!this.context||this.context.state==='closed'){this.context=this.makeContext();const ctx=this.context;ctx.onstatechange=()=>{if(this.context===ctx&&ctx.state!=='running'&&this.state==='playing'){this.stop();this.error='Audio was interrupted. Press Play to restart.';this.emit();}};}
      const ctx=this.context;await ctx.resume();if(token!==this.playToken||this.state==='disposed')return false;
      if(ctx.state!=='running')throw new Error('Audio is suspended. Press Play again to allow playback.');
      const pcm=this.pcm,buffer=ctx.createBuffer(2,pcm.left.length,pcm.sampleRate);buffer.copyToChannel(pcm.left,0);buffer.copyToChannel(pcm.right,1);
      const source=ctx.createBufferSource(),gain=ctx.createGain();source.buffer=buffer;source.connect(gain);gain.connect(ctx.destination);gain.gain.setValueAtTime(0,ctx.currentTime);gain.gain.linearRampToValueAtTime(this.volume,ctx.currentTime+.02);
      this.source=source;this.gain=gain;source.onended=()=>{source.disconnect();gain.disconnect();if(this.source===source){this.source=null;this.gain=null;this.state='ready';this.emit();}};
      source.start();this.state='playing';this.emit();return true;
    }catch(e){if(token!==this.playToken||this.state==='disposed')return false;this.source?.disconnect();this.gain?.disconnect();this.source=null;this.gain=null;this.state='ready';this.error=e.message;this.emit();return false;}
  }
  stop(){
    this.playToken++;const source=this.source,gain=this.gain,ctx=this.context;this.source=null;this.gain=null;
    if(source){if(ctx.state!=='running'){try{source.stop();}catch{}source.disconnect();gain?.disconnect();}
      else try{gain.gain.cancelScheduledValues(ctx.currentTime);gain.gain.setValueAtTime(gain.gain.value,ctx.currentTime);gain.gain.linearRampToValueAtTime(0,ctx.currentTime+.02);source.stop(ctx.currentTime+.03);}catch{source.disconnect();gain?.disconnect();}}
    if(this.state==='playing'||this.state==='resuming'){this.state=this.pcm?'ready':'idle';this.emit();}
  }
  setVolume(v){if(!Number.isFinite(v)||v<0||v>1)throw new RangeError('volume 0..1');this.volume=v;if(this.gain&&this.context)this.gain.gain.setTargetAtTime(v,this.context.currentTime,.02);}
  async dispose(){if(this.state==='disposed')return;this.cancel();this.pcm=null;this.state='disposed';const ctx=this.context;this.context=null;if(ctx){ctx.onstatechange=null;try{await ctx.close();}catch{}}this.emit();}
}
