// SPDX-License-Identifier: AGPL-3.0-only
// Standard MIDI type 1 export for finite variety/expressive plans. No host required.
const PPQ=960,MAX_DELTA=0x0fffffff;
const names=['Pad','Lead','Answer','Texture','Bass','Kick','Snare','Hat','Toms','Cymbal'];
const programs=[89,12,12,91,38]; // Playback suggestions, not a claim of exact synth timbres.
const bytes=s=>Array.from(new TextEncoder().encode(s));
const be=(n,count)=>Array.from({length:count},(_,i)=>Math.floor(n/2**(8*(count-i-1)))%256);
function vlq(n){if(!Number.isSafeInteger(n)||n<0||n>MAX_DELTA)throw new RangeError('MIDI delta');const out=[n%128];while((n=Math.floor(n/128))>0)out.unshift(n%128|128);return out;}
const meta=(type,text)=>{const data=bytes(text);return [0xff,type,...vlq(data.length),...data];};
const chunk=(id,data)=>[...bytes(id),...be(data.length,4),...data];
export function exportScoreMidi(plan){
  if(!plan||!['sou1.variety-score.v1','sou1.expressive-score.v1'].includes(plan.schema)||!Array.isArray(plan.sourceEvents)||plan.sourceEvents.length>4096||![44100,48000].includes(plan.options?.sampleRate)||!Number.isFinite(plan.options?.bpm)||plan.options.bpm<40||plan.options.bpm>180||!Array.isArray(plan.meter)||![4,8].includes(plan.meter[1])||!Number.isInteger(plan.meter[0])||plan.meter[0]<1||plan.meter[0]>16||!Number.isSafeInteger(plan.activeFrames)||plan.activeFrames<1)throw new TypeError('Validated finite score plan required');
  const rate=plan.options.sampleRate,bpm=plan.options.bpm,ticksPerFrame=PPQ*bpm/(60*rate),endTick=Math.round(plan.activeFrames*ticksPerFrame),tempo=Math.round(60000000/bpm);
  if(typeof plan.options.style!=='string'||plan.options.style.length<1||plan.options.style.length>32||(plan.expression!==undefined&&(!plan.expression||typeof plan.expression.phrasing!=='string'||plan.expression.phrasing.length<1||plan.expression.phrasing.length>32)))throw new TypeError('Invalid bounded style metadata');
  const bpb=plan.meter[0]*4/plan.meter[1],bars=plan.options.bars;
  if(!Number.isInteger(bars)||bars<2||bars>32||plan.beatsPerBar!==bpb||plan.activeFrames!==Math.round(bars*bpb*(rate*60/bpm))||!Array.isArray(plan.barPlan)||plan.barPlan.length!==bars||plan.barPlan.some((b,i)=>!b||b.bar!==i||!Number.isInteger(b.position)||b.position<0||b.position>=8||typeof b.section!=='string'||b.section.length<1||b.section.length>32))throw new TypeError('Invalid bar or marker metadata');
  if(endTick<1||endTick>MAX_DELTA)throw new RangeError('Score duration outside MIDI tick bounds');
  const notes=[];let mappedTomKeys=0;
  for(const e of plan.sourceEvents){
    if(!Number.isSafeInteger(e.frame)||e.frame<0||!Number.isSafeInteger(e.duration)||e.duration<1||e.frame+e.duration>plan.activeFrames||!Number.isInteger(e.sourceInstrument)||e.sourceInstrument<0||e.sourceInstrument>9||!Number.isInteger(e.pitch)||e.pitch<0||e.pitch>127||!Number.isFinite(e.velocity)||e.velocity<0||e.velocity>1||!Number.isFinite(e.pan)||e.pan<0||e.pan>1)throw new TypeError('Invalid source note');
    if(e.velocity===0)continue;
    const layer=e.sourceInstrument,channel=layer<5?layer:9;
    // SOU1 tom keys encode articulations; translate high-tom 49 to GM high tom
    // 50 so it cannot collide with GM crash cymbal 49 on the drum channel.
    const pitch=layer===8&&e.pitch===49?50:e.pitch;if(pitch!==e.pitch)mappedTomKeys++;
    const start=Math.min(endTick-1,Math.round(e.frame*ticksPerFrame)),end=Math.min(endTick,Math.max(start+1,Math.round((e.frame+e.duration)*ticksPerFrame)));
    notes.push({start,end,pitch,layer,channel,velocity:Math.max(1,Math.round(e.velocity*127)),pan:e.pan});
  }
  if(!notes.length)throw new RangeError('No notes to export');
  // MIDI1 note-off has no unique voice ID. Resolve overlapping equal keys
  // explicitly and count edits rather than claiming lossless per-note gates.
  const groups=new Map();for(const n of notes){const k=n.channel+':'+n.pitch;if(!groups.has(k))groups.set(k,[]);groups.get(k).push(n);}
  let coalesced=0,shortened=0;const resolved=[];
  for(const group of groups.values()){
    group.sort((a,b)=>a.start-b.start||a.layer-b.layer);const kept=[];
    for(const n of group){const prev=kept.at(-1);if(prev&&prev.start===n.start){prev.end=Math.max(prev.end,n.end);prev.velocity=Math.max(prev.velocity,n.velocity);coalesced++;continue;}if(prev&&prev.end>n.start){prev.end=n.start;shortened++;}kept.push(n);}resolved.push(...kept);
  }
  const conductor=[{tick:0,order:0,data:meta(3,'SOU1 '+plan.options.style+' '+(plan.expression?.phrasing??'original phrasing'))},{tick:0,order:1,data:[0xff,0x51,3,...be(tempo,3)]},{tick:0,order:2,data:[0xff,0x58,4,plan.meter[0],Math.log2(plan.meter[1]),plan.meter[0]===6&&plan.meter[1]===8?36:plan.meter[1]===8?12:24,8]}];
  for(const b of plan.barPlan??[])if(b.position===0)conductor.push({tick:Math.round(b.bar*plan.beatsPerBar*PPQ),order:3,data:meta(6,'Section '+b.section+' / bar '+(b.bar+1))});
  const encodeTrack=events=>{events.sort((a,b)=>a.tick-b.tick||a.order-b.order);let previous=0;const data=[];for(const e of events){data.push(...vlq(e.tick-previous),...e.data);previous=e.tick;}data.push(...vlq(Math.max(0,endTick-previous)),0xff,0x2f,0);return chunk('MTrk',data);};
  const tracks=[encodeTrack(conductor)];
  for(let layer=0;layer<=5;layer++){
    // All channel-10 notes share one track, so note-off-before-retrigger order
    // remains unambiguous even when two source percussion layers use one key.
    const ns=resolved.filter(n=>layer===5?n.layer>=5:n.layer===layer);if(!ns.length)continue;const channel=layer<5?layer:9;
    const es=[{tick:0,order:-4,data:meta(3,layer===5?'Percussion':names[layer])}];
    if(layer<5){es.push({tick:0,order:-3,data:[0xc0|channel,programs[layer]]});const pan=Math.round(ns.reduce((sum,n)=>sum+n.pan,0)/ns.length*127);es.push({tick:0,order:-2,data:[0xb0|channel,10,pan]});}
    for(const n of ns){es.push({tick:n.start,order:1,data:[0x90|channel,n.pitch,n.velocity]},{tick:n.end,order:0,data:[0x80|channel,n.pitch,0]});}
    tracks.push(encodeTrack(es));
  }
  return {bytes:new Uint8Array([...chunk('MThd',[0,1,...be(tracks.length,2),...be(PPQ,2)]),...tracks.flat()]),report:{schema:'sou1.score-midi.v1',format:1,ppq:PPQ,tracks:tracks.length,bpm,encodedMicrosecondsPerQuarter:tempo,meter:[...plan.meter],sourceNotes:notes.length,exportedNotes:resolved.length,coalescedSameTick:coalesced,shortenedOverlaps:shortened,translatedTomKeys:mappedTomKeys,endTick,limitations:['MIDI1 overlaps of equal pitch/channel are shortened or coalesced and counted.','Pan is a per-melodic-track average; MIDI1 cannot preserve simultaneous independent per-note pan on one channel. Drum pan is left to the host.','GM programs only suggest playback; exact Surge/plugin timbres require the host and a saved patch.','SMF byte/parser checks do not establish successful REAPER or hardware playback.']}};
}
