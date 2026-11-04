// SPDX-License-Identifier: AGPL-3.0-only
// Construct off the render thread: owned PCM, lookup and resampling kernels are
// prepared once. trigger/next/stop/reset allocate nothing. Single render owner.
const MAX_BYTES=32*1024*1024, PHASES=128, TAPS=16, HALF=8;
const integer=(n,a,b)=>Number.isSafeInteger(n)&&n>=a&&n<=b;
const unit=n=>Number.isFinite(n)&&n>=0&&n<=1;
const clip=n=>Number.isFinite(n)?Math.max(0,Math.min(1,n)):0;
const typedLength=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Float32Array.prototype),'length').get;
function kernel(step){
 const table=new Float64Array((PHASES+1)*TAPS),cut=.90*Math.min(1,1/step);
 for(let p=0;p<=PHASES;p++){
  let sum=0;const frac=p/PHASES;
  for(let t=0;t<TAPS;t++){const x=frac-(t-7),w=Math.abs(x)<HALF?.5+.5*Math.cos(Math.PI*x/HALF):0,y=x*cut;
   const v=cut*(Math.abs(y)<1e-12?1:Math.sin(Math.PI*y)/(Math.PI*y))*w;table[p*TAPS+t]=v;sum+=v;}
  for(let t=0;t<TAPS;t++)table[p*TAPS+t]/=sum;
 }
 return table;
}
function compileBank(rate,bank){
  if(!integer(rate,8000,192000)||!bank||bank.sampleRate!==rate||!Array.isArray(bank.samples)||!integer(bank.samples.length,1,96)||!Array.isArray(bank.instruments)||bank.instruments.length!==5)throw new TypeError('Invalid melodic bank/rate');
  let bytes=0;
  for(const s of bank.samples){const n=s?.pcm instanceof Float32Array?typedLength.call(s.pcm):0;
   if(!integer(s?.sampleRate,8000,96000)||!integer(n,2,s.sampleRate*12)||!integer(s.rootNote,0,127)||!integer(s.loopStart,0,n-1)||!integer(s.loopEnd,0,n)||!integer(s.crossfade,0,n)||!((s.loopEnd===0&&s.loopStart===0&&s.crossfade===0)||(s.loopEnd>s.loopStart&&s.crossfade>=16&&s.loopEnd-s.loopStart>2*s.crossfade)))throw new TypeError('Invalid melodic sample/loop');
   bytes+=n*4;if(bytes>MAX_BYTES)throw new RangeError('Melodic decoded budget');
  }
  const samples=bank.samples.map(s=>{const pcm=new Float32Array(typedLength.call(s.pcm));pcm.set(s.pcm);for(const v of pcm)if(!Number.isFinite(v)||Math.abs(v)>2)throw new TypeError('Invalid melodic PCM');return Object.freeze({...s,pcm});});
  const kernels=new Map();const instruments=new Array(5);
  for(const d of bank.instruments){
   if(!integer(d?.layer,0,4)||instruments[d.layer]||!unit(d.gain)||!Number.isFinite(d.attack)||d.attack<.001||d.attack>4||!Number.isFinite(d.release)||d.release<.005||d.release>4||!Array.isArray(d.zones)||!integer(d.zones.length,1,192))throw new TypeError('Invalid melodic instrument');
   const zones=d.zones.map(z=>{if(!integer(z?.sampleIndex,0,samples.length-1)||!integer(z.keyLow,0,127)||!integer(z.keyHigh,z.keyLow,127)||!integer(z.velocityLow,0,127)||!integer(z.velocityHigh,z.velocityLow,127)||!Number.isFinite(z.gain)||z.gain<0||z.gain>32)throw new TypeError('Invalid melodic zone');return Object.freeze({...z});});
   const lookup=new Uint16Array(128*128).fill(65535),groups=[],ids=new Map();
   for(let key=0;key<128;key++)for(let vel=0;vel<128;vel++){
    const matches=[];for(let j=0;j<zones.length;j++){const z=zones[j];if(key>=z.keyLow&&key<=z.keyHigh&&vel>=z.velocityLow&&vel<=z.velocityHigh)matches.push(j);}
    if(!matches.length)continue;const signature=key+':'+matches.join(',');let id=ids.get(signature);
    if(id===undefined){id=groups.length;ids.set(signature,id);const entries=matches.map(j=>{const z=zones[j],s=samples[z.sampleIndex],step=s.sampleRate/rate*2**((key-s.rootNote)/12);if(step<.125||step>8)throw new RangeError('Melodic pitch ratio');let table=kernels.get(step);if(!table){if(kernels.size>=128)throw new RangeError("Melodic kernel budget");table=kernel(step);kernels.set(step,table);}return Object.freeze({sample:s,step,table,gain:z.gain});});groups.push({entries});}lookup[key*128+vel]=id;
   }
   instruments[d.layer]={gain:d.gain,attack:Math.max(1,Math.round(d.attack*rate)),release:Math.max(2,Math.round(d.release*rate)),lookup,groups};
  }
 return {schema:"sou1.melodic-compiled.v1",sampleRate:rate,samples,instruments,preparedBytes:bytes,kernelBytes:kernels.size*(PHASES+1)*TAPS*8};
}
// Lightweight adoption validates bounded structure, not millions of PCM values.
// PCM and tables have already passed compileBank on the worker. ArrayBuffers,
// never SharedArrayBuffers, must be transferred so no producer can mutate them.
function adoptPrepared(rate,b){
 if(!b||b.schema!=='sou1.melodic-compiled.v1'||b.sampleRate!==rate||!integer(rate,8000,192000)||!Array.isArray(b.samples)||!integer(b.samples.length,1,96)||!Array.isArray(b.instruments)||b.instruments.length!==5||!integer(b.preparedBytes,8,MAX_BYTES)||!integer(b.kernelBytes,1,128*(PHASES+1)*TAPS*8))throw new TypeError('Invalid prepared melodic bank');
 let bytes=0;const samples=new Set();
 for(const s of b.samples){if(!s||!(s.pcm instanceof Float32Array)||!(s.pcm.buffer instanceof ArrayBuffer)||!integer(s.sampleRate,8000,96000)||!integer(s.pcm.length,2,s.sampleRate*12)||!integer(s.rootNote,0,127)||!integer(s.loopStart,0,s.pcm.length-1)||!integer(s.loopEnd,0,s.pcm.length)||!integer(s.crossfade,0,s.pcm.length)||!((s.loopEnd===0&&s.loopStart===0&&s.crossfade===0)||(s.loopEnd>s.loopStart&&s.crossfade>=16&&s.loopEnd-s.loopStart>2*s.crossfade)))throw new TypeError('Invalid prepared melodic PCM');bytes+=s.pcm.byteLength;samples.add(s);}
 if(bytes!==b.preparedBytes)throw new RangeError('Prepared melodic size mismatch');
 const tables=new Set();
 for(const d of b.instruments){if(!d||!unit(d.gain)||!integer(d.attack,1,rate*4)||!integer(d.release,2,rate*4)||!(d.lookup instanceof Uint16Array)||!(d.lookup.buffer instanceof ArrayBuffer)||d.lookup.length!==128*128||!Array.isArray(d.groups)||d.groups.length>16384)throw new TypeError('Invalid prepared melodic instrument');
  for(const g of d.groups){if(!g||!Array.isArray(g.entries)||!integer(g.entries.length,1,192))throw new TypeError('Invalid prepared melodic group');for(const e of g.entries){if(!e||!samples.has(e.sample)||!Number.isFinite(e.step)||e.step<.125||e.step>8||!Number.isFinite(e.gain)||e.gain<0||e.gain>32||!(e.table instanceof Float64Array)||!(e.table.buffer instanceof ArrayBuffer)||e.table.length!==(PHASES+1)*TAPS)throw new TypeError('Invalid prepared melodic entry');tables.add(e.table);if(tables.size>128)throw new RangeError('Prepared melodic kernel budget');}}
 }
 if(tables.size*(PHASES+1)*TAPS*8!==b.kernelBytes)throw new TypeError('Prepared melodic kernel size mismatch');return b;
}
export function melodicTransferList(prepared){
 adoptPrepared(prepared.sampleRate,prepared);const buffers=new Set();
 for(const s of prepared.samples)buffers.add(s.pcm.buffer);
 for(const d of prepared.instruments){buffers.add(d.lookup.buffer);for(const g of d.groups)for(const e of g.entries)buffers.add(e.table.buffer);}
 return [...buffers];
}
export class LiveMelodicPool {
 #samples; #instruments; #voices; #cursors; #voiceLimit; #rate; #active=0; #enabled=true; #melody=true; #stopFrames;
 constructor(rate,bank,{polyphony=16,prepared=false}={}){
  if(!integer(polyphony,1,32))throw new RangeError('Melodic voice budget');
  const compiled=prepared?adoptPrepared(rate,bank):compileBank(rate,bank);
  this.#samples=compiled.samples;this.#instruments=compiled.instruments;
  this.#cursors=this.#instruments.map(d=>new Uint32Array(d.groups.length));
  this.#voiceLimit=polyphony;
  this.#voices=Array.from({length:32},()=>({active:false,sample:null,table:null,layer:0,position:0,step:0,age:0,gate:0,attack:1,release:1,releaseLeft:0,releaseGain:1,releaseStep:0,attackAtRelease:1,level:0,panL:0,panR:0}));
  this.#rate=rate;this.#stopFrames=Math.max(2,Math.round(.05*rate));this.outputL=0;this.outputR=0;
  this.stats=Object.seal({accepted:0,dropped:0,unmapped:0});this.preparedBytes=compiled.preparedBytes;this.kernelBytes=compiled.kernelBytes;
 }
 static prepare(rate,wireBank){return compileBank(rate,wireBank);}
 /** Internal ownership transfer seam. Only adopt an intact worker-prepared DTO
  * received with melodicTransferList. Never pass caller-shared mutable PCM. */
 static fromPrepared(rate,prepared,options={}){return new LiveMelodicPool(rate,prepared,{...options,prepared:true});}
 get sampleRate(){return this.#rate;} get activeVoices(){return this.#active;} get polyphony(){return this.#voiceLimit;} get capacity(){return this.#voices.length;} get enabled(){return this.#enabled;}
 setVoiceLimit(limit){
  if(!integer(limit,1,32))throw new RangeError('Melodic voice limit');
  this.#voiceLimit=limit;let excess=this.#active-limit;
  // Retire highest-index voices smoothly. Repeated limits cannot extend fades.
  for(let i=this.#voices.length-1;i>=0&&excess>0;i--){const v=this.#voices[i];if(v.active){this.#fade(v,this.#stopFrames);excess--;}}
 }
 setEnabled(value){const next=value===true;if(this.#enabled&&!next)this.stop();this.#enabled=next;}
 // The legacy Melody control affects only pluck/lead and bell/reply, NOT pads.
 setMelodyEnabled(value){const next=value===true;if(this.#melody&&!next)for(let i=0;i<this.#voices.length;i++){const v=this.#voices[i];if(v.active&&(v.layer===1||v.layer===2))this.#fade(v,this.#stopFrames);}this.#melody=next;}
 trigger(layer,pitch,durationSeconds,velocity,pan){
  if(!integer(layer,0,4)||!integer(pitch,0,127)||!Number.isFinite(durationSeconds)||durationSeconds<=0||durationSeconds>120||!unit(velocity)||!unit(pan)||!this.#enabled||(!this.#melody&&(layer===1||layer===2))){this.stats.dropped++;return false;}
  const inst=this.#instruments[layer],id=inst.lookup[pitch*128+Math.round(velocity*127)];if(id===65535||id>=inst.groups.length){this.stats.unmapped++;return false;}
  if(this.#active>=this.#voiceLimit){this.stats.dropped++;return false;}
  let v=null;for(let i=0;i<this.#voices.length;i++)if(!this.#voices[i].active){v=this.#voices[i];break;}if(!v){this.stats.dropped++;return false;}
  const group=inst.groups[id],cursors=this.#cursors[layer],e=group.entries[cursors[id]];cursors[id]=(cursors[id]+1)%group.entries.length;
  v.active=true;v.sample=e.sample;v.table=e.table;v.position=0;v.step=e.step;v.layer=layer;v.age=0;v.gate=Math.max(1,Math.round(durationSeconds*this.#rate));v.attack=inst.attack;v.release=inst.release;v.releaseLeft=0;v.releaseGain=1;v.releaseStep=0;v.attackAtRelease=1;v.level=velocity*inst.gain*e.gain;v.panL=Math.sqrt(1-pan);v.panR=Math.sqrt(pan);this.#active++;this.stats.accepted++;return true;
 }
 #fade(v,frames){if(v.releaseLeft>0&&v.releaseLeft<=frames)return;if(v.releaseLeft===0)v.attackAtRelease=Math.min(1,Math.max(0,v.age-1)/v.attack);v.releaseLeft=frames;v.releaseStep=v.releaseGain/(frames-1);}
 stop(){for(let i=0;i<this.#voices.length;i++){const v=this.#voices[i];if(v.active)this.#fade(v,this.#stopFrames);}}
 release(){this.stop();}
 #read(v,pos){
  const base=Math.floor(pos),phase=(pos-base)*PHASES,p=Math.floor(phase),f=phase-p,offset=p*TAPS,pcm=v.sample.pcm,table=v.table;let out=0;
  for(let j=0;j<TAPS;j++){const at=base+j-7;if(at>=0&&at<pcm.length){const w=table[offset+j]+f*(table[offset+TAPS+j]-table[offset+j]);out+=pcm[at]*w;}}return out;
 }
 next(gains,enabled=this.#enabled){
  this.setEnabled(enabled);const valid=gains instanceof Float64Array&&gains.length===5;let left=0,right=0;
  for(let i=0;i<this.#voices.length;i++){
   const v=this.#voices[i];if(!v.active)continue;if(v.age>=v.gate&&v.releaseLeft===0)this.#fade(v,v.release);
   const s=v.sample;let sample=this.#read(v,v.position);
   if(s.loopEnd>0&&v.position>=s.loopEnd-s.crossfade){const x=(v.position-(s.loopEnd-s.crossfade))/s.crossfade;sample=sample*(1-x)+this.#read(v,s.loopStart+v.position-(s.loopEnd-s.crossfade))*x;}
   let env=v.releaseLeft>0?v.attackAtRelease*(v.releaseLeft===1?0:v.releaseGain):Math.min(1,v.age/v.attack);
   if(s.loopEnd===0)env*=Math.min(1,Math.max(0,(s.pcm.length-1-v.position)/(s.sampleRate*.01)));
   const out=sample*env*v.level*(valid?clip(gains[v.layer]):0);left+=out*v.panL;right+=out*v.panR;
   v.age++;v.position+=v.step;if(s.loopEnd>0&&v.position>=s.loopEnd)v.position=s.loopStart+s.crossfade+(v.position-s.loopEnd);
   if(v.releaseLeft>0){v.releaseLeft--;v.releaseGain=Math.max(0,v.releaseGain-v.releaseStep);if(v.releaseLeft===0){v.active=false;v.sample=null;v.table=null;this.#active--;}}
   if(v.active&&s.loopEnd===0&&v.position>=s.pcm.length-1){v.active=false;v.sample=null;v.table=null;this.#active--;}
  }
  this.outputL=left;this.outputR=right;
 }
 reset(){for(let i=0;i<this.#voices.length;i++){const v=this.#voices[i];v.active=false;v.sample=null;v.table=null;}for(let i=0;i<this.#cursors.length;i++)this.#cursors[i].fill(0);this.#active=0;this.outputL=0;this.outputR=0;this.stats.accepted=0;this.stats.dropped=0;this.stats.unmapped=0;}
}
