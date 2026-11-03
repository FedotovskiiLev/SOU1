// SPDX-License-Identifier: AGPL-3.0-only
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
export const SCORE_SOURCE_COMMIT='70bf98168b1c854f8ce79676e02acc4bc44bac93';
const ENGINE_SHA='ea1df6717f43a1e62b272a2202fb716d0940194e71febd97b0bc283cc439d6fb';
const ENV_SHA='76e226e8a0345fe5bfd205fa44a8432cd720e54005326666e414265325a145ad';
export const SCORE_LAYERS=Object.freeze(['pad','pluck','bell','texture','pulse','kick','snare','hihat','toms','cymbal']);
const PROFILES={
  nocturne:{ambient:.65,counterpoint:.2,rhythmic:0,arpeggio:.25,bpm:72,density:.43,complexity:.4,swing:.12,evolution:.2,melodyEnabled:true,drumsEnabled:false,pad:.20,pluck:.65,bell:.4,texture:.08,pulse:.16,kick:.4,snare:.3,hihat:.2,toms:0,cymbal:0},
  pulse:{ambient:.15,counterpoint:0,rhythmic:.65,arpeggio:.3,bpm:92,density:.6,complexity:.48,swing:.17,evolution:.2,melodyEnabled:true,drumsEnabled:true,pad:.12,pluck:.55,bell:.23,texture:.04,pulse:.3,kick:.5,snare:.38,hihat:.25,toms:0,cymbal:0}
};for(const p of Object.values(PROFILES))Object.freeze(p);export const SCORE_PROFILES=Object.freeze(PROFILES);
export function validateScoreOptions(options={}){
  if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(k=>!['profile','seed','sampleRate','duration','parameters','outputGainDb'].includes(k)))throw new TypeError('Unknown score cue option');
  const o={profile:'nocturne',seed:20261103,sampleRate:48000,duration:20,parameters:{},outputGainDb:8,...options};
  if(typeof o.profile!=='string'||!Object.hasOwn(PROFILES,o.profile)||!Number.isInteger(o.seed)||o.seed<0||o.seed>0xffffffff||![44100,48000].includes(o.sampleRate)||!Number.isFinite(o.duration)||o.duration<4||o.duration>120||!Number.isFinite(o.outputGainDb)||o.outputGainDb < -60||o.outputGainDb>24)throw new RangeError('Invalid score cue options');
  if(!o.parameters||typeof o.parameters!=='object'||Array.isArray(o.parameters))throw new TypeError('parameters object');
  const p={...PROFILES[o.profile]};
  for(const [key,value] of Object.entries(o.parameters)){
    if(!Object.hasOwn(p,key))throw new TypeError('Unsupported score parameter: '+key);
    if(key==='melodyEnabled'||key==='drumsEnabled'){if(typeof value!=='boolean')throw new TypeError('Boolean score parameter');}
    else if(key==='bpm'){if(!Number.isInteger(value)||value<30||value>180)throw new RangeError('bpm 30..180');}
    else if(!Number.isFinite(value)||value<0||value>1)throw new RangeError('Score parameter 0..1');
    p[key]=value;
  }
  // There are deliberately no fake tom or crash samples in the compact bank.
  if(p.drumsEnabled&&(p.toms>0||p.cymbal>0))throw new Error('Tom/cymbal backends not implemented; explicitly mute those layers');
  return {...o,parameters:Object.freeze(p)};
}
let modulePromise;
export async function loadOriginalScore(){
  if(!modulePromise)modulePromise=(async()=>{
    const engine=await readFile(new URL('../../docs/audio-engine.js',import.meta.url),'utf8'),env=await readFile(new URL('../../docs/environment-audio.js',import.meta.url),'utf8');
    const hash=s=>createHash('sha256').update(s).digest('hex');
    if(hash(engine)!==ENGINE_SHA||hash(env)!==ENV_SHA)throw new Error('Original DSP source changed; review/update the pinned EventScore adapter');
    const envUrl='data:text/javascript;base64,'+Buffer.from(env).toString('base64');
    return import('data:text/javascript;base64,'+Buffer.from(engine.replace("'./environment-audio.js'",JSON.stringify(envUrl))).toString('base64'));
  })().catch(e=>{modulePromise=undefined;throw e;});
  return modulePromise;
}
export async function composeScorePlan(options={}){
  const o=validateScoreOptions(options),{EventScore}=await loadOriginalScore();
  const frames=Math.round(o.duration*o.sampleRate),activeFrames=frames-2*o.sampleRate;
  const sourceEvents=[],events=[],audit=[];let muted=0,fallback=0;
  const score=new EventScore(o.sampleRate,o.seed);
  score.advanceTo(activeFrames-1,o.parameters,{noteOn(frame,sourceInstrument,pitch,duration,velocity,pan){
    if(sourceEvents.length>=4096)throw new RangeError('Score exceeds bounded 4096 event budget');
    const sourceIndex=sourceEvents.length,source={frame,sourceInstrument,pitch,duration,velocity,pan};sourceEvents.push(source);
    const layer=SCORE_LAYERS[sourceInstrument];if(!layer)throw new Error('Unknown EventScore instrument');
    // Match the existing engine: disabling melody gates pluck/bell, not pads/bass.
    const gain=o.parameters[layer];
    if(gain===0||((sourceInstrument===1||sourceInstrument===2)&&!o.parameters.melodyEnabled)||(sourceInstrument>=5&&!o.parameters.drumsEnabled)){
      audit.push({sourceIndex,layer,disposition:'muted',reason:gain===0?'zero-layer-gain':'disabled-group'});muted++;return;
    }
    let instrument,disposition='render';
    if(sourceInstrument===0)instrument='sine-pad';
    else if(sourceInstrument===3)instrument='sine-texture';
    else if(sourceInstrument===4)instrument='sine-bass';
    else if(sourceInstrument===1||sourceInstrument===2){
      instrument='marimba';if(pitch<60||pitch>91){instrument='sine-fallback';disposition='fallback';fallback++;}
    }else instrument=({5:'kick',6:'snare',7:'closed-hat'})[sourceInstrument];
    if(!instrument)throw new Error('Unmapped non-muted EventScore layer: '+layer);
    const e={frame,instrument,pitch,duration,velocity:velocity*gain,pan};events.push(e);audit.push({sourceIndex,layer,disposition,instrument,layerGain:gain,eventIndex:events.length-1});
  }});
  return {options:o,frames,activeFrames,events,sourceEvents,audit,stats:{sourceEventCount:sourceEvents.length,routedEvents:events.length,mutedEvents:muted,fallbackEvents:fallback},sourceCommit:SCORE_SOURCE_COMMIT,sourceHashes:{audioEngineSha256:ENGINE_SHA,environmentAudioSha256:ENV_SHA}};
}
