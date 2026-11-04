// SPDX-License-Identifier: AGPL-3.0-only
import {loadBrowserScoreBank,prepareBrowserRender} from './prepare.mjs';
import {sessionPhrase,validateSessionRecipe} from './session-plan.mjs';
// One worker per session. Samples are fetched and verified once, outside audio rendering.
let recipe=null,bank=null,busy=false,nextIndex=0;
self.onmessage=async({data})=>{
  if(busy){self.postMessage({type:'error',message:'A phrase is already being prepared'});return;}
  busy=true;
  try {
    if(!crypto.subtle)throw new Error('Secure context required: localhost or HTTPS');
    if(data?.type==='init'){
      if(recipe)throw new Error('Session is already initialized');
      recipe=validateSessionRecipe(data.recipe);
      bank=await loadBrowserScoreBank(recipe.drumKit,{assetBaseUrl:new URL('../../',self.location.href)});
    } else if(data?.type!=='next'||!recipe||!bank)throw new Error('Initialize a session before requesting phrases');
    const phrase=sessionPhrase(recipe,nextIndex);
    const result=await prepareBrowserRender(phrase.recipe,{bankLoader:async()=>bank});
    nextIndex++;
    self.postMessage({type:'phrase',phrase,...result},[result.left.buffer,result.right.buffer,result.midiBytes.buffer]);
  } catch(error) {self.postMessage({type:'error',message:error.message||String(error)});}
  finally {busy=false;}
};
