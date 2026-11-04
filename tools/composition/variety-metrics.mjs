// SPDX-License-Identifier: AGPL-3.0-only
// Descriptive symbolic metrics, not a proxy for subjective musical quality.
const quant=x=>Math.round(x*10000)/10000;
const histogram=items=>{const result={};for(const x of items)result[x]=(result[x]??0)+1;return result;};
function ngrams(xs,n=3){const out=[];for(let i=0;i<=xs.length-n;i++)out.push(xs.slice(i,i+n).join(','));return out;}
export function summarizeVariety(plan){
  const lead=plan.sourceEvents.filter(e=>e.sourceInstrument===1),framesPerBeat=plan.options.sampleRate*60/plan.options.bpm;
  const intervals=lead.slice(1).map((e,i)=>e.pitch-lead[i].pitch),onsets=lead.slice(1).map((e,i)=>quant((e.frame-lead[i].frame)/framesPerBeat));
  const phrases={};for(const e of lead){const bar=e.bar??Math.floor(e.frame/framesPerBeat/plan.beatsPerBar);(phrases[bar]??=[]).push(quant(e.beat??((e.frame/framesPerBeat)%plan.beatsPerBar)));}
  return {leadNotes:lead.length,pitchRange:lead.length?[Math.min(...lead.map(e=>e.pitch)),Math.max(...lead.map(e=>e.pitch))]:null,uniquePitches:new Set(lead.map(e=>e.pitch)).size,intervalHistogram:histogram(intervals),onsetGapHistogram:histogram(onsets),gateHistogram:histogram(lead.map(e=>quant(e.duration/framesPerBeat))),uniqueBarRhythms:new Set(Object.values(phrases).map(x=>x.join(','))).size,leadIntervalTrigrams:[...new Set(ngrams(intervals))],leadRhythmTrigrams:[...new Set(ngrams(onsets))],sections:[...new Set((plan.barPlan??[]).map(b=>b.section))],chordDegrees:(plan.barPlan??[]).map(b=>b.chordDegree),meter:plan.meter,notesByLayer:histogram(plan.sourceEvents.map(e=>e.sourceInstrument))};
}
const jaccardDistance=(a,b)=>{const x=new Set(a),y=new Set(b),union=new Set([...x,...y]);let shared=0;for(const v of x)if(y.has(v))shared++;return union.size?1-shared/union.size:0;};
export function compareVariety(a,b){
  const x=summarizeVariety(a),y=summarizeVariety(b);
  return {intervalTrigramDistance:jaccardDistance(x.leadIntervalTrigrams,y.leadIntervalTrigrams),rhythmTrigramDistance:jaccardDistance(x.leadRhythmTrigrams,y.leadRhythmTrigrams),sameMeter:JSON.stringify(x.meter)===JSON.stringify(y.meter),sameChordDegrees:JSON.stringify(x.chordDegrees)===JSON.stringify(y.chordDegrees),noteCountDifference:Math.abs(x.leadNotes-y.leadNotes),note:'Distances range 0 (same observed patterns) to 1 (disjoint observed patterns); they do not establish listening quality.'};
}
