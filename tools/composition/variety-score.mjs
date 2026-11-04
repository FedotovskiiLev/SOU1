// SPDX-License-Identifier: AGPL-3.0-only
// Pure composition layer. Deliberately separate from the pinned legacy EventScore.
export const COMPOSER_VERSION = 'sou1.variety-score.v1';
const freeze = x => { if (x && typeof x === 'object') { for (const v of Object.values(x)) freeze(v); Object.freeze(x); } return x; };
export const MODES = freeze({major:[0,2,4,5,7,9,11], aeolian:[0,2,3,5,7,8,10], dorian:[0,2,3,5,7,9,10], lydian:[0,2,4,6,7,9,11], phrygian:[0,1,3,5,7,8,10], 'harmonic-minor':[0,2,3,5,7,8,11]});
// Times are quarter-note beats. In 6/8 and 7/8 one eighth is .5 beat.
export const VARIETY_STYLES = freeze({
  drift: {meter:[4,4], bpm:66, mode:'lydian', phraseBars:4, form:['A','C','A','B'], harmonySpan:2, progressions:[[0,3,1,4],[0,5,3,0],[0,1,3,4]], rhythms:[[0,1.5,3.25],[.5,2.75],[0,2.5],[1,3]], contour:[0,2,5,4,1,-1,3,0], gate:1.45, drums:false, leadGain:.43, description:'Sparse floating phrases, two-bar extended harmony, long rests and displaced entrances.'},
  waltz: {meter:[3,4], bpm:108, mode:'major', phraseBars:4, form:['A','A','B','A'], harmonySpan:1, progressions:[[0,3,4,0],[0,5,1,4],[0,1,4,0]], rhythms:[[0,1,1.5,2],[0,.5,1.5,2.5],[0,1.5,2],[.5,1,2]], contour:[0,1,2,4,3,2,1,0], gate:.82, drums:true, leadGain:.51, description:'Lyrical three-beat arch, bass on one, chord responses on two and three.'},
  broken: {meter:[4,4], bpm:104, mode:'dorian', phraseBars:4, form:['A','B','A','C'], harmonySpan:1, progressions:[[0,3,0,6],[0,5,3,4],[0,1,5,3]], rhythms:[[0,.75,1.5,2.75,3.5],[.25,1,1.75,3],[0,1.25,2.5,3.25],[.5,1.5,2.25,3.75]], contour:[0,0,4,2,-1,3,1,0], gate:.43, drums:true, leadGain:.58, description:'Sixteenth-note syncopation, alternating calls and replies, offbeat bass and broken backbeat.'},
  motor: {meter:[7,8], bpm:126, mode:'phrygian', phraseBars:4, form:['A','A','B','C'], harmonySpan:1, progressions:[[0,1,0,6],[0,0,3,1],[0,6,1,0]], rhythms:[[0,.5,1,1.5,2,2.5,3],[0,.5,1,2,2.5],[0,1,1.5,2,3],[0,.5,1,2,3]], contour:[0,4,1,4,2,5,3,1], gate:.36, drums:true, leadGain:.46, description:'Seven-eighth ostinato grouped 2+2+3, pedal tones, accents and changing note order.'},
  song: {meter:[4,4], bpm:84, mode:'aeolian', phraseBars:4, form:['A','B','C','B'], harmonySpan:1, progressions:[[0,5,2,6],[0,3,5,4],[0,2,3,4]], rhythms:[[0,.5,1.5,3],[0,1.5,2.5],[.5,1,2,3.5],[0,1,2.5,3]], contour:[0,2,4,4,3,1,2,0], gate:.95, drums:true, leadGain:.55, description:'Verse, lifted chorus and sparse bridge; long hook notes, pickups and resolved endings.'},
  canon: {meter:[6,8], bpm:92, mode:'major', phraseBars:4, form:['A','B','A','C'], harmonySpan:1, progressions:[[0,3,1,4],[0,5,1,4],[0,2,5,4]], rhythms:[[0,.5,1,1.5,2,2.5],[0,1,1.5,2.5],[0,.5,1.5,2],[.5,1,1.5,2.5]], contour:[0,1,2,1,3,2,4,0], gate:.48, drums:false, leadGain:.42, description:'Compound meter with delayed lower imitation and contrary-motion phrases.'}
});
const KEYS = ['style','seed','sampleRate','bars','bpm','root','mode','density','variation','drums','melody','outputGainDb'];
const plain = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const unit = x => Number.isFinite(x) && x >= 0 && x <= 1;
function hash(seed, salt) { let x = (seed ^ salt) >>> 0; x = Math.imul(x ^ (x >>> 16), 0x21f0aaad); x = Math.imul(x ^ (x >>> 15), 0x735a2d97); return (x ^ (x >>> 15)) >>> 0; }
function rng(seed) { let state = seed >>> 0; return () => { state = (state + 0x6d2b79f5) >>> 0; let x = Math.imul(state ^ (state >>> 15), state | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; }; }
const pick = (items, random) => items[Math.floor(random() * items.length)];
export function validateVarietyOptions(input = {}) {
  if (!plain(input) || Object.keys(input).some(k => !KEYS.includes(k))) throw new TypeError('Unknown variety option');
  const style = input.style ?? 'song';
  if (typeof style !== 'string' || !Object.hasOwn(VARIETY_STYLES, style)) throw new RangeError('Unknown variety style');
  const s = VARIETY_STYLES[style];
  const o = {seed:7311, sampleRate:48000, bars:16, bpm:s.bpm, root:60, mode:s.mode, density:.72, variation:.65, drums:s.drums, melody:true, outputGainDb:4, ...input, style};
  if (!Number.isInteger(o.seed) || o.seed < 0 || o.seed > 0xffffffff || ![44100,48000].includes(o.sampleRate) || !Number.isInteger(o.bars) || o.bars < 2 || o.bars > 32 || !Number.isFinite(o.bpm) || o.bpm < 40 || o.bpm > 180 || !Number.isInteger(o.root) || o.root < 48 || o.root > 71 || typeof o.mode !== 'string' || !Object.hasOwn(MODES,o.mode) || !unit(o.density) || !unit(o.variation) || typeof o.drums !== 'boolean' || typeof o.melody !== 'boolean' || !Number.isFinite(o.outputGainDb) || o.outputGainDb < -60 || o.outputGainDb > 24) throw new RangeError('Invalid variety options');
  const seconds = o.bars * s.meter[0] * 4 / s.meter[1] * 60 / o.bpm;
  if (seconds > 120) throw new RangeError('Composition exceeds 120 seconds before the 2-second transport tail');
  return Object.freeze(o);
}
function degree(scale, d) { return scale[((d % 7) + 7) % 7] + 12 * Math.floor(d / 7); }
function fitPitch(pitch, lo, hi) { while (pitch < lo) pitch += 12; while (pitch > hi) pitch -= 12; return pitch; }
function closestChord(root, scale, d, previous, extended) {
  const base = [0,2,4,...(extended ? [6] : [])].map(n => root + degree(scale,d+n));
  let best, cost = Infinity;
  for (let inversion=0; inversion<base.length; inversion++) for (let octave=-2; octave<=0; octave++) {
    const notes=base.map((n,i)=>n+12*octave+(i<inversion?12:0)).sort((a,b)=>a-b);
    if(notes[0]<45 || notes.at(-1)>76) continue;
    const c=notes.reduce((sum,n,i)=>sum+Math.abs(n-(previous?.[i]??(52+i*5))),0);
    if(c<cost){cost=c;best=notes;}
  }
  return best ?? base.map(n=>fitPitch(n,48,72)).sort((a,b)=>a-b);
}
function melodyPattern(o,s,random) {
  const contour=[...s.contour], offset=pick([-1,0,0,1,2],random), direction=random()<.25?-1:1;
  return contour.map((d,i)=>i===0?0:Math.round(d*direction+offset+(random()<o.variation*.35?pick([-1,1],random):0)));
}
function transformMotif(motif, section, variation) {
  if(section==='A') return [...motif];
  if(section==='B') return motif.map((d,i)=>d+(i%3===0 && variation>.3?2:0));
  if(section==='C') return [...motif].reverse().map(d=>variation>.4?-d:d);
  return [...motif];
}
// Source layer numbering is the existing EventScore contract: pad, pluck,
// bell, texture, pulse, kick, snare, hihat, toms, cymbal.
export function composeVarietyPlan(input = {}) {
  const o=validateVarietyOptions(input), s=VARIETY_STYLES[o.style], scale=MODES[o.mode];
  const beatsPerBar=s.meter[0]*4/s.meter[1], beatFrames=o.sampleRate*60/o.bpm;
  const activeFrames=Math.round(o.bars*beatsPerBar*beatFrames), frames=activeFrames+2*o.sampleRate;
  const styleSalt=Object.keys(VARIETY_STYLES).indexOf(o.style)+1;
  const random=rng(hash(o.seed,styleSalt*0x9e3779b9)), progression=[...pick(s.progressions,random)];
  const motif=melodyPattern(o,s,random), rhythmOffset=Math.floor(random()*s.rhythms.length);
  const sourceEvents=[], barPlan=[]; let previousChord;
  const sectionAt=bar=>s.form[Math.floor(bar/s.phraseBars)%s.form.length];
  const harmonyAt=bar=>{
    if(bar===o.bars-1)return 0;
    if(bar===o.bars-2)return 4;
    const shift=sectionAt(bar)==='C'&&o.variation>.35?2:0;
    return progression[(Math.floor(bar/s.harmonySpan)+shift)%progression.length];
  };
  function emit(bar, beat, layer, pitch, gate, velocity, pan, role, section) {
    const start=(bar*beatsPerBar+beat)*beatFrames, frame=Math.round(start);
    if (frame<0 || frame>=activeFrames) return;
    if(sourceEvents.length>=4096)throw new RangeError('Composition exceeds 4096-event budget');
    sourceEvents.push({frame,sourceInstrument:layer,pitch,duration:Math.max(1,Math.min(activeFrames-frame,Math.round(gate*beatFrames))),velocity:Math.max(0,Math.min(1,velocity)),pan,bar,beat,role,section});
  }
  for(let bar=0;bar<o.bars;bar++) {
    const phrase=Math.floor(bar/s.phraseBars), position=bar%s.phraseBars;
    const section=sectionAt(bar), last=bar===o.bars-1, penultimate=bar===o.bars-2;
    const chordDegree=harmonyAt(bar);
    const chord=closestChord(o.root,scale,chordDegree,previousChord,o.style==='drift'),bass=fitPitch(o.root+degree(scale,chordDegree)-24,33,52);
    const changes=!previousChord || chord.some((n,i)=>n!==previousChord[i]); previousChord=chord;
    const entry=o.style==='song' && section==='C'?.63:1;
    const local=rng(hash(o.seed,styleSalt*0x1234567+bar*0x9e37));
    const leadRandom=rng(hash(o.seed,styleSalt*0x3456789+bar*0x7f4a)),drumRandom=rng(hash(o.seed,styleSalt*0x56789ab+bar*0x6a09));
    const fifth=fitPitch(o.root+degree(scale,chordDegree+4)-24,33,52);
    barPlan.push({bar,section,phrase,position,chordDegree,chord,bass,meter:[...s.meter],cadence:last?'tonic':penultimate?'dominant':null});
    const out=(beat,layer,pitch,gate,v,pan,role)=>emit(bar,beat,layer,pitch,gate,v,pan,role,section);
    // Harmonic rhythms and accompanying voices are genuinely different strategies.
    if(o.style==='waltz') {
      out(0,4,bass,.85,.51,.5,'bass');
      if(!last) for(const b of [1,2]) for(const p of chord) out(b,0,p,.6,.19,.42,'chord-response');
      else for(const p of chord)out(0,0,p,beatsPerBar,.25,.45,'cadence');
    } else if(o.style==='motor') {
      for(const b of [0,1,2]) out(b,4,b===2?fifth:bass,.42,.48,.5,'grouped-bass');
      if(changes||position===0||last)for(const p of chord)out(0,0,p,last?beatsPerBar:2.8,.18,.43,'harmony');
    } else if(o.style==='broken') {
      for(const [i,b] of [0,.75,2.5,3.25].entries()) if(i===0||local()<.4+o.density*.6)out(b,4,i===2?fifth:bass,.4,.5*entry,.5,'syncopated-bass');
      for(const b of [0,2.75])for(const p of chord)out(b,0,p,.65,.17*entry,.42,'chord-stab');
    } else if(o.style==='canon') {
      for(const b of [0,1.5])out(b,4,b===0?bass:fifth,1.15,.37,.5,'compound-bass');
      if(changes||last)for(const p of chord)out(0,0,p,beatsPerBar*.8,.17,.45,'harmony');
    } else {
      let harmonyGate=last?beatsPerBar:beatsPerBar*s.harmonySpan*.93;
      for(let next=1;next<s.harmonySpan && bar+next<o.bars;next++)if(harmonyAt(bar+next)!==chordDegree){harmonyGate=Math.min(harmonyGate,next*beatsPerBar-.02);break;}
      if(changes||bar%s.harmonySpan===0||last)for(const p of chord)out(0,0,p,harmonyGate,o.style==='drift'?.28:.22*entry,.35+local()*.3,'harmony');
      out(0,4,bass,o.style==='drift'?beatsPerBar*.9:1.35,.42*entry,.5,'bass');
      if(o.style==='song' && !last && section!=='C')out(2.5,4,fifth,1.25,.34,.5,'bass-pickup');
    }
    if(o.melody) {
      const transformed=transformMotif(motif,section,o.variation);
      let rhythm=[...s.rhythms[(rhythmOffset+position)%s.rhythms.length]];
      if(o.style==='drift' && position===3)rhythm=rhythm.slice(0,1); // breathing space, not random deletion
      if(o.style==='song' && section==='C')rhythm=rhythm.filter((_,i)=>i%2===0);
      if(last)rhythm=[0,Math.min(beatsPerBar/2,1.5)];
      for(let i=0;i<rhythm.length;i++) {
        const beat=rhythm[i], anchor=i===0||last;
        if(!anchor && leadRandom()>.3+.7*o.density)continue;
        let d=transformed[(i+position*2)%transformed.length];
        // Reuse a phrase identity; develop its contour, register and response rather than rerolling every note.
        if(o.style==='motor')d=[0,4,1,4,2,5,3][(i+(section==='B'?2:0)+position%2)%7]+(leadRandom()<o.variation*.18?1:0);
        if(o.style==='canon' && position%2===1)d=-d+2;
        if(o.style==='broken' && position%2===1)d=-d+4;
        if(o.style==='song' && section==='B')d+=7;
        if(i===0)d=chordDegree+pick([0,2,4],leadRandom);
        else d+=chordDegree;
        if(position===s.phraseBars-1 && i===rhythm.length-1)d=chordDegree;
        if(last)d=i===0?2:0;
        const pitch=fitPitch(o.root+degree(scale,d)+12,60,88);
        let gate=Math.min(s.gate, (rhythm[i+1]??beatsPerBar)-beat);
        if(o.style==='song' && (i===rhythm.length-1||section==='B'))gate=Math.min(1.8,(rhythm[i+1]??beatsPerBar)-beat);
        if(last)gate=i===0?Math.max(.3,rhythm[1]-.08):beatsPerBar-beat;
        const accent=Math.abs(beat-Math.round(beat))<1e-6?1:.8;
        out(beat,1,pitch,Math.max(.1,gate),s.leadGain*accent*entry*(.87+.13*leadRandom()),.58,'lead');
        if(o.style==='canon' && !last) {
          const delay=.75, absolute=bar*beatsPerBar+beat+delay, replyBar=Math.floor(absolute/beatsPerBar), replyBeat=absolute%beatsPerBar;
          if(replyBar<o.bars-1)emit(replyBar,replyBeat,2,fitPitch(o.root+degree(scale,d-4)+12,60,83),Math.min(gate,.48),.24,.28,'imitation',sectionAt(replyBar));
        }
      }
      if(o.style==='broken' && position%2===1 && !last)out(3.5,2,fitPitch(o.root+degree(scale,chordDegree+4)+12,60,88),.35,.29,.25,'reply');
      if(o.style==='motor' && position===3 && !last)out(2,2,fitPitch(o.root+degree(scale,chordDegree+2)+12,60,88),1.2,.27,.25,'counterline');
    }
    if(o.drums) {
      const kick=b=>out(b,5,36,.18,.52,.5,'kick'),snare=(b,v=.33)=>out(b,6,38,.18,v,.5,'snare'),hat=(b,v=.20)=>out(b,7,42,.10,v,.6,'hat');
      if(last){kick(0);out(0,9,49,1,.18,.35,'cadence-cymbal');}
      else if(o.style==='waltz'){kick(0);snare(2,.20);for(const b of [.5,1.5,2.5])hat(b,.14);}
      else if(o.style==='motor'){for(const b of [0,1,2])kick(b);snare(2.5);for(let b=0;b<3.5;b+=.5)hat(b,[0,1,2].includes(b)?.21:.12);}
      else if(o.style==='broken'){for(const b of position%2===0?[0,1.75,2.5]:[.25,1.5,3.25])kick(b);snare(1);snare(3);if(drumRandom()<o.variation)snare(2.75,.13);for(const b of [.5,1.25,2,2.5,3.5,3.75])if(drumRandom()<.45+.55*o.density)hat(b,b%1===0?.20:.13);}
      else if(o.style==='canon'){kick(0);snare(1.5,.18);for(const b of [.5,1,2,2.5])hat(b,.12);}
      else if(o.style==='drift'){kick(0);hat(2.5,.10);}
      else {kick(0);if(section!=='C'){kick(2);snare(1);snare(3);for(let b=.5;b<4;b+=.5)hat(b,.13);}else hat(2,.1);}
      if(position===3 && !last && o.variation>.5)for(let j=0;j<2;j++)out(beatsPerBar-.5+j*.25,8,j?45:49,.2,.23,.42+j*.13,'fill');
    }
  }
  sourceEvents.sort((a,b)=>a.frame-b.frame||a.sourceInstrument-b.sourceInstrument);
  const events=[],audit=[];
  const mapping=['sine-pad','marimba','marimba','sine-texture','sine-bass','kick','snare','closed-hat','toms','short-clash'];
  for(const [sourceIndex,e] of sourceEvents.entries()){
    const instrument=mapping[e.sourceInstrument];
    if(!instrument)throw new Error('Unmapped composition layer');
    events.push({frame:e.frame,instrument,pitch:e.pitch,duration:e.duration,velocity:e.velocity,pan:e.pan});
    audit.push({sourceIndex,eventIndex:events.length-1,instrument,disposition:'render'});
  }
  return {schema:COMPOSER_VERSION,options:o,frames,activeFrames,beatsPerBar,meter:[...s.meter],motif,progression,barPlan,events,sourceEvents,audit,stats:{sourceEventCount:sourceEvents.length,routedEvents:events.length,mutedEvents:0,fallbackEvents:0},limitations:['New offline composition path; the original live EventScore, PWA and Android are unchanged.','Style names describe structural strategies, not listening approval or musical-quality guarantees.']};
}
/** Adapter for existing six-argument noteOn sinks. Options are fixed per instance;
 * unlike the live legacy score, parameter automation and unbounded streaming are not supported.
 */
export class VarietyScore {
  constructor(sampleRate=48000,seed=7311,options={}){this.plan=composeVarietyPlan({...options,sampleRate,seed});this.reset();}
  reset(){this.index=0;this.lastFrame=-1;}
  advanceTo(frame,sink){
    if(!Number.isSafeInteger(frame)||frame<0||frame<this.lastFrame||!sink||typeof sink.noteOn!=='function')throw new TypeError('Monotonic frame and noteOn sink required');
    while(this.index<this.plan.sourceEvents.length&&this.plan.sourceEvents[this.index].frame<=frame){const e=this.plan.sourceEvents[this.index++];sink.noteOn(e.frame,e.sourceInstrument,e.pitch,e.duration,e.velocity,e.pan);}
    this.lastFrame=frame;
  }
}
