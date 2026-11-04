// SPDX-License-Identifier: AGPL-3.0-only
import {DEVELOPMENT_CONFIG_DEFAULTS,normalizeDevelopmentConfig} from './development-config.js';
// Original, continuously developing score. No recordings, MIDI files or finite clips.
const SCALE = [
  0,2,4,5,7,9,11,  // Ionian
  0,2,3,5,7,9,10,  // Dorian
  0,2,3,5,7,8,10,  // Aeolian
  0,2,4,5,7,9,10,  // Mixolydian
  0,2,4,6,7,9,11,  // Lydian
  0,1,3,5,7,8,10,  // Phrygian
  0,2,3,5,7,8,11   // Harmonic minor
];
const METERS = [48,36,60,42,54,72]; // 4/4, 3/4, 5/4, 7/8, 9/8, 6/4
const PHRASES = [4,6,8,10,12];
const LENGTHS = [6,7,8,9,10,12];
const MOVES = [3,4,2,5,1,3,4,6, 4,1,3,2,5,4,6,2, 2,3,5,1,4,2,6,3, 5,2,4,3,1,6,2,4];
// Two-quarter cells: straight, ternary, displaced, spacious, triplet, broken,
// offbeat and tresillo. Phrase rotation and different meters avoid eight-bar loops.
const MASKS = [
  (1<<0)|(1<<6)|(1<<12)|(1<<18),
  (1<<0)|(1<<8)|(1<<12)|(1<<20),
  (1<<0)|(1<<9)|(1<<15)|(1<<18),
  (1<<0)|(1<<6)|(1<<15),
  (1<<0)|(1<<4)|(1<<12)|(1<<16)|(1<<20),
  (1<<0)|(1<<3)|(1<<12)|(1<<18)|(1<<21),
  (1<<3)|(1<<6)|(1<<12)|(1<<21),
  (1<<0)|(1<<9)|(1<<18)
];
const finite01 = (v,f) => Number.isFinite(v) ? Math.max(0,Math.min(1,v)) : f;
const mod = (n,d) => ((n%d)+d)%d;
function hash(n) { n=Math.imul(n^(n>>>16),0x7feb352d);n=Math.imul(n^(n>>>15),0x846ca68b);return (n^(n>>>16))>>>0; }

/** Allocation-free, sample-clock composition. Call advanceTo before rendering its
 * frame. Each event is sink.noteOn(frame, layer, MIDI, gateFrames, velocity, pan).
 * Layers 0..4: pad/pluck/bell/texture/pulse; 5..9: kick/snare/hat/tom/cymbal.
 * beatNext is the next tick's absolute frame, and may be shifted during stop fades.
 * No score time elapses when only beatNext is shifted. next is its rounded view.
 */
export class DevelopmentScore {
  constructor(sampleRate,seed=1,config=DEVELOPMENT_CONFIG_DEFAULTS) {
    if(!Number.isInteger(sampleRate)||sampleRate<8000||sampleRate>192000)throw new RangeError('sampleRate must be an integer in 8000..192000');
    this.rate=sampleRate;this.seed=Number.isFinite(seed)?seed>>>0:1;
    Object.defineProperty(this,'config',{value:normalizeDevelopmentConfig(config),enumerable:true});
    this.motif=new Int8Array(12);this.leadGrid=new Uint8Array(72);this.replyGrid=new Uint8Array(72);
    this.grooveGrid=new Uint8Array(72);this.arpGrid=new Uint8Array(72);
    this.voicing=new Int16Array(4);this.busyUntil=new Float64Array(44);
    this.reset();
  }
  get next() { return Math.round(this.beatNext); }
  reseed(seed) { if(Number.isFinite(seed)){this.seed=seed>>>0;this.reset();} }
  reset() {
    this.variant=hash(this.seed^0x9e3779b9);this.state=hash(this.seed^0x243f6a88);
    this.root=48+(this.config.tonic==='seed'?this.variant%12:this.config.tonic);
    this.anchorRoot=this.root;this.mode=this.config.mode==='seed'?Math.floor(this.variant/16)%7:this.config.mode;
    this.meterTicks=METERS[this.config.meter==='seed'?Math.floor(this.variant/128)%6:this.config.meter];this.phraseBars=PHRASES[Math.floor(this.variant/1024)%5];
    this.motifLength=LENGTHS[Math.floor(this.variant/8192)%6];this.seedFamily=Math.floor(this.variant/65536)%8;
    this.family=this.config.rhythmFamily==='seed'?this.seedFamily:this.config.rhythmFamily;
    this.harmonicFamily=Math.floor(this.variant/524288)%4;
    this.arpStrategy=this.config.arpStrategy==='seed'?Math.floor(this.variant/2097152)%8:this.config.arpStrategy;
    this.drumFamily=this.config.drumPattern==='seed'?this.seedFamily:this.config.drumPattern;
    this.modulationPhrase=0;this.modulationChanges=0;
    this.beatNext=0;this.elapsedFrames=0;this.tick=0;this.step=0;this.bar=0;this.barTick=0;this.phrase=0;this.phraseBar=0;
    this.chord=0;this.ambientChord=0;this.chordChanges=0;this.harmonyAt=0;this.harmonyTick=0;this.harmonicStep=0;
    this.eventCount=0;this.suppressedEvents=0;this.eventsThisTick=0;this.melodicLimit=16;
    this.padAt=0;this.textureAt=0;this.ambientAt=this.rate*(3+this.variant%6);
    this.ambientCursor=0;this.counterCursor=0;this.replyCursor=0;this.grooveCursor=0;this.arpCursor=0;
    this.rotation=0;this.inversion=1;this.retrograde=0;this.transpose=0;this.plan=0;
    this.phraseEnergy=1;this.restBar=-1;this.rhythmFamily=this.family;this.arpKind=this.arpStrategy;
    this.norm=1;this.lastTop=72;this.lastLower=60;this.lastBass=40;
    this.voicing[0]=48;this.voicing[1]=55;this.voicing[2]=60;this.voicing[3]=64;
    this.busyUntil.fill(0);this.leadGrid.fill(0);this.replyGrid.fill(0);this.grooveGrid.fill(0);this.arpGrid.fill(0);
    let d=0;
    for(let i=0;i<this.motifLength;i++) {
      const h=this.randomInt();
      if(i===0)d=(h%3)*2;
      else {d+=(h%7)-3;if(d>7)d=7-(d-7);if(d< -3)d=-3+(-3-d);}
      this.motif[i]=d;
    }
    for(let i=this.motifLength;i<12;i++)this.motif[i]=0;
  }
  randomInt() { this.state=(Math.imul(this.state,1664525)+1013904223)>>>0;return this.state; }
  degree(d) { return SCALE[this.mode*7+mod(d,7)]+12*Math.floor(d/7); }
  pitch(d,octave,low,high,previous) {
    let p=this.root+this.degree(d)+12*octave;
    while(p<low)p+=12;while(p>high)p-=12;
    if(previous>=low&&previous<=high){if(p-previous>7&&p-12>=low)p-=12;else if(previous-p>7&&p+12<=high)p+=12;}
    return p;
  }
  motifDegree(cursor,complexity,reply) {
    let i=mod(cursor+this.rotation,this.motifLength);
    if(this.retrograde!==0)i=this.motifLength-1-i;
    let d=this.motif[i];
    if(complexity<.25)d=2*Math.round(d/2);
    d=d*(reply?-this.inversion:this.inversion);
    return d+(complexity>.35?this.transpose:0);
  }
  planPhrase(complexity,evolution) {
    const epoch=Math.floor(this.phrase/(1+Math.floor((1-evolution)*3)));
    this.plan=hash(this.variant^Math.imul(epoch+1,0x45d9f3b));
    this.rotation=complexity>.25?this.plan%this.motifLength:0;
    this.inversion=complexity>.5&&((this.plan>>>4)&1)!==0?-1:1;
    this.retrograde=complexity>.65?((this.plan>>>5)&1):0;
    this.transpose=complexity>.35?((this.plan>>>6)%5)-2:0;
    this.rhythmFamily=this.config.rhythmFamily==='seed'&&complexity>.35?(this.family+((this.plan>>>9)%3))%8:this.family;
    const variation=this.config.drumVariation==='auto'?(this.config.drumPattern==='seed'?1:0):this.config.drumVariation;
    this.drumFamily=this.config.drumPattern==='seed'?(complexity*variation>.35?(this.seedFamily+((this.plan>>>9)%3))%8:this.seedFamily):this.config.drumPattern;
    this.arpKind=this.config.arpStrategy==='seed'&&complexity>.4?(this.arpStrategy+((this.plan>>>12)%4))%8:this.arpStrategy;
    const modulationSpan=4+Math.floor((1-evolution)*12);
    if(this.config.harmony==='modulating'&&this.phrase-this.modulationPhrase>=modulationSpan){
      this.root=this.root===this.anchorRoot?48+mod(this.anchorRoot-48+(((this.plan>>>3)&1)!==0?5:7),12):this.anchorRoot;
      this.modulationPhrase=this.phrase;this.modulationChanges++;this.chordChanges++;
      this.padAt=this.elapsedFrames;this.textureAt=this.elapsedFrames;
    }
    this.phraseEnergy=.72+((this.plan>>>16)%25)/100;
    this.restBar=this.phrase>0&&(this.plan>>>21)%3===0?this.phraseBars-1:-1;
    // Develop one cell only at a long-form boundary. The motif retains its identity.
    const mutationSpan=4+Math.floor((1-evolution)*8);
    if(this.phrase>0&&this.phrase%mutationSpan===0&&complexity>.2){
      const i=(this.plan>>>23)%this.motifLength;
      this.motif[i]=Math.max(-4,Math.min(8,this.motif[i]+(((this.plan>>>28)&1)!==0?1:-1)));
    }
  }
  planBar(complexity) {
    const n=this.meterTicks,call=(this.phraseBar%4)<2;
    const held=this.config.rhythmFamily!=='seed',heldArp=this.config.arpStrategy!=='seed';
    const mask=MASKS[this.rhythmFamily],groove=MASKS[held?this.rhythmFamily:(this.rhythmFamily+2)%8];
    const shift=!held&&complexity>.55?3*((this.plan>>>14)%3):0;
    const rest=!held&&this.phraseBar===this.restBar,arpRest=!heldArp&&this.phraseBar===this.restBar;
    const arpStep=this.arpKind===6?4:(complexity>.75&&this.arpKind===7?3:6);
    for(let t=0;t<n;t++){
      const x=mod(t-shift,24),y=mod(n-1-t+6,24);
      const rank=t===0?100:(t%12===0?88:(t%6===0?72:58));
      this.leadGrid[t]=!rest&&((mask>>>x)&1)!==0?(held||call?rank:Math.max(30,rank-26)):0;
      this.replyGrid[t]=!rest&&t%3===0&&((mask>>>mod(y+1,24))&1)!==0?(held||!call?rank:Math.max(25,rank-35)):0;
      this.grooveGrid[t]=!rest&&((groove>>>x)&1)!==0?rank:0;
      this.arpGrid[t]=!arpRest&&t%arpStep===0?(t===0?100:(t%(arpStep*2)===0?86:64)):0;
      // A reply pickup and a short articulated fill, never a compulsory cadence.
      if(!held&&!rest&&complexity>.65&&this.phraseBar%3===2&&t===n-3)this.replyGrid[t]=68;
      if(!held&&!rest&&complexity>.8&&this.phraseBar%4===3&&t===n-3)this.grooveGrid[t]=62;
    }
  }
  changeHarmony(stableAmbient) {
    const h=hash(this.variant^Math.imul(++this.harmonicStep,0x27d4eb2d));
    if(stableAmbient){
      // The original zero-evolution endpoint keeps three distinct related fields.
      this.ambientChord=(this.ambientChord+1)%3;
      let next=this.ambientChord===0?0:(this.ambientChord===1?2:3);
      if(next===this.chord){this.ambientChord=(this.ambientChord+1)%3;next=this.ambientChord===0?0:(this.ambientChord===1?2:3);}
      this.chord=next;
    }else{
      const move=MOVES[this.harmonicFamily*8+((h>>>8)%8)];
      this.chord=(this.chord+move)%7;
    }
    this.chordChanges++;
    this.harmonyAt=this.elapsedFrames;this.harmonyTick=this.tick;this.padAt=this.elapsedFrames;
  }
  emit(sink,at,layer,pitch,seconds,velocity,pan) {
    if(!(velocity>0)||this.eventsThisTick>=12)return false;
    let slot=-1;const begin=layer<5?0:32,end=layer<5?this.melodicLimit:44;
    for(let i=begin;i<end;i++)if(this.busyUntil[i]<=at){slot=i;break;}
    if(slot<0){this.suppressedEvents++;return false;}
    const duration=Math.max(1,Math.round(this.rate*Math.max(.04,Math.min(32,seconds))));
    const tail=this.rate*(layer===0?4:(layer===3?2:(layer>=5?.08:.3)));
    this.busyUntil[slot]=at+duration+Math.round(tail);
    this.eventCount++;this.eventsThisTick++;
    sink.noteOn(at,layer,Math.max(24,Math.min(96,Math.round(pitch))),duration,Math.max(.005,Math.min(1,velocity/this.norm)),Math.max(.15,Math.min(.85,pan)));
    return true;
  }
  allowed(rank,density) { return rank>0&&density>=(100-rank)/100; }
  emitDrums(sink,at,t,density,complexity,energy) {
    const variation=this.config.drumVariation==='auto'?(this.config.drumPattern==='seed'?1:0):this.config.drumVariation;
    const drumEnergy=variation===1?energy:(variation===0?1:1+variation*(energy-1));
    const family=this.drumFamily,half=Math.floor(this.meterTicks/2/3)*3;
    if(this.config.drumPattern==='seed'){
      // Exact legacy percussion by default, independently of manual melodic rhythm.
      if(t===0||(t===half&&(family%3!==1||density>.6))||(complexity*variation>.6&&density>.6&&t===this.meterTicks-9))
        this.emit(sink,at,5,36,.22,(t===0?.79:.57)*drumEnergy,.48);
      if(t===(this.meterTicks>=48?12:half)||(this.meterTicks>=48&&t===this.meterTicks-12))
        this.emit(sink,at,6,38,.19,.61*drumEnergy,.53);
      const hatStep=family===1||family===4?4:(density>.8&&complexity>.7?3:6);
      if(t%hatStep===0&&(t%12===0||density>.3)&&!(variation>0&&this.phraseBar===this.restBar&&t%12!==0))
        this.emit(sink,at,7,42,.075,(t%12===0?.36:.2)*drumEnergy,.64);
    }else{
      // Concrete patterns do not read the melodic rhythm grid or its family.
      const x=t%48;let kick=false,snare=false;
      if(family===0){kick=t%12===0;snare=t%24===12;}
      else if(family===1){kick=t===0||(density>.55&&t===half-6);snare=t===half;}
      else if(family===2){kick=t%24===0||t%24===9||t%24===18;snare=t===12||t===this.meterTicks-6;}
      else if(family===3){kick=x===0||x===18||x===36;snare=x===9||x===30||x===42;}
      else if(family===4){kick=t%24===0||t%24===16;snare=t%24===12;}
      else if(family===5){kick=t===0;snare=t===half;}
      else if(family===6){kick=t%24===6||t%24===18;snare=t%24===12;}
      else{kick=t===0;snare=t===half;}
      if(variation>0&&complexity*variation>.6&&density>.6&&t===this.meterTicks-9)kick=true;
      if(kick)this.emit(sink,at,5,36,.22,(t===0?.79:.57)*drumEnergy,.48);
      if(snare)this.emit(sink,at,6,38,.19,.61*drumEnergy,.53);
      const hatStep=family===4?4:(family===5||family===7?12:(density>.8&&complexity>.7?3:6));
      const hatOffset=family===6?3:0;
      if(mod(t-hatOffset,hatStep)===0&&(t%12===0||density>.3)&&!(variation>0&&this.phraseBar===this.restBar&&t%12!==0))
        this.emit(sink,at,7,42,.075,(t%12===0?.36:.2)*drumEnergy,.64);
      if(family===7&&t%12===6)this.emit(sink,at,8,45+2*(Math.floor(t/12)%3),.25,.4*drumEnergy,.35);
    }
    if(variation>0&&complexity*variation>.55&&density>.45&&this.phraseBar===this.phraseBars-1&&t>=this.meterTicks-9&&t%3===0)
      this.emit(sink,at,8,45+2*((this.meterTicks-t)/3%3),.25,.4*drumEnergy,.35+(t%3)*.1);
    if(variation>.25&&this.phraseBar===0&&t===0&&this.phrase%2===0)this.emit(sink,at,9,49,1.4,.32*drumEnergy,.66);
  }
  advanceTo(frame,p,sink) {
    if(!Number.isSafeInteger(frame)||frame< -1)throw new RangeError('finite nonnegative integer sample frame required');
    if(!Number.isFinite(this.beatNext)||this.beatNext<0)throw new RangeError('invalid score clock');
    if(Math.round(this.beatNext)>frame)return;
    if(!p||typeof p!=='object')throw new TypeError('parameters must be an object');
    const explicit=Number.isFinite(p.ambient)||Number.isFinite(p.counterpoint)||Number.isFinite(p.rhythmic)||Number.isFinite(p.arpeggio);
    const selected=Number.isFinite(p.composition)?Math.max(0,Math.min(3,Math.round(p.composition))):0;
    const ambient=finite01(p.ambient,!explicit&&selected===0?1:0),counter=finite01(p.counterpoint,!explicit&&selected===1?1:0);
    const rhythmic=finite01(p.rhythmic,!explicit&&selected===2?1:0),arp=finite01(p.arpeggio,!explicit&&selected===3?1:0);
    const density=finite01(p.density,.5),complexity=finite01(p.complexity,.5),swing=finite01(p.swing,0),evolution=finite01(p.evolution,0);
    const bpm=Number.isFinite(p.bpm)?Math.max(30,Math.min(180,p.bpm)):72,seconds=60/bpm;
    const drive=Math.max(counter,rhythmic,arp),ratio=ambient/Math.max(.001,ambient+drive);
    const harmonicSpan=1+Math.floor(3*ratio),ambientSpan=this.rate*3600*Math.exp(-5.41610040220442*evolution);
    const melody=p.melodyEnabled!==false,drums=p.drumsEnabled===true;
    this.norm=Math.sqrt(Math.max(1,ambient+counter+rhythmic+arp));
    this.melodicLimit=p.polyphony===8||p.polyphony===24||p.polyphony===32?p.polyphony:16;
    while(Math.round(this.beatNext)<=frame){
      const at=Math.round(this.beatNext),t=this.barTick;
      this.eventsThisTick=0;
      if(t===0){if(this.phraseBar===0)this.planPhrase(complexity,evolution);this.planBar(complexity);}
      if(this.config.harmony!=='fixed'&&((drive===0&&this.elapsedFrames-this.harmonyAt>=ambientSpan)||
         (drive>0&&t===0&&this.tick-this.harmonyTick>=this.meterTicks*harmonicSpan)))this.changeHarmony(drive===0&&evolution===0);
      const strength=Math.max(ambient,drive*.55),energy=this.phraseEnergy*(this.phraseBar===this.restBar?.72:1);
      if(this.elapsedFrames>=this.padAt){
        const gate=drive===0?22-6*evolution:(this.meterTicks/12)*seconds*(.82+ratio*1.5);
        const voices=complexity>.72?4:3;
        for(let j=0;j<voices;j++){
          const d=this.chord+(j===3?(this.plan%2===0?6:1):j*2);
          const n=this.pitch(d,0,45,74,this.voicing[j]);this.voicing[j]=n;
          this.emit(sink,at,0,n,gate,(.49-j*.035)*strength*energy,.22+j*.18);
        }
        this.padAt=this.elapsedFrames+this.rate*(drive===0?20+4*(1-density):Math.max(2,(this.meterTicks/12)*seconds*harmonicSpan));
      }
      if(this.elapsedFrames>=this.textureAt){
        this.emit(sink,at,3,this.pitch(this.chord+4,1,62,86,0),drive===0?28:Math.min(14,seconds*10),.25*Math.max(ambient,drive*.25)*energy,.64);
        this.textureAt=this.elapsedFrames+this.rate*(drive===0?29+this.variant%9:Math.max(12,seconds*16));
      }
      // Sparse ambient phrases have a seconds-based breathing space, not a busy beat grid.
      if(this.elapsedFrames>=this.ambientAt){
        const cursor=this.ambientCursor++,rest=(cursor+((this.plan>>>10)%5))%7===6;
        if(melody&&ambient>0&&!rest&&this.phraseBar!==this.restBar){
          const d=this.chord+this.motifDegree(cursor,complexity,false);
          const n=this.pitch(d,1,60,86,this.lastTop),bell=cursor%5===3;
          if(this.emit(sink,at,bell?2:1,n,bell?5.5:2.4,(bell?.38:.57)*ambient*energy,bell?.72:.35))this.lastTop=n;
        }
        if(ambient>0&&!rest&&this.phraseBar!==this.restBar&&cursor%5===1&&density>.6)
          this.emit(sink,at,4,this.pitch(this.chord,-1,33,52,this.lastBass),1.3,.37*ambient*energy,.47);
        this.ambientAt=this.elapsedFrames+this.rate*(6+(1-density)*19)*(1-.4*evolution)*(this.ambientCursor%this.motifLength===0?1.6:1);
      }
      if(melody){
        if(counter>0&&this.allowed(this.leadGrid[t],density)){
          const c=this.counterCursor++,d=this.chord+this.motifDegree(c,complexity,false);
          const n=this.pitch(d,1,60,86,this.lastTop),gate=(t%12===0?.78:.42)*seconds;
          if(this.emit(sink,at,1,n,gate,(t%12===0?.66:.51)*counter*energy,.29))this.lastTop=n;
        }
        if(counter>0&&this.allowed(this.replyGrid[t],density)){
          const c=this.replyCursor++,d=this.chord+4+this.motifDegree(c,complexity,true);
          const n=this.pitch(d,0,48,74,this.lastLower);
          if(this.emit(sink,at,2,n,seconds*(t%12===0?1.35:.7),.42*counter*energy,.73))this.lastLower=n;
        }
        if(rhythmic>0&&this.allowed(this.grooveGrid[t],density)){
          const c=this.grooveCursor++,d=this.chord+this.motifDegree(Math.floor(c/2)+(c%2===0?0:2),complexity,false);
          const n=this.pitch(d,1,57,83,this.lastTop);
          if(this.emit(sink,at,1,n,seconds*(t%12===0?.36:.19),.68*rhythmic*energy,.4))this.lastTop=n;
          if(this.config.rhythmFamily==='seed'&&complexity>.55&&t%12!==0&&c%4===3)this.emit(sink,at,2,this.pitch(this.chord+4,1,64,88,0),seconds*.48,.3*rhythmic*energy,.74);
        }
        if(arp>0&&this.allowed(this.arpGrid[t],density)){
          const c=this.arpCursor++,kind=this.arpKind,span=complexity>.5?4:3;
          let index;
          if(kind===0)index=c%span;
          else if(kind===1)index=span-1-c%span;
          else if(kind===2){const x=c%(2*span-2);index=x<span?x:2*span-2-x;}
          else if(kind===3)index=(c%2===0?Math.floor(c/2)%span:span-1-Math.floor(c/2)%span);
          else if(kind===4)index=(c*2+Math.floor(c/span))%span;
          else if(kind===5)index=mod(this.motifDegree(c,complexity,false),span);
          else if(kind===6)index=(c+Math.floor(c/3))%span;
          else index=(c+Math.floor(c/4)*2)%span;
          const d=this.chord+index*2,octave=complexity>.55&&(c+this.plan)%5===4?2:1;
          const n=this.pitch(d,octave,57,88,0);
          this.emit(sink,at,1,n,seconds*(kind===6?.42:.57),(.48+(c%span===0?.16:0))*arp*energy,.3+(c%3)*.17);
          if(complexity>.5&&t===Math.floor(this.meterTicks/2/3)*3)this.emit(sink,at,2,this.pitch(this.chord+this.motifDegree(c,complexity,false),1,62,86,this.lastTop),seconds*1.5,.32*arp*energy,.7);
        }
      }
      // Pulse is harmonic support, not a melody toggle; weights still silence it.
      if(drive>0&&(t===0||(rhythmic>0&&t===Math.floor(this.meterTicks*.5/3)*3)||
          (rhythmic>.5&&complexity>.6&&t===this.meterTicks-9&&density>.55))){
        const d=this.chord+(t===0?0:(this.plan%3===0?4:0));
        const n=this.pitch(d,-1,33,52,this.lastBass);this.lastBass=n;
        this.emit(sink,at,4,n,seconds*(rhythmic>counter?.45:1.25),.65*drive*energy,.48);
      }
      if(drums)this.emitDrums(sink,at,t,density,complexity,energy);
      // Swing stretches the first six sub-ticks and shortens the next six equally.
      // BPM changes affect only the next interval: no rewinding or catch-up burst.
      const delta=this.rate*seconds/12*(1+(this.tick%12<6?1:-1)*.44*swing);
      this.beatNext+=delta;this.elapsedFrames+=delta;this.tick++;this.step=this.tick;
      if(++this.barTick===this.meterTicks){
        this.barTick=0;this.bar++;
        if(++this.phraseBar===this.phraseBars){this.phraseBar=0;this.phrase++;}
      }
    }
  }
}
