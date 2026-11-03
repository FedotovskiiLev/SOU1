// SPDX-License-Identifier: AGPL-3.0-only
import {composeWithScore,validateScoreOptions} from '../../tools/instruments/event-score-core.mjs';
import {loadBrowserBank} from './bank.mjs';
import {renderBrowserPlan} from './render.mjs';
import {loadBrowserScore} from './score-source.mjs';
let busy=false;
self.onmessage=async({data})=>{if(busy)return;busy=true;try{
 const options=validateScoreOptions(data.options);if(options.duration>30)throw new RangeError('Maximum 30 seconds in this browser prototype');
 if(!crypto.subtle)throw new Error('Secure context required: localhost or HTTPS');
 const {EventScore}=await loadBrowserScore();
 const bank=await loadBrowserBank(new URL('../../assets/cc0-mini/manifest.json',import.meta.url),{onProgress:p=>self.postMessage({type:'progress',value:p*.25})});
 const plan=composeWithScore(EventScore,options),result=renderBrowserPlan(plan,bank.instruments,p=>self.postMessage({type:'progress',value:.25+p*.75}));
 self.postMessage({type:'ready',...result},[result.left.buffer,result.right.buffer]);
 }catch(error){self.postMessage({type:'error',message:error.message||String(error)});}finally{busy=false;}};
