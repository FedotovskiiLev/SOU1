// SPDX-License-Identifier: AGPL-3.0-only
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {ENGINE_SHA,ENV_SHA,composeWithScore} from './event-score-core.mjs';
export {SCORE_SOURCE_COMMIT,SCORE_LAYERS,SCORE_PROFILES,validateScoreOptions} from './event-score-core.mjs';
let modulePromise;
export async function loadOriginalScore(){
  if(!modulePromise)modulePromise=(async()=>{
    const engine=await readFile(new URL('./legacy/audio-engine.js',import.meta.url),'utf8'),env=await readFile(new URL('./legacy/environment-audio.js',import.meta.url),'utf8');
    const hash=s=>createHash('sha256').update(s).digest('hex');
    if(hash(engine)!==ENGINE_SHA||hash(env)!==ENV_SHA)throw new Error('Original DSP source changed; review/update the pinned EventScore adapter');
    const envUrl='data:text/javascript;base64,'+Buffer.from(env).toString('base64');
    return import('data:text/javascript;base64,'+Buffer.from(engine.replace("'./environment-audio.js'",JSON.stringify(envUrl))).toString('base64'));
  })().catch(e=>{modulePromise=undefined;throw e;});
  return modulePromise;
}
export async function composeScorePlan(options={}){const {EventScore}=await loadOriginalScore();return composeWithScore(EventScore,options);}
