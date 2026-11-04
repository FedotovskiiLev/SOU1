// SPDX-License-Identifier: AGPL-3.0-only
// Transport adapter only. Each phrase still uses the canonical expressive composer.
import {validateBrowserRequest} from './prepare.mjs';
import {VARIETY_STYLES} from '../../tools/composition/variety-score.mjs';
export function validateSessionRecipe(input) {
  const request=validateBrowserRequest(input);
  if(request.composer!=='expressive')throw new RangeError('Continuous preview requires the expressive composer');
  return {composer:request.composer,drumKit:request.drumKit,...request.options};
}
function phraseSeed(seed,index) {
  if(index===0)return seed;
  let x=(seed+Math.imul(index,0x9e3779b9))>>>0;
  x=Math.imul(x^(x>>>16),0x21f0aaad);x=Math.imul(x^(x>>>15),0x735a2d97);
  return (x^(x>>>15))>>>0;
}
export function sessionPhrase(recipe,index) {
  if(!Number.isSafeInteger(index)||index<0||index>1_000_000)throw new RangeError('Session phrase index 0..1000000');
  const normalized=validateSessionRecipe(recipe),o=normalized.score;
  const [num,den]=VARIETY_STYLES[o.style].meter,beats=o.bars*num*4/den;
  const seed=phraseSeed(o.seed,index),activeSeconds=beats*60/o.bpm;
  // Match the canonical composer's arithmetic order before rounding to samples.
  const activeFrames=Math.round(o.bars*(num*4/den)*(o.sampleRate*60/o.bpm));
  return {schema:'sou1.session-phrase.v1',index,seed,startBeat:index*beats,startSeconds:index*beats*60/o.bpm,activeSeconds,activeFrames,frames:activeFrames+2*o.sampleRate,
    recipe:{...normalized,score:{...o,seed}}};
}
