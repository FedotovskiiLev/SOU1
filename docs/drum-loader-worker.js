// SPDX-License-Identifier: AGPL-3.0-only
import {prepareDrumBank} from './drum-bank.js';
let used=false;
self.onmessage=async({data})=>{
 if(used)return;used=true;
 try{const result=await prepareDrumBank(data.kit,data.sampleRate);self.postMessage({type:'ready',...result},result.wireBank.samples.map(pcm=>pcm.buffer));}
 catch(e){self.postMessage({type:'error',message:e.message||String(e)});}
};
