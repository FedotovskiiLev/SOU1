// SPDX-License-Identifier: AGPL-3.0-only
// Runtime core: no Node/browser globals. Both instrument backends implement
// createVoice(event, rate, triggerIndex), value(voice, age), length(voice).
const int=(n,a,b)=>Number.isSafeInteger(n)&&n>=a&&n<=b;
const unit=x=>Number.isFinite(x)&&x>=0&&x<=1;
export function validateEvent(e) {
  if(!e||typeof e!=='object'||Array.isArray(e)||!int(e.frame,0,2**40)||!int(e.duration,1,2**32)||!int(e.pitch,0,127)||!unit(e.velocity)||!unit(e.pan)||typeof e.instrument!=='string'||!e.instrument||e.instrument.length>64)throw new TypeError('Invalid note event');
  return {frame:e.frame,duration:e.duration,pitch:e.pitch,velocity:e.velocity,pan:e.pan,instrument:e.instrument};
}
function sinc(x){return Math.abs(x)<1e-9?1:Math.sin(Math.PI*x)/(Math.PI*x);}
// Sixteen-tap Hann-windowed sinc with rate-dependent anti-alias cutoff.
// Bounded preview-quality resampling; not a mastering-grade reconstruction.
function resample(pcm,pos,step){
  const base=Math.floor(pos),cut=Math.min(1,1/step)*.92;let sum=0,weights=0;
  for(let j=base-7;j<=base+8;j++){
    const d=pos-j;if(Math.abs(d)>=8)continue;
    const w=cut*sinc(d*cut)*(.5+.5*Math.cos(Math.PI*d/8));
    weights+=w;if(j>=0&&j<pcm.length)sum+=pcm[j]*w;
  }
  return Math.abs(weights)>1e-9?sum/weights:0;
}
export class SampleInstrument {
  constructor(definition,samples){
    if(!definition||!Array.isArray(definition.zones)||!definition.zones.length||definition.zones.length>64||!unit(definition.gain)||typeof definition.oneShot!=='boolean')throw new TypeError('Instrument definition');
    if(definition.chokeGroup!==undefined&&(typeof definition.chokeGroup!=='string'||!definition.chokeGroup||definition.chokeGroup.length>32))throw new TypeError('chokeGroup');
    this.gain=definition.gain;this.oneShot=definition.oneShot;this.chokeGroup=definition.chokeGroup||null;
    const copies=new Map();let copiedBytes=0;
    this.zones=definition.zones.map(z=>{
      const s=samples.get(z.sample);
      if(!s||!(s.pcm instanceof Float32Array)||s.pcm.length<2||s.pcm.length>192000*30||!int(s.sampleRate,8000,192000)||!int(s.rootNote,0,127)||!int(z.keyLow,0,127)||!int(z.keyHigh,z.keyLow,127)||typeof z.pitched!=='boolean')throw new TypeError('Sample zone');
      const vLow=z.velocityLow??0,vHigh=z.velocityHigh??1;if(!unit(vLow)||!unit(vHigh)||vLow>vHigh)throw new TypeError('Velocity zone');
      if(!copies.has(s)){copiedBytes+=s.pcm.byteLength;if(copiedBytes>8*1024*1024)throw new RangeError('Instrument decoded budget');for(const x of s.pcm)if(!Number.isFinite(x)||Math.abs(x)>1)throw new TypeError('Sample PCM');copies.set(s,Object.freeze({...s,pcm:s.pcm.slice()}));}
      return Object.freeze({...z,velocityLow:vLow,velocityHigh:vHigh,sample:copies.get(s)});
    });Object.freeze(this.zones);Object.freeze(this);
  }
  createVoice(e,rate,triggerIndex){
    const zones=this.zones.filter(z=>e.pitch>=z.keyLow&&e.pitch<=z.keyHigh&&e.velocity>=z.velocityLow&&e.velocity<=z.velocityHigh);
    if(!zones.length)return null;
    const z=zones[triggerIndex%zones.length],s=z.sample,step=s.sampleRate/rate*(z.pitched?2**((e.pitch-s.rootNote)/12):1);
    if(step<.125||step>8)return null;
    return {sample:s,step,gain:this.gain,oneShot:this.oneShot};
  }
  length(v){return Math.ceil(v.sample.pcm.length/v.step);}
  value(v,age){return resample(v.sample.pcm,age*v.step,v.step)*v.gain;}
}
export class SineInstrument {
  constructor({gain=.2}={}){if(!unit(gain))throw new TypeError('gain');this.gain=gain;this.chokeGroup=null;Object.freeze(this);}
  createVoice(e,rate){const frequency=440*2**((e.pitch-69)/12);if(frequency>=rate*.45)return null;return {frequency,rate,gain:this.gain,oneShot:false};}
  length(){return Infinity;}
  value(v,age){return Math.sin(age*2*Math.PI*v.frequency/v.rate)*v.gain;}
}
export class InstrumentRack {
  constructor(sampleRate,instruments,{polyphony=24,queueLimit=4096}={}){
    if(!int(sampleRate,8000,96000)||!(instruments instanceof Map)||!instruments.size||instruments.size>32||!int(polyphony,1,64)||!int(queueLimit,1,16384))throw new TypeError('Rack options');
    for(const [id,i] of instruments)if(typeof id!=='string'||!i||!['createVoice','length','value'].every(k=>typeof i[k]==='function'))throw new TypeError('Instrument interface');
    this.sampleRate=sampleRate;this.instruments=new Map(instruments);this.polyphony=polyphony;this.queueLimit=queueLimit;this.reset();
  }
  reset(){this.frame=0;this.queue=[];this.voices=[];this.triggers=new Map();this.nextId=1;this.stats={accepted:0,dropped:0,unmapped:0,choked:0};}
  schedule(events){
    if(!Array.isArray(events)||this.queue.length+events.length>this.queueLimit)throw new RangeError('Event queue limit');
    const checked=events.map(validateEvent);for(const e of checked)if(e.frame<this.frame||!this.instruments.has(e.instrument))throw new RangeError('Past/unknown instrument event');
    const ids=checked.map(e=>{const id=this.nextId++;this.queue.push({...e,id});return id;});this.queue.sort((a,b)=>a.frame-b.frame||a.id-b.id);return ids;
  }
  noteOff(id){if(!int(id,1,Number.MAX_SAFE_INTEGER))throw new TypeError('note id');const v=this.voices.find(v=>v.id===id);if(v)this.release(v,Math.round(this.sampleRate*.05));}
  release(v,frames){
    frames=Math.max(1,frames);
    if(v.releaseAt===null){v.releaseAt=v.age;v.releaseFrames=frames;v.releaseStartGain=1;}
    else {const remaining=Math.max(0,v.releaseFrames-(v.age-v.releaseAt));if(frames<remaining){v.releaseStartGain*=remaining/v.releaseFrames;v.releaseAt=v.age;v.releaseFrames=frames;}}
  }
  stop(){this.queue=[];for(const v of this.voices)this.release(v,Math.round(this.sampleRate*.05));}
  dispatch(e){
    const i=this.instruments.get(e.instrument),trigger=this.triggers.get(e.instrument)||0,voice=i.createVoice(e,this.sampleRate,trigger);
    if(!voice){this.stats.unmapped++;return;}
    if(this.voices.length>=this.polyphony){this.stats.dropped++;return;}
    if(i.chokeGroup)for(const v of this.voices)if(v.instrument.chokeGroup===i.chokeGroup){this.release(v,Math.round(this.sampleRate*.005));this.stats.choked++;}
    this.triggers.set(e.instrument,trigger+1);this.voices.push({...e,instrument:i,voice,age:0,length:i.length(voice),releaseAt:null,releaseFrames:0,releaseStartGain:1});this.stats.accepted++;
  }
  render(left,right){
    if(!(left instanceof Float32Array)||!(right instanceof Float32Array)||left.length!==right.length||(left.buffer===right.buffer&&left.byteOffset<right.byteOffset+right.byteLength&&right.byteOffset<left.byteOffset+left.byteLength))throw new TypeError('Distinct equal-length Float32Array output');
    for(let n=0;n<left.length;n++,this.frame++){
      this.voices=this.voices.filter(v=>v.age<v.length&&(v.releaseAt===null||v.age-v.releaseAt<v.releaseFrames));
      while(this.queue.length&&this.queue[0].frame===this.frame)this.dispatch(this.queue.shift());
      let l=0,r=0;
      for(let i=this.voices.length-1;i>=0;i--){
        const v=this.voices[i];if(!v.voice.oneShot&&v.age>=v.duration)this.release(v,Math.round(this.sampleRate*.05));
        if(v.age>=v.length||(v.releaseAt!==null&&v.age-v.releaseAt>=v.releaseFrames)){this.voices.splice(i,1);continue;}
        let env=Math.min(1,v.age/Math.max(1,Math.round(this.sampleRate*.001)));
        if(Number.isFinite(v.length))env*=Math.min(1,(v.length-v.age-1)/Math.max(1,Math.round(this.sampleRate*.002)));
        if(v.releaseAt!==null)env*=v.releaseStartGain*Math.max(0,1-(v.age-v.releaseAt)/v.releaseFrames);
        const x=v.instrument.value(v.voice,v.age)*v.velocity*env;
        if(!Number.isFinite(x))throw new Error('Non-finite instrument output');
        l+=x*Math.sqrt(1-v.pan);r+=x*Math.sqrt(v.pan);v.age++;
      }
      if(!Number.isFinite(Math.fround(l))||!Number.isFinite(Math.fround(r)))throw new Error('Non-finite stereo sum');
      left[n]=l;right[n]=r;
    }
  }
}
