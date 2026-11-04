// SPDX-License-Identifier: AGPL-3.0-only
// Browser-only adapter over the same canonical composer used by the Node tools.
import {composeWithScore,validateScoreOptions} from '../../tools/instruments/event-score-core.mjs';
import {composeExpressivePlan,validateExpression} from '../../tools/composition/expressive-score.mjs';
import {validateVarietyOptions,VARIETY_STYLES} from '../../tools/composition/variety-score.mjs';
import {exportScoreMidi} from '../../tools/composition/score-midi.mjs';
import {PREPARED_DRUM_KITS,GUIGUI_KITS,drumManifestPath} from '../../tools/instruments/drum-kits.mjs';
import {loadBrowserBank} from './bank.mjs';
import {loadBrowserScore} from './score-source.mjs';
import {renderBrowserPlan} from './render.mjs';

export const BROWSER_KITS=Object.freeze(['vcsl',...PREPARED_DRUM_KITS]);
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
export function validateBrowserRequest(input={}) {
  if(!plain(input))throw new TypeError('Browser options object');
  const {composer='legacy',drumKit='vcsl',...options}=input;
  if(!BROWSER_KITS.includes(drumKit))throw new RangeError('Unknown drumKit');
  if(composer==='legacy') {
    const score=validateScoreOptions(options);
    if(score.duration>30)throw new RangeError('Browser maximum is 30 seconds including the release tail');
    return {composer,drumKit,options:score};
  }
  if(composer!=='expressive')throw new RangeError('Unknown browser composer');
  const expression=validateExpression(options),score=validateVarietyOptions(expression.score);
  const [numerator,denominator]=VARIETY_STYLES[score.style].meter,meter=numerator*4/denominator;
  if(score.bars*meter*60/score.bpm+2>30)throw new RangeError('Browser maximum is 30 seconds including the release tail; reduce bars or increase BPM');
  return {composer,drumKit,options:{...expression,score}};
}

export async function loadBrowserScoreBank(drumKit='vcsl',{fetcher=fetch,onProgress=()=>{},assetBaseUrl=new URL('../../',import.meta.url)}={}) {
  if(!BROWSER_KITS.includes(drumKit))throw new RangeError('Unknown drumKit');
  const paths=['assets/cc0-mini/manifest.json',...(drumKit==='vcsl'?[]:[drumManifestPath(drumKit)])];
  const instruments=new Map(),instrumentBanks={},banks=[];
  let decodedBytes=0,encodedBytes=0,mappedBytes=0;
  for(const [index,path] of paths.entries()) {
    const bank=await loadBrowserBank(new URL(path,assetBaseUrl),{fetcher,maxEncodedBytes:12*1024*1024-encodedBytes,maxDecodedBytes:Math.min(8*1024*1024,16*1024*1024-decodedBytes),maxMappedBytes:Math.min(8*1024*1024,16*1024*1024-mappedBytes),onProgress:p=>onProgress((index+p)/paths.length)});
    decodedBytes+=bank.decodedBytes;encodedBytes+=bank.encodedBytes;mappedBytes+=bank.mappedBytes;
    if(decodedBytes>16*1024*1024||mappedBytes>16*1024*1024||encodedBytes>12*1024*1024)throw new RangeError('Combined browser sample memory budget');
    for(const [id,instrument] of bank.instruments){instruments.set(id,instrument);instrumentBanks[id]=bank.manifest.id;}
    banks.push({id:bank.manifest.id,sourceCommit:bank.manifest.sourceCommit,manifest:path,sha256:bank.manifestSha256});
  }
  if(instruments.size>28)throw new RangeError('Browser registry exceeds room for four sine instruments');
  return {instruments,instrumentBanks,banks,decodedBytes,encodedBytes,mappedBytes};
}

export async function prepareBrowserRender(input={}, {fetcher=fetch,onProgress=()=>{},scoreLoader=loadBrowserScore,assetBaseUrl=new URL('../../',import.meta.url)}={}) {
  const request=validateBrowserRequest(input);
  let plan;
  if(request.composer==='expressive')plan=composeExpressivePlan(request.options);
  else {
    const {EventScore}=await scoreLoader({fetcher});
    plan=composeWithScore(EventScore,request.options);
  }
  const bank=await loadBrowserScoreBank(request.drumKit,{fetcher,assetBaseUrl,onProgress:p=>onProgress(p*.3)});
  const result=renderBrowserPlan(plan,bank.instruments,p=>onProgress(.3+p*.7));
  const midi=request.composer==='expressive'?exportScoreMidi(plan):null;
  return {...result,...(midi?{midiBytes:midi.bytes}:{}),report:{...result.report,
    composer:request.composer,composerVersion:plan.schema??'sou1.legacy-event-score',drumKit:request.drumKit,
    recipe:request.options,...(plan.expression?{expression:plan.expression}:{}),
    banks:bank.banks,instrumentBanks:bank.instrumentBanks,
    sampleMemory:{encodedBytes:bank.encodedBytes,decodedBytes:bank.decodedBytes,mappedBytes:bank.mappedBytes},
    sourceEvents:plan.sourceEvents,...(midi?{midi:midi.report}:{}),
    limitations:[
      'This isolated page pre-renders a finite buffer in a worker, not the production PWA/Android or a realtime AudioWorklet.',
      'Pitched voices remain VCSL marimba and sine pad/bass/texture. No Surge XT or SFZ engine is hosted by this page.',
      'MIDI describes the exact generated score but does not embed samples or set up a DAW instrument.',
      ...(GUIGUI_KITS.includes(request.drumKit)?['Guigui soft/hard threshold 0.6 is not calibrated dynamics or round robin. Source hard-hit rail contacts are documented. Quiet scores can use only soft layers.']:[])
    ]}};
}
