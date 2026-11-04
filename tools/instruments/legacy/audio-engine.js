// SPDX-License-Identifier: AGPL-3.0-only
import {EnvironmentAudio} from './environment-audio.js';
// Original event score and sample-free instruments. No recordings or MIDI assets.
const SIZE = 4096, SINE = new Float64Array(SIZE + 1);
for (let i=0;i<=SIZE;i++) SINE[i]=Math.sin(i*2*Math.PI/SIZE);
const wrap=x=>x-Math.floor(x);
function sine(p) { const x=wrap(p)*SIZE,i=Math.floor(x); return SINE[i]+(SINE[i+1]-SINE[i])*(x-i); }
const clamp=(v,f)=>Number.isFinite(v)?Math.max(0,Math.min(1,v)):f;
export const DEFAULTS=Object.freeze({intensity:.5,brightness:.45,motion:.35,timbre:.5,warmth:0,strength:0,width:.5,wash:0,pad:.65,pluck:.55,bell:.35,texture:.20,pulse:.15,evolution:0,rainType:0,rain:0,thunder:0,wind:0,composition:0,ambient:1,counterpoint:0,rhythmic:0,arpeggio:0,density:.5,complexity:.5,swing:0,bpm:72,polyphony:16,melodyEnabled:true,drumsEnabled:false,kick:.65,snare:.4,hihat:.3,toms:.35,cymbal:.2});
const CHORDS=[[50,57,62,64],[53,57,60,64],[55,57,62,65]];
const MOTIF=[2,1,3,-1,1,0,-1,2];
const LAYERS=['pad','pluck','bell','texture','pulse'];
const DRUMS=['kick','snare','hihat','toms','cymbal'];
const SCALE=[0,2,3,5,7,8,10], PROGRESSIONS=[[0,5,3,4,0,3,4,0],[0,3,6,2,5,1,4,0],[0,5,2,6,3,0,4,0],[0,2,5,3,0,6,4,0]];
const MOTIFS=[[0,2,1,4,3,2,1,0],[0,1,3,2,4,2,1,0],[4,2,3,1,2,0,1,0],[0,3,2,1,4,5,2,0],[2,0,1,3,4,2,3,0],[0,1,2,4,3,5,4,2],[4,3,1,2,0,2,1,0],[0,2,4,3,1,2,5,4]];
const RHYTHMS=[0x77,0xdd,0xb7,0xed,0x6f,0xf5,0xd7,0xbd];
const FORM=[0,0,1,0,1,2,1,3], ARPS=[[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]];
const degree=(d)=>SCALE[((d%7)+7)%7]+12*Math.floor(d/7);
/** Sample-clock score. advanceTo can inspect hours of events without rendering PCM.
 * sink.noteOn(frame, instrument, pitch, durationFrames, velocity, pan) receives
 * immutable scalar event data. Each note has an explicit, sample-exact note-off.
 * Evolution zero: exactly three related harmonies in the first three hours.
 */
export class EventScore {
  constructor(rate,seed=1) { if(!Number.isInteger(rate)||rate<8000||rate>192000)throw new RangeError('sampleRate must be an integer in 8000..192000');this.rate=rate; this.seed=seed>>>0; this.reset(); }
  reset() { this.state=this.seed;this.next=0;this.step=0;this.chord=0;this.chordAge=0;this.padAt=0;this.textureAt=0;this.melodyAt=0;this.chordChanges=0;this.eventCount=0;this.tick=0;this.beatNext=0;this.lastBass=38;this.lastTop=69;this.variant=Math.imul(this.seed^0x9e3779b9,2654435761)>>>0; }
  random() { this.state=(Math.imul(this.state,1664525)+1013904223)>>>0;return this.state/4294967296; }
  emit(sink,frame,instrument,pitch,seconds,velocity) { this.eventCount++;sink.noteOn(frame,instrument,pitch,Math.round(seconds*this.rate),velocity,.15+.7*this.random()); }
  advanceTo(frame,evolution,sink) {
    if(evolution&&typeof evolution==='object'){this.advanceComposition(frame,evolution,sink);return;}
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
  /** Eighth-note grid; 4/4 bars, eight-bar phrases, scale-safe motif development.
   * Long-form mode retains sparse pads; the other modes develop three registers.
   * Durations are exact gate lengths; the renderer dispatches noteOff at that frame.
   */
  advanceComposition(frame,p,sink) {
    if(!Number.isSafeInteger(frame))throw new RangeError('finite integer sample frame required');
    if(Math.round(this.beatNext)>frame)return;
    const weights=['ambient','counterpoint','rhythmic','arpeggio'].map((key,i)=>Number.isFinite(p[key])?clamp(p[key],0):(p.composition===i?1:0));
    const [ambient,counterpoint,rhythmic,arpeggio]=weights,drive=Math.max(counterpoint,rhythmic,arpeggio);
    const density=clamp(p.density,.5),complexity=clamp(p.complexity,.5),swing=clamp(p.swing,0);
    const norm=Math.sqrt(Math.max(1,ambient+counterpoint+rhythmic+arpeggio));
    while(Math.round(this.beatNext)<=frame){
      const at=Math.round(this.beatNext),tick=this.tick++,bar=Math.floor(tick/8),beat=tick%8,phrase=Math.floor(bar/8);
      const seconds=60/p.bpm,root=50+(this.seed%6),progression=PROGRESSIONS[(this.variant>>>20)%4];
      const ratio=ambient/Math.max(.001,ambient+drive),chordSpan=1+Math.floor(3*ratio);
      const ambientBeats=3600/seconds*Math.pow(16*seconds/3600,p.evolution);
      const ambientChord=Math.floor(tick*.5/ambientBeats+1e-9)%3;
      const chordDegree=drive===0?[0,2,3][ambientChord]:progression[Math.floor(bar/chordSpan)%8];
      const changed=chordDegree!==this.chord;
      if(changed){this.chord=chordDegree;this.chordChanges++;}
      const chord=drive===0?CHORDS[ambientChord].map(n=>n+this.seed%6):[root+degree(chordDegree),root+degree(chordDegree+2),root+degree(chordDegree+4)];
      const emit=(k,n,beats,v)=>{if(v>0)this.emit(sink,at,k,n,beats*seconds,Math.min(1,v/norm));};
      if((beat===0&&bar%chordSpan===0)||(drive===0&&changed)){
        for(let j=0;j<chord.length;j++){let n=chord[j];while(n>70)n-=12;while(n<50)n+=12;emit(0,n,3.3+10.7*ratio,(.53+.12*this.random())*(ambient+drive*.55));}
        let bass=chord[0]-12;while(bass-this.lastBass>7)bass-=12;while(bass-this.lastBass < -7)bass+=12;
        while(bass<33)bass+=12;while(bass>52)bass-=12;this.lastBass=bass;emit(4,bass,1.6+1.9*ratio,.72*Math.max(ambient,drive));
      }
      if(tick%32===0)emit(3,chord[1]+12,12,.32*Math.max(ambient,drive*.4));
      const chance=(Math.imul((tick+1)|0,this.variant|1)>>>0)/4294967296;
      const activeBeat=chance<.2+.8*density;
      if(p.melodyEnabled){
        const section=complexity<.25?0:FORM[phrase%8],rotation=Math.floor((((this.variant>>>4)%8)+section*2)*complexity*2);
        const motifIndex=(tick+rotation)%8,motif=complexity<.25?[0,0,2,2,4,4,2,0][motifIndex]:MOTIFS[(this.variant+section)%8][motifIndex];
        const direction=complexity>.5&&(((this.variant>>>7)&1)^(section===2?1:0))?-1:1;
        const chordTone=[0,2,4][(Math.floor(beat/2)+(this.variant>>>9)%3+section)%3];
        let d=chordDegree+(beat%2===0?chordTone:direction*motif);
        if(section===3&&bar%8===7&&beat>=6)d=chordDegree;
        let top=root+12+degree(d);while(top>86)top-=12;while(top<62)top+=12;
        if(top-this.lastTop>9&&top-12>=60)top-=12;if(this.lastTop-top>9&&top+12<=86)top+=12;
        if(ambient>0){if(tick%8===((this.variant>>>12)&3)*2&&activeBeat){emit(1,top,2.6,.58*ambient);this.lastTop=top;}if(tick%16===6+((this.variant>>>14)&3)*2&&activeBeat)emit(2,chord[2]+12,4,.4*ambient);}
        if(counterpoint>0&&activeBeat){
          emit(1,top,beat===7?.85:.43,(.58+(beat%2===0?.12:0))*counterpoint);this.lastTop=top;
          if(beat%2===(complexity>.4?((this.variant>>>10)&1):0)){let lower=root+degree(chordDegree+[4,2,0,2][(Math.floor(beat/2)+section+(this.variant>>>11)%4)%4]);emit(2,lower,.88,.42*counterpoint);}
          if(beat===4)emit(4,chord[2]-12,1.7,.58*counterpoint);
        }
        if(rhythmic>0){if(activeBeat&&((complexity<.25?0x55:RHYTHMS[(this.variant+section)%8])&(1<<beat))!==0){emit(1,top,.38,.72*rhythmic);this.lastTop=top;}if(beat%2===0)emit(4,chord[0]-12,.65,.72*rhythmic);if(beat===6&&activeBeat)emit(2,chord[2]+12,.8,.4*rhythmic);}
        if(arpeggio>0&&activeBeat){const order=ARPS[complexity<.25?0:(this.variant+section)%6];const n=chord[order[(tick+Math.floor(phrase/2))%3]]+((tick+((this.variant>>>15)&3))%4===3&&complexity>.35?24:12);emit(1,n,.7,(.52+.18*this.random())*arpeggio);this.lastTop=n;if(beat===4)emit(2,top,1.8,.4*arpeggio);}
      }
      if(p.drumsEnabled){
        if(beat===0||beat===4||(rhythmic>.4&&beat===5&&complexity>.4))emit(5,36,.25,.82);
        if(beat===2||beat===6)emit(6,38,.22,.66);
        if(chance<.35+.65*density)emit(7,42,.12,beat%2===0?.45:.27);
        if(bar%8===7&&beat>=5&&complexity>.35)emit(8,45+(7-beat)*2,.3,.55);
        if(bar%8===0&&beat===0)emit(9,49,1.8,.42);
      }
      // Swing alternates long/short eighths, keeping every complete beat exact.
      this.beatNext+=this.rate*seconds*(.5+(tick%2===0?1:-1)*.22*swing);
      this.next=Math.round(this.beatNext);this.step=this.tick;
    }
  }

}
const kIsMelody=k=>k===1||k===2;
function voice() {return {active:false,phase:0,phaseB:0,age:0,duration:0,release:0,frequency:0,velocity:0,instrument:0,panL:0,panR:0,midi:0,off:false,filtered:0,noiseState:1};}
export class AmbientEngine {
  constructor(sampleRate,seed=1) {
    if(!Number.isInteger(sampleRate)||sampleRate<8000||sampleRate>192000) throw new RangeError('sampleRate must be an integer in 8000..192000');
    this.sampleRate=sampleRate;this.seed=Number.isFinite(seed)?seed>>>0:1;this.parameters=DEFAULTS;
    this.voices=Array.from({length:44},voice);this.score=new EventScore(sampleRate,this.seed);
    this.environment=new EnvironmentAudio(sampleRate,this.seed);this.macros=new MacroBus(sampleRate);
    this.smoothing=1-Math.exp(-1/(sampleRate*1.5));this.dcPole=Math.exp(-2*Math.PI*12/sampleRate);
    this.layerGains=new Float64Array([.65,.55,.35,.20,.15]);this.drumGains=new Float64Array([.65,.4,.3,.35,.2]);this.drumSmoothing=1-Math.exp(-1/(sampleRate*.05));
    this.intensity=.5;this.brightness=.45;this.motion=.35;this.timbre=.5;
    this.frame=0;this.fade=0;this.playing=false;this.outputL=this.outputR=this.previousL=this.previousR=this.dcL=this.dcR=0;
    this.noteOnCount=0;this.noteOffCount=0;this.droppedNotes=0;this.pendingSeed=null;this.seedGain=1;this.seedFading=false;
  }
  /** Queue a click-free 80ms down/up seed switch; transport and controls survive. */
  reseed(seed){if(!Number.isFinite(seed))return;this.pendingSeed=seed>>>0;this.seedFading=true;}
  applySeed(){this.seed=this.pendingSeed;this.pendingSeed=null;for(const v of this.voices){if(v.active&&!v.off)this.noteOff(this.frame,v);v.active=false;}this.score=new EventScore(this.sampleRate,this.seed);this.frame=0;this.seedFading=false;}
  start(){this.playing=true;this.environment.start();}
  stop(){this.playing=false;this.environment.stop();}
  isSilent(){return this.fade===0&&!this.playing;}
  /** Rendering-thread transport reset; clears voices/tails, preserves targets. */
  reset(){this.playing=false;this.fade=0;this.frame=0;this.pendingSeed=null;this.seedGain=1;this.seedFading=false;this.score.reset();for(const v of this.voices)v.active=false;this.environment.reset();this.macros=new MacroBus(this.sampleRate);this.outputL=this.outputR=this.previousL=this.previousR=this.dcL=this.dcR=0;this.noteOnCount=this.noteOffCount=this.droppedNotes=0;}
  setParameters(update) {
    if(!update||typeof update!=='object')throw new TypeError('parameters must be an object');
    const p={...this.parameters};for(const key of Object.keys(DEFAULTS)){
      const value=update[key];if(value===undefined)continue;
      if(key==='melodyEnabled'||key==='drumsEnabled'){if(typeof value==='boolean')p[key]=value;}
      else if(key==='polyphony'){if([8,16,24,32].includes(value))p[key]=value;}
      else if(key==='composition'||key==='rainType')p[key]=Number.isFinite(value)?Math.max(0,Math.min(3,Math.round(value))):p[key];
      else if(key==='bpm')p[key]=Number.isFinite(value)?Math.max(30,Math.min(180,Math.round(value))):p[key];
      else p[key]=clamp(value,p[key]);
    }
    const styleKeys=['ambient','counterpoint','rhythmic','arpeggio'];
    if(update.composition!==undefined&&!styleKeys.some(key=>update[key]!==undefined))styleKeys.forEach((key,i)=>{p[key]=p.composition===i?1:0;});
    this.parameters=Object.freeze(p);this.environment.setParameters(p);
  }
  noteOn(frame,instrument,pitch,duration,velocity,pan) {
    let v=null;const first=instrument<5?0:32,last=instrument<5?this.parameters.polyphony:44;for(let i=first;i<last;i++)if(!this.voices[i].active){v=this.voices[i];break;}
    if(!v){this.droppedNotes++;return;}
    v.active=true;v.off=false;v.filtered=0;v.noiseState=(this.seed+this.noteOnCount*1664525)>>>0;v.phase=0;v.phaseB=0;v.age=0;v.duration=duration;v.release=Math.round(this.sampleRate*(instrument===0?4:instrument===3?2:instrument>=5?.08:.3));
    v.id=this.noteOnCount+1;v.instrument=instrument;v.frequency=440*Math.pow(2,(pitch-69)/12);v.midi=pitch;v.velocity=velocity;v.panL=Math.sqrt(1-pan);v.panR=Math.sqrt(pan);this.noteOnCount++;if(this.onNoteOn)this.onNoteOn(frame,instrument,pitch,duration,velocity,pan,v.id);
  }
  noteOff(frame,v){v.off=true;this.noteOffCount++;if(this.onNoteOff)this.onNoteOff(frame,v.instrument,v.midi,v.id);}
  render(left,right) {
    if(!(left instanceof Float32Array)||!(right instanceof Float32Array)||left.length!==right.length)throw new TypeError('equal-length Float32Array stereo channels required');
    const target=this.parameters,playing=this.playing;
    for(let i=0;i<left.length;i++){this.next(target,playing);left[i]=this.outputL;right[i]=this.outputR;}
  }
  next(target,playing) {
    this.intensity+=this.smoothing*(target.intensity-this.intensity);this.brightness+=this.smoothing*(target.brightness-this.brightness);this.motion+=this.smoothing*(target.motion-this.motion);this.timbre+=this.smoothing*(target.timbre-this.timbre);
    for(let i=0;i<5;i++){this.layerGains[i]+=this.smoothing*(target[LAYERS[i]]-this.layerGains[i]);this.drumGains[i]+=this.drumSmoothing*(target[DRUMS[i]]-this.drumGains[i]);}
    if(this.pendingSeed!==null){this.seedGain=Math.max(0,this.seedGain-1/(this.sampleRate*.08));if(this.seedGain===0||(!playing&&this.fade===0))this.applySeed();}
    else this.seedGain=Math.min(1,this.seedGain+1/(this.sampleRate*.08));
    if(!playing&&this.fade===0){this.outputL=this.outputR=0;return;}
    if(playing)this.score.advanceTo(this.frame,target,this);else this.score.beatNext++;
    const melodicTone=1-Math.exp(-2*Math.PI*(900+this.brightness*4200)/this.sampleRate),drumTone=1-Math.exp(-2*Math.PI*6500/this.sampleRate);
    let left=0,right=0;
    for(let i=0;i<this.voices.length;i++) {
      const v=this.voices[i];if(!v.active)continue;
      if((v.age>=v.duration||(i<32&&i>=target.polyphony)||(kIsMelody(v.instrument)&&!target.melodyEnabled)||(v.instrument>=5&&!target.drumsEnabled))&&!v.off){if(v.age<v.duration){v.duration=v.age;v.release=Math.min(v.release,Math.round(this.sampleRate*.08));}this.noteOff(this.frame,v);}
      if(v.age>=v.duration+v.release){v.active=false;continue;}
      const t=v.age/this.sampleRate,p=v.phase,k=v.instrument;
      const attack=k===0?3:k===3?5:k===2?.04:k===1?.025:k>=5?.003:.05;
      let env=Math.min(1,t/attack);env=env*env*(3-2*env);
      if(v.off){const r=Math.max(0,1-(v.age-v.duration)/v.release);env*=r*r*(3-2*r);}
      let value=0;
      // Band-limited additive spectra (each partial below 45% of sample rate).
      const h2=v.frequency*2<this.sampleRate*.45?sine(p*2):0;
      const h3=v.frequency*3<this.sampleRate*.45?sine(p*3):0;
      if(k===0)value=(sine(p)*.76+sine(v.phaseB)*.24+h2*(.10+.11*this.brightness)+h3*.035)*(.86+.14*sine(t*.055))* .075;
      else if(k===1)value=(sine(p)+h2*.24+h3*.08+sine(v.phaseB)*.16)*Math.exp(-t/(.65+.7*this.timbre))*.19;
      else if(k===2){const metallic=v.frequency*2.71<this.sampleRate*.45?sine(v.phaseB):0;value=(sine(p)*Math.exp(-t/2.8)+metallic*.18*Math.exp(-t/.8))*.15;}
      else if(k===3)value=(sine(p)+sine(v.phaseB)*.5)*(.6+.4*sine(t*.11))* .04;
      else if(k===4)value=(sine(p)+h2*.15)*Math.exp(-t/.65)*.17;
      else {
        v.noiseState=(Math.imul(v.noiseState,1664525)+1013904223)>>>0;
        const noise=v.noiseState/2147483648-1;
        if(k===5)value=sine(p)*Math.exp(-t*15)*.36;
        else if(k===6)value=(noise*.7+sine(p)*.3)*Math.exp(-t*22)*.22;
        else if(k===7)value=(noise-v.filtered)*Math.exp(-t*65)*.11;
        else if(k===8)value=(sine(p)+h2*.2)*Math.exp(-t*12)*.24;
        else value=(noise*.65+sine(p*3)*.1)*Math.exp(-t*3)*.10;
      }
      // Gentle per-voice lowpass tames attack spectra, especially metallic layers.
      const tone=k>=5?drumTone:melodicTone;
      v.filtered+=tone*(value-v.filtered);value=v.filtered;
      value*=env*v.velocity*(k<5?this.layerGains[k]:this.drumGains[k-5]);left+=value*v.panL;right+=value*v.panR;
      const inc=(k===5?45+90*Math.exp(-t*38):k===8?110+45*Math.exp(-t*20):v.frequency)*(1+.0015*this.motion*sine(t*.23))/this.sampleRate;v.phase=wrap(v.phase+inc);v.phaseB=wrap(v.phaseB+inc*(k===2?2.71:1.003));v.age++;
    }
    left*=1+this.intensity*1.4;right*=1+this.intensity*1.4;
    this.environment.next();this.macros.process(left+this.environment.outputL,right+this.environment.outputR,target);
    left=this.macros.left;right=this.macros.right;
    this.dcL=left-this.previousL+this.dcPole*this.dcL;this.dcR=right-this.previousR+this.dcPole*this.dcR;this.previousL=left;this.previousR=right;
    this.outputL=.85*this.dcL/(1+Math.abs(this.dcL))*this.fade*this.seedGain;this.outputR=.85*this.dcR/(1+Math.abs(this.dcR))*this.fade*this.seedGain;
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
