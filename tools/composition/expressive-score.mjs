// SPDX-License-Identifier: AGPL-3.0-only
import {composeVarietyPlan,MODES} from './variety-score.mjs';
export const PHRASINGS=Object.freeze(['lyrical','dialogue','angular','ornamented','triplet']);
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const unit=x=>Number.isFinite(x)&&x>=0&&x<=1;
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
function random(seed,index,salt){let x=Math.imul((seed^index^salt)>>>0,0x45d9f3b);x=Math.imul(x^(x>>>16),0x45d9f3b);return ((x^(x>>>16))>>>0)/4294967296;}
function scalePitches(root,mode){const notes=[];for(let n=24;n<=108;n++)if(MODES[mode].includes(((n-root)%12+12)%12))notes.push(n);return notes;}
function diatonic(notes,pitch,steps,lo=60,hi=88){const i=notes.indexOf(pitch);if(i<0)throw new Error('Source note outside selected scale');let p=notes[clamp(i+steps,0,notes.length-1)];while(p<lo)p+=12;while(p>hi)p-=12;return p;}
export function validateExpression(input={}){
  if(!plain(input)||Object.keys(input).some(k=>!['score','phrasing','phraseBars','dynamics','humanize','articulation'].includes(k)))throw new TypeError('Unknown expressive score option');
  const o={score:{},phrasing:'dialogue',phraseBars:4,dynamics:.7,humanize:.2,articulation:.65,...input};
  if(!plain(o.score)||!PHRASINGS.includes(o.phrasing)||![2,4,8].includes(o.phraseBars)||!unit(o.dynamics)||!unit(o.humanize)||!unit(o.articulation))throw new RangeError('Invalid expressive score options');
  return o;
}
export function composeExpressivePlan(input={}){
  const x=validateExpression(input),base=composeVarietyPlan(x.score),o=base.options,fpb=o.sampleRate*60/o.bpm,bpb=base.beatsPerBar;
  const notes=scalePitches(o.root,o.mode),source=[],lastBar=o.bars-1;
  const indexed=base.sourceEvents.map((e,i)=>({...e,sourceIndex:i}));
  const leadByBar=new Map(),counterByBar=new Map();for(const e of indexed.filter(e=>e.sourceInstrument===1||e.sourceInstrument===2)){const part=e.sourceInstrument===1?leadByBar:counterByBar;if(!part.has(e.bar))part.set(e.bar,[]);part.get(e.bar).push(e);}
  const at=(bar,beat)=>Math.round((bar*bpb+beat)*fpb);
  function append(e,{beat=e.beat,pitch=e.pitch,layer=e.sourceInstrument,gate=e.gateBeats,velocity=e.velocity,role=e.role}={}){
    const sourceIndex=e.sourceIndex,r=random(o.seed,e.bar*65537+Math.round(e.beat*65536)+e.pitch*131+e.sourceInstrument*104729,layer*73856093+Math.round(beat*4096)+pitch*31);
    const phrasePosition=((e.bar%x.phraseBars)+beat/bpb)/x.phraseBars;
    // An arch across the whole phrase, not independent white-noise velocities.
    const arch=.75+.25*Math.sin(Math.PI*phrasePosition),accent=Math.abs(beat-Math.round(beat))<.01?1:.86;
    velocity*=1-x.dynamics+x.dynamics*arch*accent;
    velocity*=1+(r-.5)*.10*x.humanize;
    if(e.bar!==lastBar && beat>.05 && (layer===1||layer===2||layer===7))beat=clamp(beat+(r-.5)*.05*x.humanize,.01,bpb-.03);
    const frame=at(e.bar,beat),duration=Math.max(1,Math.min(base.activeFrames-frame,Math.round(gate*fpb)));
    source.push({...e,frame,beat,pitch,sourceInstrument:layer,duration,gateBeats:Math.min(gate,o.bars*bpb-e.bar*bpb-beat),velocity:clamp(velocity,0,1),pan:layer===2?.28:e.pan,role,expression:x.phrasing});
  }
  for(const e of indexed){
    const melodic=e.sourceInstrument===1||e.sourceInstrument===2,last=e.bar===lastBar;
    if(last){append(e);continue;} // Preserve the explicit resolved ending.
    const i=((e.sourceInstrument===2?counterByBar:leadByBar).get(e.bar)??[]).findIndex(n=>n.sourceIndex===e.sourceIndex);
    if(x.phrasing==='dialogue'){
      if(e.sourceInstrument===2)continue; // Replace the old countermelody with actual replies.
      if(e.sourceInstrument===1){
        if(e.beat>=bpb/2)continue;
        append(e,{gate:Math.min(e.gateBeats,.55+.25*(1-x.articulation)),role:'question'});
      }else append(e,{gate:e.sourceInstrument===4?Math.min(e.gateBeats,.65):e.gateBeats});
    }else if(x.phrasing==='lyrical'){
      if(e.sourceInstrument===1){
        const retained=j=>j%3!==2||e.bar%x.phraseBars===x.phraseBars-1;
        if(!retained(i))continue;
        const ns=leadByBar.get(e.bar),next=ns.slice(i+1).find((_,j)=>retained(i+j+1)),end=next?.beat??bpb;
        const previous=ns[i-1]?.pitch??e.pitch,pitch=Math.abs(e.pitch-previous)>7?diatonic(notes,previous,e.pitch>previous?2:-2):e.pitch;
        append(e,{pitch,gate:Math.max(.15,end-e.beat-.035),role:'sung-line'});
      }else append(e,{gate:e.sourceInstrument===4?Math.min(bpb-e.beat,1.5):e.gateBeats});
    }else if(x.phrasing==='angular'){
      if(melodic){
        if(i>0 && (i+e.bar)%4===2)continue;
        const direction=(i+e.bar)%2===0?3:-3,beat=clamp(e.beat+(i%2===1?.25:0),0,bpb-.1);
        append(e,{beat,pitch:diatonic(notes,e.pitch,direction),gate:.12+.22*(1-x.articulation),role:'fragment'});
      }else append(e,{beat:e.sourceInstrument===4&&e.beat>0?clamp(e.beat+.25,0,bpb-.15):e.beat});
    }else if(x.phrasing==='ornamented'){
      if(e.sourceInstrument===1 && i%2===1 && e.gateBeats>=.25 && e.beat+.3<bpb){
        append(e,{pitch:diatonic(notes,e.pitch,(i+e.bar)%2?1:-1),gate:.105,velocity:e.velocity*.58,role:'grace'});
        append(e,{beat:e.beat+.125,pitch:diatonic(notes,e.pitch,(i+e.bar)%2?-1:1),gate:.105,velocity:e.velocity*.66,role:'turn'});
        append(e,{beat:e.beat+.25,gate:Math.max(.12,e.gateBeats-.25),role:'ornament-resolution'});
      }else append(e,{gate:melodic?Math.min(bpb-e.beat,e.gateBeats*(.7+.3*(1-x.articulation))):e.gateBeats});
    }else if(x.phrasing==='triplet'){
      const remap=beat=>{const whole=Math.floor(beat),fraction=beat-whole;return clamp(whole+(fraction<.2?0:fraction<.6?2/3:1),0,bpb-1/6);};
      if(melodic||e.sourceInstrument===4||e.sourceInstrument===7){
        const beat=remap(e.beat),gate=Math.max(1/6,Math.round(e.gateBeats*3)/3)*(1-.35*x.articulation);
        append(e,{beat,gate,role:melodic?'swung-line':e.role});
      }else append(e);
    }
  }
  if(x.phrasing==='dialogue' && o.melody){
    for(let bar=0;bar<lastBar;bar++){
      const calls=(leadByBar.get(bar)??[]).filter(e=>e.beat<bpb/2);
      if(!calls.length)continue;
      const response=[...calls].reverse().slice(0,3);
      for(let i=0;i<response.length;i++){
        const e=response[i],beat=bpb/2+i*(bpb/2)/Math.max(2,response.length);
        append(e,{beat,pitch:diatonic(notes,e.pitch,bar%2===0?-2:2),layer:2,gate:Math.min(.65,(bpb-beat)*.8),velocity:e.velocity*.78,role:'answer'});
      }
    }
  }
  source.sort((a,b)=>a.frame-b.frame||a.sourceInstrument-b.sourceInstrument||a.sourceIndex-b.sourceIndex);
  if(source.length>4096)throw new RangeError('Expressive score exceeds 4096 events');
  const instruments=['sine-pad','marimba','marimba','sine-texture','sine-bass','kick','snare','closed-hat','toms','short-clash'];
  const events=source.map(e=>({frame:e.frame,instrument:instruments[e.sourceInstrument],pitch:e.pitch,duration:e.duration,velocity:e.velocity,pan:e.pan}));
  const expression=Object.freeze({phrasing:x.phrasing,phraseBars:x.phraseBars,dynamics:x.dynamics,humanize:x.humanize,articulation:x.articulation});
  return {...base,schema:'sou1.expressive-score.v1',expression,sourceEvents:source,events,audit:source.map((e,i)=>({sourceIndex:i,baseSourceIndex:e.sourceIndex,eventIndex:i,instrument:events[i].instrument,disposition:'render'})),stats:{...base.stats,baseSourceEventCount:base.sourceEvents.length,sourceEventCount:source.length,routedEvents:source.length},limitations:[...base.limitations,'Expression is an independent arrangement step: note identities, gates, dynamics and inter-part replies can change.','Humanization is seeded and bounded, not a recording of human performance.']};
}
