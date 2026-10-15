// SPDX-License-Identifier: AGPL-3.0-only
import {EnvironmentAudio} from './environment-audio.js';
// Original event score and sample-free instruments. No recordings or MIDI assets.
const SIZE = 4096, SINE = new Float64Array(SIZE + 1);
for (let i=0;i<=SIZE;i++) SINE[i]=Math.sin(i*2*Math.PI/SIZE);
const wrap=x=>x-Math.floor(x);
function sine(p) { const x=wrap(p)*SIZE,i=Math.floor(x); return SINE[i]+(SINE[i+1]-SINE[i])*(x-i); }
const clamp=(v,f)=>Number.isFinite(v)?Math.max(0,Math.min(1,v)):f;
export const DEFAULTS=Object.freeze({intensity:.5,brightness:.45,motion:.35,timbre:.5,warmth:0,strength:0,width:.5,wash:0,pad:.65,pluck:.55,bell:.35,texture:.20,pulse:.15,evolution:0,rainType:0,rain:0,thunder:0,wind:0});
const CHORDS=[[50,57,62,64],[53,57,60,64],[55,57,62,65]];
const MOTIF=[2,1,3,-1,1,0,-1,2];
const LAYERS=['pad','pluck','bell','texture','pulse'];
/** Sample-clock score. advanceTo can inspect hours of events without rendering PCM.
 * sink.noteOn(frame, instrument, pitch, durationFrames, velocity, pan) receives
 * immutable scalar event data. Each note has an explicit, sample-exact note-off.
 * Evolution zero: exactly three related harmonies in the first three hours.
 */
export class EventScore {
  constructor(rate,seed=1) { if(!Number.isInteger(rate)||rate<8000||rate>192000)throw new RangeError('sampleRate must be an integer in 8000..192000');this.rate=rate; this.seed=seed>>>0; this.reset(); }
  reset() { this.state=this.seed;this.next=0;this.step=0;this.chord=0;this.chordAge=0;this.padAt=0;this.textureAt=0;this.melodyAt=0;this.chordChanges=0;this.eventCount=0; }
  random() { this.state=(Math.imul(this.state,1664525)+1013904223)>>>0;return this.state/4294967296; }
  emit(sink,frame,instrument,pitch,seconds,velocity) { this.eventCount++;sink.noteOn(frame,instrument,pitch,Math.round(seconds*this.rate),velocity,.15+.7*this.random()); }
  advanceTo(frame,evolution,sink) {
    if(!Number.isSafeInteger(frame))throw new RangeError('finite integer sample frame required');
    const e=clamp(evolution,0);
    while(this.next<=frame) {
      const at=this.next, chordLength=Math.round(this.rate*3600*Math.exp(-5*e));
      if(at-this.chordAge>=chordLength) { this.chord=(this.chord+1)%3;this.chordAge=at;this.chordChanges++;this.padAt=at; }
      const notes=CHORDS[this.chord];
      if(at>=this.padAt) {
        for(let j=0;j<4;j++) this.emit(sink,at,0,notes[j],26-10*e,.65+.12*this.random());
        this.padAt=at+Math.round(this.rate*(22-8*e));
      }
      if(at>=this.textureAt) { this.emit(sink,at,3,notes[2]+12,32,.35);this.textureAt=at+Math.round(this.rate*29); }
      if(at>=this.melodyAt) {
        const m=MOTIF[this.step%8];
        if(m>=0) this.emit(sink,at,1,notes[(m+Math.floor(this.step/32)%2)%4]+12,3.8,.65+.25*this.random());
        if(this.step%4===2) this.emit(sink,at,2,notes[(this.step>>2)%4]+24,7,.45+.2*this.random());
        if(this.step%2===0) this.emit(sink,at,4,notes[0]+12,1.7,.5);
        this.step++;
        this.melodyAt=at+Math.round(this.rate*(this.step===1?3:(18-16.4*e)*(this.step%8===0?1.6:1)));
      }
      this.next=Math.min(this.padAt,this.textureAt,this.melodyAt,this.chordAge+chordLength);
    }
  }
}
function voice() {return {active:false,phase:0,phaseB:0,age:0,duration:0,release:0,frequency:0,velocity:0,instrument:0,panL:0,panR:0,midi:0,off:false};}
export class AmbientEngine {
  constructor(sampleRate,seed=1) {
    if(!Number.isInteger(sampleRate)||sampleRate<8000||sampleRate>192000) throw new RangeError('sampleRate must be an integer in 8000..192000');
    this.sampleRate=sampleRate;this.seed=Number.isFinite(seed)?seed>>>0:1;this.parameters=DEFAULTS;
    this.voices=Array.from({length:32},voice);this.score=new EventScore(sampleRate,this.seed);
    this.environment=new EnvironmentAudio(sampleRate,this.seed);this.macros=new MacroBus(sampleRate);
    this.smoothing=1-Math.exp(-1/(sampleRate*1.5));this.dcPole=Math.exp(-2*Math.PI*12/sampleRate);
    this.layerGains=new Float64Array([.65,.55,.35,.20,.15]);
    this.intensity=.5;this.brightness=.45;this.motion=.35;this.timbre=.5;
    this.frame=0;this.fade=0;this.playing=false;this.outputL=this.outputR=this.previousL=this.previousR=this.dcL=this.dcR=0;
    this.noteOnCount=0;this.noteOffCount=0;this.droppedNotes=0;
  }
  start(){this.playing=true;this.environment.start();}
  stop(){this.playing=false;this.environment.stop();}
  isSilent(){return this.fade===0&&!this.playing;}
  /** Rendering-thread transport reset; clears voices/tails, preserves targets. */
  reset(){this.playing=false;this.fade=0;this.frame=0;this.score.reset();for(const v of this.voices)v.active=false;this.environment.reset();this.macros=new MacroBus(this.sampleRate);this.outputL=this.outputR=this.previousL=this.previousR=this.dcL=this.dcR=0;this.noteOnCount=this.noteOffCount=this.droppedNotes=0;}
  setParameters(update) {
    if(!update||typeof update!=='object')throw new TypeError('parameters must be an object');
    const p={};for(const key of Object.keys(DEFAULTS))p[key]=key==='rainType'?(Number.isFinite(update[key])?Math.max(0,Math.min(3,Math.round(update[key]))):this.parameters[key]):clamp(update[key],this.parameters[key]);
    this.parameters=Object.freeze(p);this.environment.setParameters(p);
  }
  noteOn(frame,instrument,pitch,duration,velocity,pan) {
    let v=null;for(let i=0;i<this.voices.length;i++)if(!this.voices[i].active){v=this.voices[i];break;}
    if(!v){this.droppedNotes++;return;}
    v.active=true;v.off=false;v.phase=0;v.phaseB=0;v.age=0;v.duration=duration;v.release=Math.round(this.sampleRate*(instrument===0?4:instrument===3?6:.8));
    v.instrument=instrument;v.frequency=440*Math.pow(2,(pitch-69)/12);v.midi=pitch;v.velocity=velocity;v.panL=Math.sqrt(1-pan);v.panR=Math.sqrt(pan);this.noteOnCount++;
  }
  render(left,right) {
    if(!(left instanceof Float32Array)||!(right instanceof Float32Array)||left.length!==right.length)throw new TypeError('equal-length Float32Array stereo channels required');
    const target=this.parameters,playing=this.playing;
    for(let i=0;i<left.length;i++){this.next(target,playing);left[i]=this.outputL;right[i]=this.outputR;}
  }
  next(target,playing) {
    this.intensity+=this.smoothing*(target.intensity-this.intensity);this.brightness+=this.smoothing*(target.brightness-this.brightness);this.motion+=this.smoothing*(target.motion-this.motion);this.timbre+=this.smoothing*(target.timbre-this.timbre);
    for(let i=0;i<5;i++)this.layerGains[i]+=this.smoothing*(target[LAYERS[i]]-this.layerGains[i]);
    if(!playing&&this.fade===0){this.outputL=this.outputR=0;return;}
    if(playing)this.score.advanceTo(this.frame,target.evolution,this);
    let left=0,right=0;
    for(let i=0;i<this.voices.length;i++) {
      const v=this.voices[i];if(!v.active)continue;
      if(v.age>=v.duration&&!v.off){v.off=true;this.noteOffCount++;}
      if(v.age>=v.duration+v.release){v.active=false;continue;}
      const t=v.age/this.sampleRate,p=v.phase,k=v.instrument;
      const attack=k===0?3:k===3?5:k===2?.025:k===1?.012:.08;
      let env=Math.min(1,t/attack);env=env*env*(3-2*env);
      if(v.off){const r=Math.max(0,1-(v.age-v.duration)/v.release);env*=r*r*(3-2*r);}
      let value=0;
      // Band-limited additive spectra (each partial below 45% of sample rate).
      const h2=v.frequency*2<this.sampleRate*.45?sine(p*2):0;
      const h3=v.frequency*3<this.sampleRate*.45?sine(p*3):0;
      if(k===0)value=(sine(p)+h2*(.12+.13*this.brightness)+h3*.045)*(.86+.14*sine(t*.055))* .075;
      else if(k===1)value=(sine(p)+h2*.4+h3*.18)*Math.exp(-t/(.65+.7*this.timbre))*.19;
      else if(k===2){const metallic=v.frequency*2.71<this.sampleRate*.45?sine(v.phaseB):0;value=(sine(p)*Math.exp(-t/2.8)+metallic*.45*Math.exp(-t/.8))*.15;}
      else if(k===3)value=(sine(p)+sine(v.phaseB)*.5)*(.6+.4*sine(t*.11))* .04;
      else value=(sine(p)+h2*.15)*Math.exp(-t/.32)*.17;
      value*=env*v.velocity*this.layerGains[k];left+=value*v.panL;right+=value*v.panR;
      const inc=v.frequency*(1+.0005*this.motion*sine(t*.13))/this.sampleRate;v.phase=wrap(v.phase+inc);v.phaseB=wrap(v.phaseB+inc*(k===2?2.71:1.003));v.age++;
    }
    left*=1+this.intensity*1.4;right*=1+this.intensity*1.4;
    this.environment.next();this.macros.process(left+this.environment.outputL,right+this.environment.outputR,target);
    left=this.macros.left;right=this.macros.right;
    this.dcL=left-this.previousL+this.dcPole*this.dcL;this.dcR=right-this.previousR+this.dcPole*this.dcR;this.previousL=left;this.previousR=right;
    this.outputL=.85*this.dcL/(1+Math.abs(this.dcL))*this.fade;this.outputR=.85*this.dcR/(1+Math.abs(this.dcR))*this.fade;
    const step=1/(2*this.sampleRate);this.fade=playing?Math.min(1,this.fade+step):Math.max(0,this.fade-step);if(!playing&&this.fade<1e-12)this.fade=0;this.frame++;
  }
}

/** Original tone/space macros, not a model of any commercial processor.
 * Four orthogonally mixed delay lines form ONE shared stereo reverb bus.
 * Feedback norm <= .72; damping is passive; no objects allocated per sample.
 */
export class MacroBus {
  constructor(rate) {
    this.smooth = 1 - Math.exp(-1 / (rate * .05));
    this.tonePole = 1 - Math.exp(-2 * Math.PI * 900 / rate);
    this.damp = 1 - Math.exp(-2 * Math.PI * 2600 / rate);
    this.warmth = 0; this.strength = 0; this.width = .5; this.wash = 0;
    this.lowL = 0; this.lowR = 0; this.left = 0; this.right = 0;
    this.lines = [.0311, .0437, .0593, .0719].map(t => new Float64Array(Math.floor(rate * t) + 1));
    this.pos = new Int32Array(4); this.filtered = new Float64Array(4);
  }
  process(left, right, target) {
    this.warmth += this.smooth * (target.warmth - this.warmth);
    this.strength += this.smooth * (target.strength - this.strength);
    this.width += this.smooth * (target.width - this.width);
    this.wash += this.smooth * (target.wash - this.wash);
    this.lowL += this.tonePole * (left - this.lowL);
    this.lowR += this.tonePole * (right - this.lowR);
    // Warmth darkens and gently saturates; strength adds compensated presence.
    left += .65 * this.warmth * (this.lowL - left);
    right += .65 * this.warmth * (this.lowR - right);
    left = left / (1 + this.warmth * Math.abs(left));
    right = right / (1 + this.warmth * Math.abs(right));
    left = (left + .6 * this.strength * (left - this.lowL)) / (1 + .3 * this.strength);
    right = (right + .6 * this.strength * (right - this.lowR)) / (1 + .3 * this.strength);
    // Odd soft nonlinearity supplies restrained original harmonics.
    left /= 1 + .8 * this.strength * Math.abs(left);
    right /= 1 + .8 * this.strength * Math.abs(right);
    for (let i = 0; i < 4; i++) this.filtered[i] += this.damp * (this.lines[i][this.pos[i]] - this.filtered[i]);
    const a = this.filtered[0], b = this.filtered[1], c = this.filtered[2], d = this.filtered[3];
    this.lines[0][this.pos[0]] = left * .25 + .36 * (a + b + c + d);
    this.lines[1][this.pos[1]] = right * .25 + .36 * (a - b + c - d);
    this.lines[2][this.pos[2]] = left * .25 + .36 * (a + b - c - d);
    this.lines[3][this.pos[3]] = right * .25 + .36 * (a - b - c + d);
    for (let i = 0; i < 4; i++) if (++this.pos[i] === this.lines[i].length) this.pos[i] = 0;
    const wet = .5 * this.wash;
    left = left * (1 - wet) + (a + c) * wet;
    right = right * (1 - wet) + (b + d) * wet;
    // 0 = mono, .5 = unchanged, 1 = twice the side signal with headroom compensation.
    if (this.width !== .5) {
      const mid = (left + right) * .5, side = (left - right) * this.width;
      const gain = 1 / Math.max(1, this.width * 2);
      left = (mid + side) * gain; right = (mid - side) * gain;
    }
    this.left = left; this.right = right;
  }
}
